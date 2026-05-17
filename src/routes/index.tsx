import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Toaster, toast } from "sonner";
import {
  ArrowLeft, BarChart3, Beer, Moon, Plus, RotateCcw,
  Shuffle, Sun, Trophy, Users, X, Volume2, VolumeX,
} from "lucide-react";
import logo from "@/assets/logo.jpg";
import field from "@/assets/field.png";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Leberschuss – Punktezähler für Partys" },
      { name: "description", content: "Stilvoller Punktezähler für Leberschuss. Mit Stats, Strafschlücken, Ausschnippen und Mutter-Logik." },
    ],
  }),
});

// ─────────────────────────────────────────────────────────────
// Typen
// ─────────────────────────────────────────────────────────────
const BOTTLE = 4;
type Shot = number | "M"; // -3..3 oder Mutter
type PlayerStats = {
  name: string;
  bottleSips: number; // verbleibende Schlücke der aktuellen Flasche
  emptied: number;    // exte Flaschen
  shotsTotal: number; // Summe geschnipster Punkte (kann negativ sein)
  mutterHits: number; // wie oft eigene Mutter
  ownGoals: number;   // Eigentor-Schüsse
  roundsPlayed: number;
};
type PlayerRef = { team: 0 | 1; player: 0 | 1 };
type Round = {
  shots: Record<string, Shot>;          // key "t-p"
  drinksByPlayer: [[number, number], [number, number]]; // tatsächlich verteilte Schlücke
  mutterCount: [number, number];        // pro Team
  mutterEffective: 0 | 1 | null;        // welches Team exen musste (null = ausgeglichen)
  totals: [number, number];             // normale Schlücke
  applied: boolean;                     // normale Schlücke wirklich verteilt?
  starter: PlayerRef;
};
type Mode = "fixed" | "random";
type Phase = "setup" | "ausschnippen" | "turn" | "summary" | "winner" | "stats";
type State = {
  teams: [{ players: [PlayerStats, PlayerStats] }, { players: [PlayerStats, PlayerStats] }];
  rounds: Round[];
  starter: PlayerRef;
  ausschnippenMutter: [number, number]; // Mutter beim Ausschnippen pro Team
  totalPenalty: [number, number];
  phase: Phase;
  turnIdx: number; // 0..3
  pendingShots: Record<string, Shot>;
};

const STORAGE_KEY = "leberschuss.v3";

const freshP = (name: string): PlayerStats => ({
  name, bottleSips: BOTTLE, emptied: 0, shotsTotal: 0,
  mutterHits: 0, ownGoals: 0, roundsPlayed: 0,
});
const initial = (): State => ({
  teams: [
    { players: [freshP("Spieler 1"), freshP("Spieler 2")] },
    { players: [freshP("Spieler 3"), freshP("Spieler 4")] },
  ],
  rounds: [],
  starter: { team: 0, player: 0 },
  ausschnippenMutter: [0, 0],
  totalPenalty: [0, 0],
  phase: "setup",
  turnIdx: 0,
  pendingShots: {},
});

const diag = (p: PlayerRef): PlayerRef => ({
  team: (p.team ^ 1) as 0 | 1, player: (p.player ^ 1) as 0 | 1,
});
const mate = (p: PlayerRef): PlayerRef => ({
  team: p.team, player: (p.player ^ 1) as 0 | 1,
});
const turnOrder = (s: PlayerRef): PlayerRef[] => [s, diag(s), mate(s), diag(mate(s))];
const k = (r: PlayerRef) => `${r.team}-${r.player}`;
const pname = (st: State, r: PlayerRef) => st.teams[r.team].players[r.player].name;
const teamLabel = (st: State, ti: 0 | 1) =>
  `${st.teams[ti].players[0].name} & ${st.teams[ti].players[1].name}`;

