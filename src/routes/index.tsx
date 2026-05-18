import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Toaster, toast } from "sonner";
import {
  ArrowLeft, BarChart3, Beer, Minus, Moon, Plus, Shuffle,
  Sun, Trophy, Users, Volume2, VolumeX,
} from "lucide-react";
import logo from "@/assets/logo.jpg";
import field from "@/assets/field.png";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Leberschuss – Punktezähler" },
      { name: "description", content: "Stilvoller Punktezähler für Leberschuss." },
    ],
  }),
});

// ─────────────────────────────────────────────────────────────
// Typen & Konstanten
// ─────────────────────────────────────────────────────────────
const BOTTLE = 4;
type Shot = number | "M";
type PlayerStats = {
  name: string;
  bottleSips: number;   // verbleibende Schlücke der aktuellen Flasche
  emptied: number;      // exte Flaschen (Bier-Counter)
  shotsTotal: number;
  mutterHits: number;
  ownGoals: number;
  roundsPlayed: number;
};
type PlayerRef = { team: 0 | 1; player: 0 | 1 };
type Round = {
  shots: Record<string, Shot>;
  drinksByPlayer: [[number, number], [number, number]];
  mutterCount: [number, number];
  mutterEffective: 0 | 1 | null;
  totals: [number, number];
  starter: PlayerRef;
};
type Mode = "fixed" | "random";
type Phase = "setup" | "ausschnippen" | "turn" | "summary" | "winner" | "stats";
type State = {
  teams: [{ players: [PlayerStats, PlayerStats] }, { players: [PlayerStats, PlayerStats] }];
  rounds: Round[];
  starter: PlayerRef;
  ausschnippenMutter: [[number, number], [number, number]]; // pro Spieler
  phase: Phase;
  turnIdx: number;
  pendingShots: Record<string, Shot>;
  // Verteilungs-Eingabe
  pendingSplit: [number, number] | null;
  pendingDrinkingTeam: 0 | 1 | null;
};

const STORAGE_KEY = "leberschuss.v4";

const freshP = (name: string): PlayerStats => ({
  name, bottleSips: BOTTLE, emptied: 0, shotsTotal: 0,
  mutterHits: 0, ownGoals: 0, roundsPlayed: 0,
});
const initial = (): State => ({
  teams: [
    { players: [freshP(""), freshP("")] },
    { players: [freshP(""), freshP("")] },
  ],
  rounds: [],
  starter: { team: 0, player: 0 },
  ausschnippenMutter: [[0, 0], [0, 0]],
  phase: "setup",
  turnIdx: 0,
  pendingShots: {},
  pendingSplit: null,
  pendingDrinkingTeam: null,
});

const diag = (p: PlayerRef): PlayerRef => ({
  team: (p.team ^ 1) as 0 | 1, player: (p.player ^ 1) as 0 | 1,
});
const mate = (p: PlayerRef): PlayerRef => ({
  team: p.team, player: (p.player ^ 1) as 0 | 1,
});
const turnOrder = (s: PlayerRef): PlayerRef[] => [s, diag(s), mate(s), diag(mate(s))];
const k = (r: PlayerRef) => `${r.team}-${r.player}`;
const pname = (st: State, r: PlayerRef) => st.teams[r.team].players[r.player].name || defaultName(r);
const defaultName = (r: PlayerRef) => `Person ${r.team * 2 + r.player + 1}`;
const teamLabel = (st: State, ti: 0 | 1) =>
  `${pname(st, { team: ti, player: 0 })} & ${pname(st, { team: ti, player: 1 })}`;

// Plural-Helfer
const bier = (n: number) => `${n} ${n === 1 ? "Bier" : "Biere"}`;
const muttern = (n: number) => `${n} ${n === 1 ? "Mutter" : "Muttern"}`;
const schluecke = (n: number) => `${n} ${n === 1 ? "Schluck" : "Schlücke"}`;

// Sips eines Teams verbleibend (von 8)
const teamSipsLeft = (st: State, ti: 0 | 1) =>
  st.teams[ti].players[0].bottleSips + st.teams[ti].players[1].bottleSips;

// Default-Verteilung (random bei ungerade)
function defaultSplit(net: number): [number, number] {
  const a = Math.floor(net / 2);
  const b = net - a;
  if (net % 2 === 1 && Math.random() < 0.5) return [b, a];
  return [a, b];
}

// Schlücke auf einen Spieler anwenden, Overflow zum Teammate
function drinkSips(players: [PlayerStats, PlayerStats], pi: 0 | 1, sips: number) {
  let rem = sips;
  let cur: 0 | 1 = pi;
  let safety = 100;
  while (rem > 0 && safety-- > 0) {
    const me = players[cur];
    if (me.bottleSips > 0) {
      const take = Math.min(me.bottleSips, rem);
      me.bottleSips -= take;
      rem -= take;
      if (me.bottleSips === 0) me.emptied += 1;
    } else {
      // Overflow zum Mitspieler, wenn der noch was hat
      const other: 0 | 1 = (cur ^ 1) as 0 | 1;
      if (players[other].bottleSips > 0) cur = other;
      else break; // beide leer → Spiel ist eh vorbei
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Theme & Sound (vereinfacht & konsistent)
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
  _ctx: null as AudioContext | null,
  ctx() {
    if (!this._ctx) {
      try { this._ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
      catch { return null; }
    }
    return this._ctx;
  },
  tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.05) {
    if (!this.enabled) return;
    const c = this.ctx(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    const t = c.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  },
  tap() { this.tone(520, 0.05, "sine", 0.03); },
  confirm() { this.tone(660, 0.09, "sine", 0.05); },
  mutter() {
    this.tone(180, 0.32, "sawtooth", 0.07);
  },
  win() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, "sine", 0.05), i * 140));
  },
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
        {state.phase === "setup" && <Setup state={state} setState={setState} />}
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
          onClick={() => {
            if (state.phase === "setup") return;
            if (confirm("Zum Setup zurück? Aktuelles Spiel verwerfen?")) setState(initial());
          }}
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
  return (
    <div className="mx-auto max-w-2xl px-4 pb-3 grid grid-cols-2 gap-2 text-sm">
      {([0, 1] as const).map(ti => (
        <div key={ti} className="rounded-lg border border-border bg-card/70 px-3 py-2 flex items-center gap-2">
          <Beer className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium leading-tight">{teamLabel(state, ti)}</div>
            <div className="text-xs text-muted-foreground">
              {teamSipsLeft(state, ti)}/8 Schlücke übrig
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function beerCounts(state: State): [number, number] {
  const t0 = state.teams[0].players.reduce((n, p) => n + p.emptied, 0);
  const t1 = state.teams[1].players.reduce((n, p) => n + p.emptied, 0);
  return [t0, t1];
}
function totalMutter(state: State, ti: 0 | 1) {
  const inGame = state.teams[ti].players.reduce((n, p) => n + p.mutterHits, 0);
  const aus = state.ausschnippenMutter[ti][0] + state.ausschnippenMutter[ti][1];
  return inGame + aus;
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
  const [shuffled, setShuffled] = useState<[[string, string], [string, string]] | null>(null);

  const seatLabels = [
    "Links gegenüber",
    "Rechts gegenüber",
    "Du oder dein Mitspieler",
    "Du oder dein Mitspieler",
  ];

  const validateFixed = () => {
    const flat = names.flat();
    if (flat.some(n => !n.trim())) { toast.error("Bitte alle Namen ausfüllen"); return false; }
    return true;
  };

  const doShuffle = () => {
    const clean = pool.map(n => n.trim()).filter(Boolean);
    if (clean.length !== 4) { toast.error("Bitte 4 Namen eingeben"); return; }
    const shuf = [...clean].sort(() => Math.random() - 0.5);
    setShuffled([[shuf[0], shuf[1]], [shuf[2], shuf[3]]]);
    setStarter({ team: 0, player: 0 });
    toast.success("Teams zufällig zugeteilt");
  };

  const finalNames = (): [[string, string], [string, string]] | null => {
    if (mode === "fixed") {
      if (!validateFixed()) return null;
      return names;
    }
    if (!shuffled) { toast.error("Erst auslosen"); return null; }
    return shuffled;
  };

  const startTo = (target: "turn" | "ausschnippen") => {
    const fin = finalNames(); if (!fin) return;
    sfx.confirm();
    setState(() => ({
      ...initial(),
      teams: [
        { players: [freshP(fin[0][0]), freshP(fin[0][1])] },
        { players: [freshP(fin[1][0]), freshP(fin[1][1])] },
      ],
      starter,
      phase: target,
    }));
  };

  const currentNames: [[string, string], [string, string]] =
    mode === "fixed" ? names : (shuffled ?? [["", ""], ["", ""]]);

  return (
    <div className="space-y-5 pt-5 anim-slide">
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-semibold">Neues Spiel</h1>
        <p className="text-sm text-muted-foreground">Teams aufstellen & los geht's</p>
      </div>

      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted">
        {(["fixed", "random"] as const).map(m => (
          <button key={m} onClick={() => { setMode(m); sfx.tap(); }}
            className={"flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all " +
              (mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {m === "fixed" ? <Users className="h-4 w-4" /> : <Shuffle className="h-4 w-4" />}
            {m === "fixed" ? "Feste Teams" : "Zufällig"}
          </button>
        ))}
      </div>

      {mode === "fixed" ? (
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground text-center">
            Setzt euch wie an der Platte. Person 1 & 2 sitzen euch gegenüber, Person 3 & 4 seid ihr.
          </p>
          {([0, 1] as const).map(ti => (
            <Card key={ti} className="p-4 space-y-2.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {ti === 0 ? "Team 1 – Gegnerseite" : "Team 2 – Deine Seite"}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {([0, 1] as const).map(pi => {
                  const seatIdx = ti * 2 + pi;
                  return (
                    <div key={pi} className="space-y-1">
                      <div className="text-[11px] text-muted-foreground">
                        Person {seatIdx + 1} · {seatLabels[seatIdx]}
                      </div>
                      <Input value={names[ti][pi]} placeholder={`Person ${seatIdx + 1}`}
                        onChange={e => {
                          const nn = names.map(r => [...r]) as typeof names;
                          nn[ti][pi] = e.target.value; setNames(nn);
                        }} />
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <Card className="p-4 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">4 Namen — Teams werden gemischt</div>
            <div className="grid grid-cols-2 gap-2">
              {pool.map((n, i) => (
                <Input key={i} value={n} placeholder={`Name ${i + 1}`}
                  onChange={e => { const c = [...pool]; c[i] = e.target.value; setPool(c); }} />
              ))}
            </div>
            <Button variant="outline" className="w-full" onClick={doShuffle}>
              <Shuffle className="h-4 w-4 mr-2" /> {shuffled ? "Neu auslosen" : "Teams auslosen"}
            </Button>
          </Card>
          {shuffled && (
            <Card className="p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Ausgeloste Teams</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg border border-border p-2">
                  <div className="text-[11px] text-muted-foreground">Team 1</div>
                  <div>{shuffled[0][0]} & {shuffled[0][1]}</div>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <div className="text-[11px] text-muted-foreground">Team 2</div>
                  <div>{shuffled[1][0]} & {shuffled[1][1]}</div>
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {(mode === "fixed" || shuffled) && (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Wer fängt an?</div>
          <div className="grid grid-cols-2 gap-2">
            {([0, 1] as const).flatMap(ti => ([0, 1] as const).map(pi => {
              const sel = starter.team === ti && starter.player === pi;
              const nm = currentNames[ti][pi] || `Person ${ti * 2 + pi + 1}`;
              return (
                <button key={`${ti}-${pi}`} onClick={() => { setStarter({ team: ti, player: pi }); sfx.tap(); }}
                  className={"rounded-lg border px-3 py-3 text-sm font-medium transition-all " +
                    (sel ? "border-primary bg-primary/15 anim-pop" : "border-border hover:bg-accent/40")}>
                  {nm}
                  <div className="text-[10px] text-muted-foreground mt-0.5">Team {ti + 1}</div>
                </button>
              );
            }))}
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <Button size="lg" className="w-full text-base" onClick={() => startTo("turn")}>
          Spiel starten
        </Button>
        <Button size="lg" variant="outline" className="w-full text-base" onClick={() => startTo("ausschnippen")}>
          Erst Ausschnippen…
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          Beim Ausschnippen erfasste Muttern werden direkt auf den Bier-Counter der Gegner gerechnet.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ausschnippen
// ─────────────────────────────────────────────────────────────
function Ausschnippen({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [mut, setMut] = useState<[[number, number], [number, number]]>(state.ausschnippenMutter);

  const apply = () => {
    setState(s => {
      const teams = s.teams.map(t => ({
        players: t.players.map(p => ({ ...p })) as [PlayerStats, PlayerStats],
      })) as State["teams"];
      // Pro Mutter eines Teams: jeder Gegner ext 1 Bier
      ([0, 1] as const).forEach(ti => {
        const teamMuttern = mut[ti][0] + mut[ti][1];
        if (teamMuttern > 0) {
          const opp: 0 | 1 = (ti ^ 1) as 0 | 1;
          teams[opp].players.forEach(p => { p.emptied += teamMuttern; });
        }
      });
      return { ...s, teams, ausschnippenMutter: mut, phase: "turn" };
    });
    sfx.confirm();
  };

  const total = (ti: 0 | 1) => mut[ti][0] + mut[ti][1];
  const setVal = (ti: 0 | 1, pi: 0 | 1, v: number) => {
    const c = mut.map(r => [...r]) as typeof mut;
    c[ti][pi] = Math.max(0, v);
    setMut(c);
    sfx.tap();
  };

  return (
    <div className="space-y-5 pt-5 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setState(s => ({ ...s, phase: "setup" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" />Zurück
        </Button>
        <div className="text-sm font-medium">Ausschnippen</div>
        <div className="w-16" />
      </div>

      <p className="text-sm text-muted-foreground text-center">
        Wer hat beim Ausschnippen eine Mutter getroffen? Pro Mutter ext jeder Gegner 1 Bier.
      </p>

      <div className="space-y-3">
        {([0, 1] as const).map(ti => (
          <Card key={ti} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{teamLabel(state, ti)}</div>
              <div className="text-xs text-muted-foreground">{muttern(total(ti))}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([0, 1] as const).map(pi => (
                <div key={pi} className="rounded-lg border border-border p-2 space-y-2">
                  <div className="text-xs truncate">{pname(state, { team: ti, player: pi })}</div>
                  <div className="flex items-center justify-between gap-2">
                    <Button size="icon" variant="outline" onClick={() => setVal(ti, pi, mut[ti][pi] - 1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <div className="text-2xl font-semibold tabular-nums w-8 text-center">{mut[ti][pi]}</div>
                    <Button size="icon" variant="outline" onClick={() => setVal(ti, pi, mut[ti][pi] + 1)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => setState(s => ({ ...s, ausschnippenMutter: [[0, 0], [0, 0]], phase: "turn" }))}>
          Keine Mutter
        </Button>
        <Button onClick={apply}>Übernehmen & starten</Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Turn
// ─────────────────────────────────────────────────────────────
function TurnScreen({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const order = useMemo(() => turnOrder(state.starter), [state.starter]);
  const ref = order[state.turnIdx];
  const player = state.teams[ref.team].players[ref.player];

  const setShot = (val: Shot) => {
    if (val === "M") sfx.mutter(); else sfx.tap();
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
        setState(s => ({ ...s, phase: "setup" }));
      } else {
        undoLastRound(setState);
      }
      return;
    }
    setState(s => ({ ...s, turnIdx: s.turnIdx - 1 }));
  };

  return (
    <div className="pt-4 space-y-4 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={back}><ArrowLeft className="h-4 w-4 mr-1" />Zurück</Button>
        <div className="text-xs text-muted-foreground">Schuss {state.turnIdx + 1} / 4</div>
      </div>

      <Card className="p-5 text-center space-y-1">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Am Zug</div>
        <div className="text-3xl font-semibold">{player.name || defaultName(ref)}</div>
        <div className="text-xs text-muted-foreground">{teamLabel(state, ref.team)}</div>
      </Card>

      <Card className="p-3 space-y-3">
        {/* 3 2 1 */}
        <div className="grid grid-cols-3 gap-2">
          {[3, 2, 1].map(v => (
            <ShotButton key={v} value={v} onClick={() => setShot(v)} />
          ))}
        </div>
        {/* 0 + Mutter */}
        <div className="grid grid-cols-2 gap-2">
          <ShotButton value={0} onClick={() => setShot(0)} />
          <button onClick={() => setShot("M")}
            className="py-5 rounded-xl bg-mutter text-white text-xl font-bold tracking-wider shadow-lg hover:brightness-110 transition-all anim-glow">
            MUTTER
          </button>
        </div>
        {/* -1 -2 -3 */}
        <div className="grid grid-cols-3 gap-2">
          {[-1, -2, -3].map(v => (
            <ShotButton key={v} value={v} onClick={() => setShot(v)} negative />
          ))}
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
// Summary (mit Verteilungs-Eingabe)
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
  const mutterEffective: 0 | 1 | null = mA === mB ? null : (mA < mB ? 0 : 1);
  const applyNormal = mutterEffective === null;
  const net = Math.abs(tA - tB);
  const drinking: 0 | 1 | null = !applyNormal || net === 0 ? null : (tA > tB ? 0 : 1);

  const [split, setSplit] = useState<[number, number]>(() => drinking !== null ? defaultSplit(net) : [0, 0]);

  const checkEnd = (s: State): boolean =>
    ([0, 1] as const).some(ti => s.teams[ti].players[0].bottleSips === 0 && s.teams[ti].players[1].bottleSips === 0);

  const apply = () => {
    setState(s => {
      const teams = s.teams.map(t => ({
        players: t.players.map(p => ({ ...p })) as [PlayerStats, PlayerStats],
      })) as State["teams"];

      const drinksByPlayer: [[number, number], [number, number]] = [[0, 0], [0, 0]];

      // Stats
      ([0, 1] as const).forEach(ti => ([0, 1] as const).forEach(pi => {
        const v = shots[`${ti}-${pi}`];
        const p = teams[ti].players[pi];
        p.roundsPlayed += 1;
        if (v === "M") p.mutterHits += 1;
        else if (typeof v === "number") { p.shotsTotal += v; if (v < 0) p.ownGoals += 1; }
      }));

      // Normale Schlücke
      if (drinking !== null && applyNormal) {
        drinksByPlayer[drinking] = [split[0], split[1]];
        ([0, 1] as const).forEach(pi => drinkSips(teams[drinking].players, pi, split[pi]));
      }
      // Mutter: betroffenes Team ext beide Flaschen → reset auf BOTTLE
      if (mutterEffective !== null) {
        teams[mutterEffective].players.forEach(p => { p.emptied += 1; p.bottleSips = BOTTLE; });
      }

      const round: Round = {
        shots: { ...shots },
        drinksByPlayer,
        mutterCount: [mA, mB],
        mutterEffective,
        totals: [tA, tB],
        starter: s.starter,
      };

      const nextStarter: PlayerRef = {
        team: (s.starter.team ^ 1) as 0 | 1,
        player: (s.starter.player ^ 1) as 0 | 1,
      };

      const next: State = {
        ...s,
        teams,
        rounds: [...s.rounds, round],
        starter: nextStarter,
        pendingShots: {},
        turnIdx: 0,
        pendingSplit: null,
        pendingDrinkingTeam: null,
        phase: "turn",
      };

      if (checkEnd(next)) next.phase = "winner";
      return next;
    });
    if (mutterEffective !== null) sfx.mutter(); else sfx.confirm();
  };

  const splitSum = split[0] + split[1];
  const splitOK = drinking === null || splitSum === net;

  const setPlayerSips = (pi: 0 | 1, delta: number) => {
    if (drinking === null) return;
    const other: 0 | 1 = (pi ^ 1) as 0 | 1;
    const c: [number, number] = [split[0], split[1]];
    const newVal = Math.max(0, Math.min(net, c[pi] + delta));
    const diff = newVal - c[pi];
    c[pi] = newVal;
    c[other] = Math.max(0, Math.min(net, c[other] - diff));
    if (c[0] + c[1] !== net) {
      // Force-Korrektur falls Rundungsproblem
      c[other] = net - c[pi];
    }
    setSplit(c);
    sfx.tap();
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
            {(mA > 0 && mB > 0) && <div className="text-xs text-muted-foreground">({mA} vs {mB})</div>}
          </div>
        ) : mA > 0 && mB > 0 ? (
          <div className="text-center text-sm">
            <span className="text-mutter font-medium">Mutter ausgeglichen</span> — keine Wirkung
          </div>
        ) : null}

        {applyNormal && net === 0 && mA === 0 && mB === 0 && (
          <div className="text-center text-sm text-muted-foreground">Gleichstand — niemand trinkt</div>
        )}
      </Card>

      {drinking !== null && (
        <Card className="p-4 space-y-3">
          <div className="text-center text-sm">
            <span className="font-semibold">{teamLabel(state, drinking)}</span> trinkt{" "}
            <span className="font-bold text-primary">{schluecke(net)}</span>
          </div>
          <div className="text-xs text-muted-foreground text-center">Wie sollen die Schlücke verteilt werden?</div>
          <div className="grid grid-cols-2 gap-2">
            {([0, 1] as const).map(pi => {
              const p = state.teams[drinking].players[pi];
              return (
                <div key={pi} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="text-xs truncate">{p.name || defaultName({ team: drinking, player: pi })}</div>
                  <div className="flex items-center justify-between gap-2">
                    <Button size="icon" variant="outline" onClick={() => setPlayerSips(pi, -1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <div className="text-2xl font-semibold tabular-nums w-8 text-center">{split[pi]}</div>
                    <Button size="icon" variant="outline" onClick={() => setPlayerSips(pi, +1)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="text-[10px] text-muted-foreground text-center">noch {p.bottleSips} in Flasche</div>
                </div>
              );
            })}
          </div>
          <div className={"text-xs text-center " + (splitOK ? "text-muted-foreground" : "text-destructive")}>
            Summe {splitSum} / {net}
          </div>
        </Card>
      )}

      <Button className="w-full" disabled={!splitOK} onClick={apply}>
        Bestätigen · nächste Runde
      </Button>
    </div>
  );
}

function undoLastRound(setState: React.Dispatch<React.SetStateAction<State>>) {
  setState(s => {
    if (!s.rounds.length) return s;
    const last = s.rounds[s.rounds.length - 1];
    const teams = s.teams.map(t => ({
      players: t.players.map(p => ({ ...p })) as [PlayerStats, PlayerStats],
    })) as State["teams"];

    ([0, 1] as const).forEach(ti => ([0, 1] as const).forEach(pi => {
      const v = last.shots[`${ti}-${pi}`];
      const p = teams[ti].players[pi];
      p.roundsPlayed = Math.max(0, p.roundsPlayed - 1);
      if (v === "M") p.mutterHits = Math.max(0, p.mutterHits - 1);
      else if (typeof v === "number") { p.shotsTotal -= v; if (v < 0) p.ownGoals = Math.max(0, p.ownGoals - 1); }
    }));

    // Normale Schlücke zurück
    ([0, 1] as const).forEach(ti => {
      last.drinksByPlayer[ti].forEach((d, pi) => {
        let remain = d;
        const me = teams[ti].players[pi];
        let safety = 100;
        while (remain > 0 && safety-- > 0) {
          const space = BOTTLE - me.bottleSips;
          if (space >= remain) { me.bottleSips += remain; remain = 0; }
          else { me.bottleSips = BOTTLE; remain -= space; if (me.emptied > 0) { me.emptied -= 1; me.bottleSips = 0; } else break; }
        }
      });
    });
    if (last.mutterEffective !== null) {
      teams[last.mutterEffective].players.forEach(p => {
        if (p.emptied > 0) p.emptied -= 1;
        // bottleSips kann nicht 100% rekonstruiert werden; setzen wir auf BOTTLE
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

  // Verlierer = Team mit beiden Flaschen leer. Gewinner = anderes Team.
  const loserTeam: 0 | 1 | null =
    state.teams[0].players[0].bottleSips === 0 && state.teams[0].players[1].bottleSips === 0 ? 0 :
    state.teams[1].players[0].bottleSips === 0 && state.teams[1].players[1].bottleSips === 0 ? 1 : null;
  const winnerTeam: 0 | 1 | null = loserTeam === null ? null : (loserTeam ^ 1) as 0 | 1;

  const beer = beerCounts(state);
  const { mvps, ankers } = computeMvpAnker(state);

  const back = () => setState(s => ({ ...s, phase: "summary" }));

  const newRound = () =>
    setState(s => ({
      ...s,
      teams: s.teams.map(t => ({ players: t.players.map(p => freshP(p.name)) as [PlayerStats, PlayerStats] })) as State["teams"],
      rounds: [], ausschnippenMutter: [[0, 0], [0, 0]],
      pendingShots: {}, turnIdx: 0, pendingSplit: null, pendingDrinkingTeam: null,
      phase: "ausschnippen",
    }));

  const newTeams = () => setState(() => ({ ...initial() }));

  const fmt = (arr: { name: string; team: 0 | 1; score: number }[]) =>
    arr.map(a => `${a.name} (Team ${a.team + 1})`).join(" & ");

  return (
    <div className="pt-4 space-y-5 text-center anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={back}>
          <ArrowLeft className="h-4 w-4 mr-1" />Zurück
        </Button>
        <div className="text-sm font-medium">Endergebnis</div>
        <div className="w-16" />
      </div>

      <div className="anim-pop">
        <Trophy className="h-16 w-16 text-primary mx-auto" />
      </div>
      <h2 className="text-3xl font-semibold">
        {winnerTeam === null
          ? "Unentschieden"
          : `${state.teams[winnerTeam].players[0].name} & ${state.teams[winnerTeam].players[1].name} gewinnen!`}
      </h2>
      <div className="text-sm text-muted-foreground">
        {bier(beer[0])} : {bier(beer[1])}
      </div>

      <Card className="p-4 space-y-3 text-left">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            MVP{mvps.length > 1 ? "s" : ""}
          </div>
          <div className="text-sm font-semibold">
            {mvps.length ? fmt(mvps) : "—"}
          </div>
          {mvps.length > 0 && (
            <div className="text-[11px] text-muted-foreground">Ø {mvps[0].score.toFixed(2)} pro Runde · Mutter = 4</div>
          )}
        </div>
        <div className="border-t border-border" />
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Anker{ankers.length > 1 ? "" : ""}
          </div>
          <div className="text-sm font-semibold">
            {ankers.length ? fmt(ankers) : "—"}
          </div>
          {ankers.length > 0 && (
            <div className="text-[11px] text-muted-foreground">Ø {ankers[0].score.toFixed(2)} pro Runde</div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" onClick={() => setState(s => ({ ...s, phase: "stats" }))}>
          <BarChart3 className="h-4 w-4 mr-1" />Stats
        </Button>
        <Button onClick={newRound}>Neue Runde</Button>
        <Button variant="secondary" onClick={newTeams}>Neue Teams</Button>
      </div>
    </div>
  );
}

function computeMvpAnker(state: State) {
  const all = ([0, 1] as const).flatMap(ti =>
    state.teams[ti].players.map(p => ({
      name: p.name || "—",
      team: ti,
      // MVP-Score: Ø pro Runde, Mutter zählt als 4
      score: p.roundsPlayed ? (p.shotsTotal + p.mutterHits * 4) / p.roundsPlayed : 0,
      rounds: p.roundsPlayed,
    }))
  );
  const played = all.filter(a => a.rounds > 0);
  if (!played.length) return { mvps: [], ankers: [] };
  const best = Math.max(...played.map(a => a.score));
  const worst = Math.min(...played.map(a => a.score));
  const mvps = played.filter(a => a.score === best);
  const ankers = played.filter(a => a.score === worst);
  return { mvps, ankers };
}

// ─────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────
function Stats({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const back = () => setState(s => ({ ...s, phase: s.rounds.length ? "turn" : "setup" }));
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
            <div className="text-2xl font-semibold">{bier(beer[ti])}</div>
            <div className="text-xs text-muted-foreground">
              {muttern(totalMutter(state, ti))} · {teamSipsLeft(state, ti)}/8 übrig
            </div>
          </Card>
        ))}
      </div>

      <Card className="divide-y divide-border">
        {([0, 1] as const).flatMap(ti => state.teams[ti].players.map(p => (
          <div key={`${ti}-${p.name}`} className="p-3 grid grid-cols-5 gap-2 items-center text-sm">
            <div className="col-span-2 font-medium truncate">
              {p.name} <span className="text-[10px] text-muted-foreground">Team {ti + 1}</span>
            </div>
            <Stat label="Ø/Runde" value={p.roundsPlayed ? ((p.shotsTotal + p.mutterHits * 4) / p.roundsPlayed).toFixed(1) : "0"} />
            <Stat label="Mutter" value={p.mutterHits} />
            <Stat label="Eigentor" value={p.ownGoals} />
          </div>
        )))}
      </Card>

      <div className="text-xs text-muted-foreground text-center">
        Runden: {state.rounds.length} · Ausschnippen: {muttern(state.ausschnippenMutter[0][0] + state.ausschnippenMutter[0][1])} / {muttern(state.ausschnippenMutter[1][0] + state.ausschnippenMutter[1][1])}
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