// Schlücke auf zwei Spieler aufteilen (auto). Bei ungerade zufällig.
function splitSips(net: number, sipsLeft: [number, number]): [number, number] {
  if (net <= 0) return [0, 0];
  let a = Math.floor(net / 2);
  let b = net - a;
  if (net % 2 === 1 && Math.random() < 0.5) [a, b] = [b, a];
  // Overflow: wenn ein Spieler "kein Getränk" mehr hat → an Mitspieler (vereinfachte Annahme: Flasche refillt sich, nur „aus" wenn beide Flaschen verfügbar)
  // Bottle-Logik wendet sich auf bottleSips. Wir tracken hier nichts darüber hinaus.
  void sipsLeft;
  return [a, b];
}

// ─────────────────────────────────────────────────────────────
// Theme & Sound
// ─────────────────────────────────────────────────────────────
function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("ls.theme");
    const prefers = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const d = stored ? stored === "dark" : !!prefers;
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("ls.theme", next ? "dark" : "light");
  };
  return { dark, toggle };
}

const sfx = {
  enabled: true,
  ctx: null as AudioContext | null,
  beep(freq = 600, dur = 0.08, type: OscillatorType = "sine", gain = 0.06) {
    if (!this.enabled) return;
    try {
      this.ctx ||= new (window.AudioContext || (window as any).webkitAudioContext)();
      const c = this.ctx!;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g); g.connect(c.destination);
      const t = c.currentTime;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch {}
  },
  hit() { this.beep(720, 0.07, "triangle"); },
  mutter() { this.beep(220, 0.18, "sawtooth", 0.09); setTimeout(() => this.beep(160, 0.18, "sawtooth", 0.08), 90); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.beep(f, 0.18, "triangle", 0.08), i * 110)); },
  click() { this.beep(420, 0.03, "square", 0.04); },
};

// ─────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────
function Index() {
  const [state, setState] = useState<State>(initial);
  const [loaded, setLoaded] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const { dark, toggle } = useTheme();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
      const s = localStorage.getItem("ls.sound");
      if (s !== null) setSoundOn(s === "1");
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state, loaded]);
  useEffect(() => { sfx.enabled = soundOn; localStorage.setItem("ls.sound", soundOn ? "1" : "0"); }, [soundOn]);

  const Bg = (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-32 h-[420px] w-[420px] rounded-full opacity-25 blur-3xl"
           style={{ background: "radial-gradient(closest-side, var(--primary), transparent)" }} />
      <div className="absolute -bottom-40 -right-32 h-[420px] w-[420px] rounded-full opacity-20 blur-3xl"
           style={{ background: "radial-gradient(closest-side, var(--mutter), transparent)" }} />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col">
      {Bg}
      <TopBar dark={dark} onTheme={toggle} soundOn={soundOn} onSound={() => setSoundOn(v => !v)} state={state} setState={setState} />
      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pb-10">
        {state.phase === "setup" && <Setup setState={setState} state={state} />}
        {state.phase === "ausschnippen" && <Ausschnippen state={state} setState={setState} />}
        {state.phase === "turn" && <TurnScreen state={state} setState={setState} />}
        {state.phase === "summary" && <Summary state={state} setState={setState} />}
        {state.phase === "winner" && <Winner state={state} setState={setState} />}
        {state.phase === "stats" && <Stats state={state} setState={setState} />}
      </main>
      <Toaster position="top-center" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TopBar
// ─────────────────────────────────────────────────────────────
function TopBar({
  dark, onTheme, soundOn, onSound, state, setState,
}: {
  dark: boolean; onTheme: () => void; soundOn: boolean; onSound: () => void;
  state: State; setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  const inGame = state.phase === "turn" || state.phase === "summary";
  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-background/70 border-b border-border">
      <div className="mx-auto max-w-2xl px-4 py-2.5 flex items-center justify-between gap-2">
        <button
          onClick={() => state.phase !== "setup" && confirm("Zum Setup zurück?") && setState(initial)}
          className="flex items-center gap-2"
          aria-label="Leberschuss"
        >
          <img src={logo} alt="Leberschuss Logo" className="h-8 w-auto rounded-sm" />
        </button>
        <div className="flex items-center gap-1">
          {inGame && state.rounds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setState(s => ({ ...s, phase: "stats" }))}>
              <BarChart3 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onSound} aria-label="Sound">
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onTheme} aria-label="Theme">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {inGame && <ScoreHeader state={state} />}
    </header>
  );
}

function ScoreHeader({ state }: { state: State }) {
  const beer = beerCounts(state);
  return (
    <div className="mx-auto max-w-2xl px-4 pb-3 grid grid-cols-2 gap-2 text-sm">
      {([0, 1] as const).map(ti => (
        <div key={ti} className="rounded-lg border border-border bg-card/70 px-3 py-2 flex items-center gap-2">
          <Beer className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium leading-tight">
              {state.teams[ti].players[0].name} & {state.teams[ti].players[1].name}
            </div>
            <div className="text-xs text-muted-foreground">{beer[ti]} Bier · {totalMutter(state, ti)} Mutter</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function beerCounts(state: State): [number, number] {
  // Anzahl exter Flaschen pro Team (Bier-Counter)
  const t0 = state.teams[0].players.reduce((n, p) => n + p.emptied, 0);
  const t1 = state.teams[1].players.reduce((n, p) => n + p.emptied, 0);
  return [t0, t1];
}
function totalMutter(state: State, ti: 0 | 1) {
  return state.teams[ti].players.reduce((n, p) => n + p.mutterHits, 0) + state.ausschnippenMutter[ti];
}

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
function Setup({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [mode, setMode] = useState<Mode>("fixed");
  const [pool, setPool] = useState(["", "", "", ""]);
  const [names, setNames] = useState<[[string, string], [string, string]]>([
    [state.teams[0].players[0].name, state.teams[0].players[1].name],
    [state.teams[1].players[0].name, state.teams[1].players[1].name],
  ]);
  const [starter, setStarter] = useState<PlayerRef>(state.starter);

  const start = () => {
    let final = names;
    if (mode === "random") {
      const clean = pool.map(n => n.trim()).filter(Boolean);
      if (clean.length !== 4) { toast.error("Bitte 4 Namen eingeben"); return; }
      const shuf = [...clean].sort(() => Math.random() - 0.5);
      final = [[shuf[0], shuf[1]], [shuf[2], shuf[3]]];
      toast.success("Teams zufällig zugeteilt");
    } else {
      if (final.flat().some(n => !n.trim())) { toast.error("Alle Namen ausfüllen"); return; }
    }
    setState(s => ({
      ...s,
      teams: [
        { players: [freshP(final[0][0]), freshP(final[0][1])] },
        { players: [freshP(final[1][0]), freshP(final[1][1])] },
      ],
      starter,
      rounds: [],
      ausschnippenMutter: [0, 0],
      totalPenalty: [0, 0],
      pendingShots: {},
      turnIdx: 0,
      phase: "ausschnippen",
    }));
  };

  return (
    <div className="space-y-5 pt-5 anim-slide">
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-semibold">Neues Spiel</h1>
        <p className="text-sm text-muted-foreground">Teams aufstellen & los geht's</p>
      </div>

      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
        {(["fixed", "random"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={"flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all " +
              (mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {m === "fixed" ? <Users className="h-4 w-4" /> : <Shuffle className="h-4 w-4" />}
            {m === "fixed" ? "Feste Teams" : "Zufällig"}
          </button>
        ))}
      </div>

      {mode === "fixed" ? (
        <div className="grid gap-3">
          {([0, 1] as const).map(ti => (
            <Card key={ti} className="p-4 space-y-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Team {ti + 1}</div>
              <div className="grid grid-cols-2 gap-2">
                {([0, 1] as const).map(pi => (
                  <Input key={pi} value={names[ti][pi]} placeholder={`Spieler ${ti * 2 + pi + 1}`}
                    onChange={e => {
                      const nn = names.map(r => [...r]) as typeof names;
                      nn[ti][pi] = e.target.value; setNames(nn);
                    }} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">4 Namen — Teams werden gemischt</div>
          <div className="grid grid-cols-2 gap-2">
            {pool.map((n, i) => (
              <Input key={i} value={n} placeholder={`Name ${i + 1}`}
                onChange={e => { const c = [...pool]; c[i] = e.target.value; setPool(c); }} />
            ))}
          </div>
        </Card>
      )}

      {mode === "fixed" && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Wer fängt an?</div>
          <div className="grid grid-cols-2 gap-2">
            {([0, 1] as const).flatMap(ti => ([0, 1] as const).map(pi => {
              const sel = starter.team === ti && starter.player === pi;
              const nm = names[ti][pi] || `Spieler ${ti * 2 + pi + 1}`;
              return (
                <button key={`${ti}-${pi}`} onClick={() => setStarter({ team: ti, player: pi })}
                  className={"rounded-lg border px-3 py-3 text-sm font-medium transition-all " +
                    (sel ? "border-primary bg-primary/15 anim-pop" : "border-border hover:bg-accent/40")}>
                  {nm}
                </button>
              );
            }))}
          </div>
        </Card>
      )}

      <Button size="lg" className="w-full text-base" onClick={start}>
        Weiter zum Ausschnippen
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ausschnippen (Mutter-Treffer für Bier-Counter)
// ─────────────────────────────────────────────────────────────
function Ausschnippen({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [mut, setMut] = useState<[number, number]>(state.ausschnippenMutter);
  const skip = (record = true) => {
    setState(s => ({
      ...s,
      ausschnippenMutter: record ? mut : [0, 0],
      phase: "turn",
      turnIdx: 0,
      pendingShots: {},
    }));
  };
  return (
    <div className="space-y-5 pt-5 anim-slide">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-semibold">Ausschnippen</h2>
        <p className="text-sm text-muted-foreground">Wurde dabei eine Mutter getroffen?</p>
      </div>
      <Card className="p-4 space-y-3">
        {([0, 1] as const).map(ti => (
          <div key={ti} className="space-y-2">
            <div className="text-sm font-medium">{teamLabel(state, ti)}</div>
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map(n => (
                <button key={n} onClick={() => { const c = [...mut] as [number, number]; c[ti] = n; setMut(c); sfx.click(); }}
                  className={"py-3 rounded-lg border text-lg font-semibold transition-all " +
                    (mut[ti] === n ? "border-mutter bg-mutter/15 anim-pop" : "border-border hover:bg-accent/30")}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Card>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => skip(false)}>Überspringen</Button>
        <Button onClick={() => skip(true)}>Übernehmen</Button>
      </div>
      <p className="text-xs text-muted-foreground text-center">Zählt zum Bier- und Mutter-Counter, startet das Spiel.</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Turn — Fullscreen pro Spieler
// ─────────────────────────────────────────────────────────────
function TurnScreen({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const order = useMemo(() => turnOrder(state.starter), [state.starter]);
  const ref = order[state.turnIdx];
  const player = state.teams[ref.team].players[ref.player];

  const setShot = (val: Shot) => {
    if (val === "M") sfx.mutter(); else sfx.hit();
    const nextShots = { ...state.pendingShots, [k(ref)]: val };
    const nextIdx = state.turnIdx + 1;
    if (nextIdx >= 4) {
      setState(s => ({ ...s, pendingShots: nextShots, phase: "summary" }));
    } else {
      setState(s => ({ ...s, pendingShots: nextShots, turnIdx: nextIdx }));
    }
  };

  const back = () => {
    if (state.turnIdx === 0) {
      if (state.rounds.length === 0) {
        setState(s => ({ ...s, phase: "ausschnippen" }));
      } else {
        undoLastRound(setState);
      }
      return;
    }
    setState(s => ({ ...s, turnIdx: s.turnIdx - 1 }));
  };

  // Punktewerte: 3, 2, 1, 0, -1, -2, -3, M
  const positive: Shot[] = [3, 2, 1, 0];
  const negative: Shot[] = [-1, -2, -3];

  return (
    <div className="pt-4 space-y-4 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={back}><ArrowLeft className="h-4 w-4 mr-1" />Zurück</Button>
        <div className="text-xs text-muted-foreground">Schuss {state.turnIdx + 1} / 4</div>
      </div>

      <Card className="p-5 text-center space-y-1">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Am Zug</div>
        <div className="text-3xl font-semibold">{player.name}</div>
        <div className="text-xs text-muted-foreground">{teamLabel(state, ref.team)}</div>
      </Card>

      <Card className="p-3 space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {positive.map(v => (
            <ShotButton key={String(v)} value={v} onClick={() => setShot(v)} />
          ))}
        </div>
        <button onClick={() => setShot("M")}
          className="w-full py-5 rounded-xl bg-mutter text-white text-xl font-bold tracking-wider shadow-lg hover:brightness-110 transition-all anim-glow">
          MUTTER
        </button>
        <div className="grid grid-cols-3 gap-2">
          {negative.map(v => (
            <ShotButton key={String(v)} value={v} onClick={() => setShot(v)} negative />
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground text-center pt-1">
          Negativ = Eigentor · Mutter zählt extra
        </div>
      </Card>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none text-center">Feldübersicht</summary>
        <div className="mt-2 flex justify-center">
          <img src={field} alt="Spielfeld" className="h-48 w-auto rounded-md opacity-80" />
        </div>
      </details>
    </div>
  );
}

function ShotButton({ value, onClick, negative }: { value: Shot; onClick: () => void; negative?: boolean }) {
  const label = value === 0 ? "0" : String(value);
  return (
    <button onClick={onClick}
      className={"py-5 rounded-xl text-2xl font-bold border-2 transition-all active:scale-95 " +
        (negative
          ? "border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10"
          : value === 0
            ? "border-border bg-muted hover:bg-accent/40"
            : "border-primary/50 bg-primary/10 hover:bg-primary/20 text-foreground")}>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Summary — Rundenergebnis + Strafe + Anpassungen
// ─────────────────────────────────────────────────────────────
function Summary({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const order = useMemo(() => turnOrder(state.starter), [state.starter]);
  const shots = state.pendingShots;

  const teamSum = (ti: 0 | 1) =>
    ([0, 1] as const).reduce<number>((n, pi) => {
      const v = shots[`${ti}-${pi}`];
      return n + (v === "M" || v === undefined ? 0 : v);
    }, 0);
  const teamMutter = (ti: 0 | 1) =>
    ([0, 1] as const).reduce<number>((n, pi) => n + (shots[`${ti}-${pi}`] === "M" ? 1 : 0), 0);

  const tA = teamSum(0), tB = teamSum(1);
  const mA = teamMutter(0), mB = teamMutter(1);
  // Mutter-Logik: gleich → ausgeglichen (zählen für Counter, normale Schlücke gelten). Ungleich → Team mit weniger Mutter exen + neue Flasche; normale Schlücke skipped.
  const mutterEffective: 0 | 1 | null = mA === mB ? null : (mA < mB ? 0 : 1);
  const applyNormal = mutterEffective === null;
  const net = Math.abs(tA - tB);
  const drinking: 0 | 1 | null = !applyNormal || net === 0 ? null : (tA > tB ? 0 : 1);

  const [penalty, setPenalty] = useState<[number, number]>([0, 0]);
  const [adj, setAdj] = useState<{ removeBeer: [number, number] }>({ removeBeer: [0, 0] });

  const confirmRound = () => {
    setState(s => {
      const drinksByPlayer: [[number, number], [number, number]] = [[0, 0], [0, 0]];
      const teams = s.teams.map((t, ti) => ({
        players: t.players.map(p => ({ ...p })) as [PlayerStats, PlayerStats],
      })) as State["teams"];

      // shots stats
      ([0, 1] as const).forEach(ti => ([0, 1] as const).forEach(pi => {
        const v = shots[`${ti}-${pi}`];
        const p = teams[ti].players[pi];
        p.roundsPlayed += 1;
        if (v === "M") p.mutterHits += 1;
        else if (typeof v === "number") { p.shotsTotal += v; if (v < 0) p.ownGoals += 1; }
      }));

      // normal sips
      if (drinking !== null) {
        const ds = splitSips(net, [teams[drinking].players[0].bottleSips, teams[drinking].players[1].bottleSips]);
        drinksByPlayer[drinking] = ds;
        ds.forEach((d, pi) => {
          let remain = d;
          // 1) eigener Spieler
          const me = teams[drinking].players[pi];
          while (remain > 0) {
            const take = Math.min(me.bottleSips, remain);
            me.bottleSips -= take; remain -= take;
            if (me.bottleSips === 0) { me.emptied += 1; me.bottleSips = BOTTLE; }
            if (remain === 0) break;
            // wenn theoretisch endlos: break
            if (take === 0) break;
          }
        });
      }
      // Mutter effective: das Team exen + neue Flasche
      if (mutterEffective !== null) {
        teams[mutterEffective].players.forEach(p => { p.emptied += 1; p.bottleSips = BOTTLE; });
      }
      // Strafschlücke: pro Team verteilt auf beide Spieler
      ([0, 1] as const).forEach(ti => {
        const tot = penalty[ti];
        if (tot > 0) {
          const ds = splitSips(tot, [teams[ti].players[0].bottleSips, teams[ti].players[1].bottleSips]);
          ds.forEach((d, pi) => {
            let remain = d;
            const me = teams[ti].players[pi];
            while (remain > 0) {
              const take = Math.min(me.bottleSips, remain);
              me.bottleSips -= take; remain -= take;
              if (me.bottleSips === 0) { me.emptied += 1; me.bottleSips = BOTTLE; }
              if (take === 0) break;
            }
          });
        }
      });
      // Korken-Anpassung: emptied -1 (nicht unter 0)
      ([0, 1] as const).forEach(ti => {
        let rm = adj.removeBeer[ti];
        teams[ti].players.forEach(p => {
          while (rm > 0 && p.emptied > 0) { p.emptied -= 1; rm -= 1; }
        });
      });

      const round: Round = {
        shots: { ...shots },
        drinksByPlayer,
        mutterCount: [mA, mB],
        mutterEffective,
        totals: [tA, tB],
        applied: applyNormal,
        starter: s.starter,
      };

      // Nächster Starter: anderes Team, anderer Spieler-Index
      const nextStarter: PlayerRef = {
        team: (s.starter.team ^ 1) as 0 | 1,
        player: (s.starter.player ^ 1) as 0 | 1,
      };

      const nextState: State = {
        ...s,
        teams,
        rounds: [...s.rounds, round],
        totalPenalty: [s.totalPenalty[0] + penalty[0], s.totalPenalty[1] + penalty[1]],
        starter: nextStarter,
        pendingShots: {},
        turnIdx: 0,
        phase: "turn",
      };
      return nextState;
    });
    if (mutterEffective !== null) sfx.mutter();
  };

  const endGame = () => {
    confirmRound();
    setTimeout(() => setState(s => ({ ...s, phase: "winner" })), 50);
  };

  return (
    <div className="pt-4 space-y-4 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setState(s => ({ ...s, phase: "turn", turnIdx: 3 }))}>
          <ArrowLeft className="h-4 w-4 mr-1" />Zurück
        </Button>
        <div className="text-sm font-medium">Rundenergebnis</div>
        <div className="w-16" />
      </div>

      <Card className="p-4 space-y-3">
        {order.map((r, i) => {
          const v = shots[k(r)];
          const isM = v === "M";
          return (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="font-medium">{pname(state, r)}</span>
              <span className={"px-2.5 py-1 rounded-md font-semibold " +
                (isM ? "bg-mutter text-white" : v === 0 ? "bg-muted text-muted-foreground" :
                  (v as number) > 0 ? "bg-primary/20" : "bg-destructive/15 text-destructive")}>
                {isM ? "Mutter" : v}
              </span>
            </div>
          );
        })}
      </Card>

      <Card className="p-4 space-y-2">
        {mutterEffective !== null ? (
          <div className="text-center space-y-1">
            <div className="text-mutter font-bold text-lg">Mutter!</div>
            <div className="text-sm">{teamLabel(state, mutterEffective)} muss exen — neue Flaschen</div>
            {(mA > 0 && mB > 0) && <div className="text-xs text-muted-foreground">({mA} vs {mB} Mutter)</div>}
          </div>
        ) : mA > 0 && mB > 0 ? (
          <div className="text-center text-sm">
            <span className="text-mutter font-medium">Mutter ausgeglichen</span> — zählt nur zum Counter
          </div>
        ) : null}

        {applyNormal && net > 0 && drinking !== null && (
          <div className="text-center text-sm">
            <span className="font-semibold">{teamLabel(state, drinking)}</span> trinkt{" "}
            <span className="font-bold text-primary">{net}</span> Schluck{net !== 1 ? "e" : ""} (automatisch geteilt)
          </div>
        )}
        {applyNormal && net === 0 && mA === 0 && mB === 0 && (
          <div className="text-center text-sm text-muted-foreground">Gleichstand — niemand trinkt</div>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="text-sm font-medium flex items-center gap-2"><Plus className="h-4 w-4" />Strafschlücke</div>
        {([0, 1] as const).map(ti => (
          <div key={ti} className="space-y-1.5">
            <div className="text-xs text-muted-foreground">{teamLabel(state, ti)}</div>
            <div className="grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map(n => (
                <button key={n} onClick={() => { const c = [...penalty] as [number, number]; c[ti] = n; setPenalty(c); }}
                  className={"py-2.5 rounded-lg border text-base font-semibold transition-all " +
                    (penalty[ti] === n ? "border-primary bg-primary/15" : "border-border hover:bg-accent/30")}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
          Etwas verändert? (Korken, Mutter weggeschossen …)
        </summary>
        <div className="px-4 pb-4 space-y-3">
          {([0, 1] as const).map(ti => (
            <div key={ti} className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Bier abziehen — {teamLabel(state, ti)}</div>
              <div className="grid grid-cols-4 gap-2">
                {[0, 1, 2, 3].map(n => (
                  <button key={n} onClick={() => { const c = [...adj.removeBeer] as [number, number]; c[ti] = n; setAdj({ removeBeer: c }); }}
                    className={"py-2 rounded-md border text-sm transition-all " +
                      (adj.removeBeer[ti] === n ? "border-primary bg-primary/10" : "border-border hover:bg-accent/30")}>
                    -{n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={endGame}>Spiel beenden</Button>
        <Button onClick={confirmRound}>Bestätigen · nächste Runde</Button>
      </div>
    </div>
  );
}

function undoLastRound(setState: React.Dispatch<React.SetStateAction<State>>) {
  setState(s => {
    if (!s.rounds.length) return s;
    // Vereinfachte Rücksetzung: letzte Runde verwerfen, Counter neu berechnen ist komplex → wir rekonstruieren minimal aus den Werten.
    const last = s.rounds[s.rounds.length - 1];
    const teams = s.teams.map((t, ti) => ({
      players: t.players.map(p => ({ ...p })) as [PlayerStats, PlayerStats],
    })) as State["teams"];

    ([0, 1] as const).forEach(ti => ([0, 1] as const).forEach(pi => {
      const v = last.shots[`${ti}-${pi}`];
      const p = teams[ti].players[pi];
      p.roundsPlayed = Math.max(0, p.roundsPlayed - 1);
      if (v === "M") p.mutterHits = Math.max(0, p.mutterHits - 1);
      else if (typeof v === "number") { p.shotsTotal -= v; if (v < 0) p.ownGoals = Math.max(0, p.ownGoals - 1); }
    }));
    // Schlücke zurück
    if (last.applied) {
      ([0, 1] as const).forEach(ti => {
        last.drinksByPlayer[ti].forEach((d, pi) => {
          let remain = d;
          const me = teams[ti].players[pi];
          while (remain > 0) {
            const space = BOTTLE - me.bottleSips;
            if (space >= remain) { me.bottleSips += remain; remain = 0; }
            else { me.bottleSips = BOTTLE; remain -= space; if (me.emptied > 0) { me.emptied -= 1; me.bottleSips = 0; } else break; }
          }
        });
      });
    }
    if (last.mutterEffective !== null) {
      teams[last.mutterEffective].players.forEach(p => {
        if (p.emptied > 0) p.emptied -= 1;
        p.bottleSips = BOTTLE;
      });
    }

    return {
      ...s,
      teams,
      rounds: s.rounds.slice(0, -1),
      starter: last.starter,
      pendingShots: last.shots,
      turnIdx: 3,
      phase: "turn",
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Winner
// ─────────────────────────────────────────────────────────────
function Winner({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  useEffect(() => { sfx.win(); }, []);
  const beer = beerCounts(state);
  const winner: 0 | 1 | null = beer[0] === beer[1] ? null : beer[0] > beer[1] ? 0 : 1;
  const { mvp, anker } = computeMvpAnker(state);

  const newRound = () =>
    setState(s => ({
      ...s,
      teams: s.teams.map(t => ({ players: t.players.map(p => freshP(p.name)) as [PlayerStats, PlayerStats] })) as State["teams"],
      rounds: [], ausschnippenMutter: [0, 0], totalPenalty: [0, 0],
      pendingShots: {}, turnIdx: 0, phase: "ausschnippen",
    }));

  const newTeams = () => setState(s => ({ ...initial(), phase: "setup" }));

  return (
    <div className="pt-8 space-y-5 text-center anim-slide">
      <div className="anim-pop">
        <Trophy className="h-16 w-16 text-primary mx-auto" />
      </div>
      <h2 className="text-3xl font-semibold">
        {winner === null ? "Unentschieden" : `${teamLabel(state, winner)} gewinnt!`}
      </h2>
      <div className="text-sm text-muted-foreground">
        {beer[0]} : {beer[1]} Bier
      </div>

      <Card className="p-4 space-y-2 text-left">
        <Row k="MVP" v={mvp ? `${mvp.name} (${mvp.score})` : "—"} sub="Bester Schnipser" />
        <Row k="Anker" v={anker ? `${anker.name} (${anker.score})` : "—"} sub="Hat das Team beschwert" />
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => setState(s => ({ ...s, phase: "stats" }))}>
          <BarChart3 className="h-4 w-4 mr-1" />Stats
        </Button>
        <Button onClick={newRound}>Neue Runde</Button>
      </div>
      <Button variant="ghost" className="w-full" onClick={newTeams}>Neue Teams</Button>
    </div>
  );
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{k}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <div className="text-sm font-semibold">{v}</div>
    </div>
  );
}

function computeMvpAnker(state: State) {
  const all = ([0, 1] as const).flatMap(ti => state.teams[ti].players.map(p => ({
    name: p.name,
    score: p.shotsTotal,
    rounds: p.roundsPlayed,
  })));
  if (!all.length) return { mvp: null, anker: null };
  const mvp = [...all].sort((a, b) => b.score - a.score)[0];
  const anker = [...all].sort((a, b) => a.score - b.score)[0];
  return { mvp, anker };
}

// ─────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────
function Stats({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const back = () => setState(s => ({ ...s, phase: s.rounds.length && s.teams[0].players[0].bottleSips !== undefined ? "turn" : "setup" }));
  const beer = beerCounts(state);
  return (
    <div className="pt-4 space-y-4 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={back}><ArrowLeft className="h-4 w-4 mr-1" />Zurück</Button>
        <div className="text-sm font-medium">Statistiken</div>
        <div className="w-16" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map(ti => (
          <Card key={ti} className="p-3 space-y-1">
            <div className="text-xs text-muted-foreground truncate">{teamLabel(state, ti)}</div>
            <div className="text-2xl font-semibold">{beer[ti]} Bier</div>
            <div className="text-xs text-muted-foreground">
              {totalMutter(state, ti)} Mutter · {state.totalPenalty[ti]} Strafe
            </div>
          </Card>
        ))}
      </div>

      <Card className="divide-y divide-border">
        {([0, 1] as const).flatMap(ti => state.teams[ti].players.map(p => (
          <div key={`${ti}-${p.name}`} className="p-3 grid grid-cols-5 gap-2 items-center text-sm">
            <div className="col-span-2 font-medium truncate">{p.name}</div>
            <Stat label="Ø/Runde" value={p.roundsPlayed ? (p.shotsTotal / p.roundsPlayed).toFixed(1) : "0"} />
            <Stat label="Mutter" value={p.mutterHits} />
            <Stat label="Eigentor" value={p.ownGoals} />
          </div>
        )))}
      </Card>

      <div className="text-xs text-muted-foreground text-center">
        Runden: {state.rounds.length} · Ausschnippen Mutter: {state.ausschnippenMutter[0]} / {state.ausschnippenMutter[1]}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
