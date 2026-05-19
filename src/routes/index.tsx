import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Toaster, toast } from "sonner";
import {
  ArrowLeft, ArrowRight, BarChart3, Beer, Bot, Dumbbell, Minus, Moon, Plus,
  RotateCcw, Shuffle, Sun, Trophy, Users, Volume2, VolumeX,
} from "lucide-react";
import logo from "@/assets/logo.png";
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
const DEFAULT_BOTTLE = 4;
type Shot = number | "M";
type PlayerStats = {
  name: string;
  bottleSize: number;      // 3..5
  bottleSips: number;      // verbleibend in aktueller Flasche
  emptied: number;         // exte Flaschen
  shotsTotal: number;
  mutterHits: number;
  ownGoals: number;
  roundsPlayed: number;
  isBot?: boolean;
  botLevel?: BotLevel;
};
type PlayerRef = { team: 0 | 1; player: 0 | 1 };
type Round = {
  shots: Record<string, Shot>;
  drinksByPlayer: [[number, number], [number, number]];
  mutterCount: [number, number];
  mutterEffective: 0 | 1 | null;
  totals: [number, number];
  starter: PlayerRef;
  // Snapshots for undo:
  prevTeams: State["teams"];
  prevAusschnippen: State["ausschnippenMutter"];
};
type Mode = "fixed" | "random" | "bots" | "training";
type BotLevel = "mittel" | "gut" | "extrem";
type Phase =
  | "setup"
  | "ausschnippen"
  | "turn"
  | "summary"
  | "winner"
  | "stats"
  | "training"
  | "trainingEnd"
  | "starterPick";

type State = {
  teams: [{ players: [PlayerStats, PlayerStats] }, { players: [PlayerStats, PlayerStats] }];
  rounds: Round[];
  originalStarter: PlayerRef;           // Starter von Runde 1
  ausschnippenMutter: [[number, number], [number, number]];
  phase: Phase;
  prevPhase: Phase | null;              // für Zurück aus Stats
  turnIdx: number;
  pendingShots: Record<string, Shot>;
  // Redo-Stack: zuletzt eingegebener Schuss-Wert wurde via "Zurück" gelöscht
  redoShot: { ref: PlayerRef; value: Shot } | null;
  redoFromSummary: boolean;             // Summary wurde via Zurück verlassen
  mode: Mode;
  // Training:
  trainingShots: Shot[];
};

const STORAGE_KEY = "leberschuss.v5";

const freshP = (name: string, opts: Partial<PlayerStats> = {}): PlayerStats => ({
  name, bottleSize: DEFAULT_BOTTLE, bottleSips: opts.bottleSize ?? DEFAULT_BOTTLE,
  emptied: 0, shotsTotal: 0, mutterHits: 0, ownGoals: 0, roundsPlayed: 0,
  ...opts,
});

const initial = (): State => ({
  teams: [
    { players: [freshP(""), freshP("")] },
    { players: [freshP(""), freshP("")] },
  ],
  rounds: [],
  originalStarter: { team: 0, player: 0 },
  ausschnippenMutter: [[0, 0], [0, 0]],
  phase: "setup",
  prevPhase: null,
  turnIdx: 0,
  pendingShots: {},
  redoShot: null,
  redoFromSummary: false,
  mode: "fixed",
  trainingShots: [],
});

const diag = (p: PlayerRef): PlayerRef => ({
  team: (p.team ^ 1) as 0 | 1, player: (p.player ^ 1) as 0 | 1,
});
const mate = (p: PlayerRef): PlayerRef => ({
  team: p.team, player: (p.player ^ 1) as 0 | 1,
});
const turnOrder = (s: PlayerRef): PlayerRef[] => [s, diag(s), mate(s), diag(mate(s))];
const starterOfRound = (orig: PlayerRef, roundIdx: number): PlayerRef =>
  turnOrder(orig)[roundIdx % 4];
const k = (r: PlayerRef) => `${r.team}-${r.player}`;
const defaultName = (r: PlayerRef) => `Person ${r.team * 2 + r.player + 1}`;
const pname = (st: State, r: PlayerRef) => st.teams[r.team].players[r.player].name || defaultName(r);
const teamLabel = (st: State, ti: 0 | 1) =>
  `Spieler ${pname(st, { team: ti, player: 0 })} & ${pname(st, { team: ti, player: 1 })}`;
const teamShort = (st: State, ti: 0 | 1) =>
  `${pname(st, { team: ti, player: 0 })} & ${pname(st, { team: ti, player: 1 })}`;

// Plural-Helfer
const bier = (n: number) => `${n} ${n === 1 ? "Bier" : "Biere"}`;
const muttern = (n: number) => `${n} ${n === 1 ? "Mutter" : "Muttern"}`;
const schluecke = (n: number) => `${n} ${n === 1 ? "Schluck" : "Schlücke"}`;
const eigentore = (n: number) => `${n} ${n === 1 ? "Eigentor" : "Eigentore"}`;

const teamSipsLeft = (st: State, ti: 0 | 1) =>
  st.teams[ti].players[0].bottleSips + st.teams[ti].players[1].bottleSips;
const teamSipsMax = (st: State, ti: 0 | 1) =>
  st.teams[ti].players[0].bottleSize + st.teams[ti].players[1].bottleSize;

// Smart-Default-Verteilung mit Berücksichtigung der Restmengen
function smartSplit(net: number, cap0: number, cap1: number): [number, number] {
  const total = cap0 + cap1;
  if (net >= total) return [cap0, cap1];
  // balanciert, dann clamp
  let a = Math.floor(net / 2);
  let b = net - a;
  if (net % 2 === 1 && Math.random() < 0.5) { const t = a; a = b; b = t; }
  if (a > cap0) { a = cap0; b = net - a; }
  if (b > cap1) { b = cap1; a = net - b; }
  if (a > cap0) { a = cap0; b = net - a; }
  return [a, b];
}

// Schlücke anwenden; Overflow → Teammate
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
      const other: 0 | 1 = (cur ^ 1) as 0 | 1;
      if (players[other].bottleSips > 0) cur = other;
      else break;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Theme & Sound (Sound default OFF)
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
  enabled: false,
  _ctx: null as AudioContext | null,
  ctx() {
    if (!this._ctx) {
      try { this._ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); }
      catch { return null; }
    }
    return this._ctx;
  },
  tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.06, when = 0) {
    if (!this.enabled) return;
    const c = this.ctx(); if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    const t = c.currentTime + when;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  },
  tap() { this.tone(620, 0.05, "triangle", 0.04); },
  hit() { this.tone(880, 0.08, "sine", 0.06); this.tone(1320, 0.10, "sine", 0.04, 0.04); },
  miss() { this.tone(220, 0.18, "sawtooth", 0.05); },
  confirm() { this.tone(700, 0.09, "sine", 0.06); this.tone(1050, 0.12, "sine", 0.05, 0.06); },
  mutter() {
    this.tone(160, 0.35, "sawtooth", 0.09);
    this.tone(110, 0.45, "square", 0.05, 0.05);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "sine", 0.06), i * 130));
  },
  back() { this.tone(420, 0.06, "triangle", 0.04); },
};

// ─────────────────────────────────────────────────────────────
// Bot AI
// ─────────────────────────────────────────────────────────────
function pick<T>(arr: T[], weights: number[]): T {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
}
function botShot(level: BotLevel): Shot {
  const mutterChance = level === "mittel" ? 0.02 : level === "gut" ? 0.05 : 0.08;
  if (Math.random() < mutterChance) return "M";
  const negChance = level === "mittel" ? 0.10 : level === "gut" ? 0.05 : 0.03;
  if (Math.random() < negChance) return pick([-1, -2, -3], [6, 3, 1]);
  if (level === "mittel") return pick([0, 1, 2, 3], [5, 4, 2, 1]);
  if (level === "gut") return pick([0, 1, 2, 3], [2, 3, 4, 3]);
  return pick([0, 1, 2, 3], [1, 2, 4, 5]);
}
function botSplit(net: number, cap0: number, cap1: number): [number, number] {
  // schlau: max ausschöpfen ohne overflow zu verschwenden
  let a = Math.min(cap0, Math.floor(net / 2));
  let b = net - a;
  if (b > cap1) { b = cap1; a = net - b; }
  if (a > cap0) { a = cap0; b = net - a; }
  return [Math.max(0, a), Math.max(0, b)];
}

// ─────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────
function Index() {
  const [state, setState] = useState<State>(initial);
  const [loaded, setLoaded] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
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
        {state.phase === "starterPick" && <StarterPick state={state} setState={setState} />}
        {state.phase === "ausschnippen" && <Ausschnippen state={state} setState={setState} />}
        {state.phase === "turn" && <TurnScreen state={state} setState={setState} />}
        {state.phase === "summary" && <Summary state={state} setState={setState} />}
        {state.phase === "winner" && <Winner state={state} setState={setState} />}
        {state.phase === "stats" && <Stats state={state} setState={setState} />}
        {state.phase === "training" && <Training state={state} setState={setState} />}
        {state.phase === "trainingEnd" && <TrainingEnd state={state} setState={setState} />}
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
  const canReset = state.phase !== "setup";

  const doReset = () => {
    if (!canReset) return;
    if (confirm("Wirklich komplett neu starten? Das aktuelle Spiel geht verloren.")) {
      sfx.back();
      setState(initial());
    }
  };

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-background/70 border-b border-border">
      <div className="mx-auto max-w-2xl px-4 py-2.5 flex items-center justify-between gap-2">
        <button onClick={doReset} className="flex items-center gap-2" aria-label="Leberschuss – zum Start">
          <img src={logo} alt="Leberschuss" className="h-9 w-auto" />
        </button>
        <div className="flex items-center gap-1">
          {canReset && (
            <Button variant="ghost" size="sm" onClick={doReset} aria-label="Neu starten" title="Komplett neu starten">
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          {inGame && state.rounds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setState(s => ({ ...s, prevPhase: s.phase, phase: "stats" }))}>
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
        <div key={ti} className="rounded-lg border border-border bg-card/70 px-3 py-2">
          <div className="flex items-center gap-2">
            <Beer className="h-4 w-4 text-primary shrink-0" />
            <div className="truncate font-medium leading-tight">{teamShort(state, ti)}</div>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
            {([0, 1] as const).map(pi => {
              const p = state.teams[ti].players[pi];
              return (
                <div key={pi} className="truncate">
                  {p.name || defaultName({ team: ti, player: pi })}: {p.emptied}/{Math.max(1, p.emptied + (p.bottleSips < p.bottleSize ? 1 : 1))} Bier
                </div>
              );
            })}
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
function snapshotTeams(t: State["teams"]): State["teams"] {
  return t.map(team => ({ players: team.players.map(p => ({ ...p })) as [PlayerStats, PlayerStats] })) as State["teams"];
}

// Seat-Labels für die feste Sitzordnung
const SEAT_LABEL: Record<string, string> = {
  "0-0": "Person 3 · diagonal gegenüber Person 2",
  "0-1": "Person 4 · diagonal gegenüber Person 1 (Host)",
  "1-0": "Person 1 · Host (du)",
  "1-1": "Person 2 · dein Teammitglied",
};

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
function Setup({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [mode, setMode] = useState<Mode>("fixed");
  const [pool, setPool] = useState(["", "", "", ""]);
  // Team 1 = Hostseite (intern ti=1), Team 2 = Gegnerseite (intern ti=0)
  // Reihenfolge im UI: Host, Teammate, dann Gegner Person 3, Person 4
  const [hostName, setHostName] = useState(state.teams[1].players[0].name);
  const [hostMate, setHostMate] = useState(state.teams[1].players[1].name);
  const [opp1, setOpp1] = useState(state.teams[0].players[1].name); // diag von Host
  const [opp2, setOpp2] = useState(state.teams[0].players[0].name); // diag von HostMate

  // Trainer
  const [trainerName, setTrainerName] = useState("");
  const [trainerSize, setTrainerSize] = useState(DEFAULT_BOTTLE);

  // Bot-Modus
  const [botLevel, setBotLevel] = useState<BotLevel>("gut");
  const [botName1, setBotName1] = useState("Bot Anna");
  const [botName2, setBotName2] = useState("Bot Ben");

  // Flaschengröße pro Spieler 3..5
  const [sizes, setSizes] = useState<[[number, number], [number, number]]>([
    [DEFAULT_BOTTLE, DEFAULT_BOTTLE], [DEFAULT_BOTTLE, DEFAULT_BOTTLE],
  ]);
  const setSize = (ti: 0 | 1, pi: 0 | 1, delta: number) => {
    const c = sizes.map(r => [...r]) as typeof sizes;
    c[ti][pi] = Math.min(5, Math.max(3, c[ti][pi] + delta));
    setSizes(c); sfx.tap();
  };

  const [shuffled, setShuffled] = useState<[[string, string], [string, string]] | null>(null);

  const doShuffle = () => {
    const clean = pool.map(n => n.trim()).filter(Boolean);
    if (clean.length !== 4) { toast.error("Bitte 4 Namen eingeben"); return; }
    const shuf = [...clean].sort(() => Math.random() - 0.5);
    setShuffled([[shuf[0], shuf[1]], [shuf[2], shuf[3]]]);
    toast.success("Teams zufällig zugeteilt");
  };

  const buildFixedTeams = (): State["teams"] | null => {
    if (![hostName, hostMate, opp1, opp2].every(n => n.trim())) {
      toast.error("Bitte alle Namen ausfüllen"); return null;
    }
    return [
      { players: [
        freshP(opp2, { bottleSize: sizes[0][0], bottleSips: sizes[0][0] }),
        freshP(opp1, { bottleSize: sizes[0][1], bottleSips: sizes[0][1] }),
      ] },
      { players: [
        freshP(hostName, { bottleSize: sizes[1][0], bottleSips: sizes[1][0] }),
        freshP(hostMate, { bottleSize: sizes[1][1], bottleSips: sizes[1][1] }),
      ] },
    ];
  };

  const buildRandomTeams = (): State["teams"] | null => {
    if (!shuffled) { toast.error("Erst auslosen"); return null; }
    return [
      { players: [
        freshP(shuffled[0][0], { bottleSize: sizes[0][0], bottleSips: sizes[0][0] }),
        freshP(shuffled[0][1], { bottleSize: sizes[0][1], bottleSips: sizes[0][1] }),
      ] },
      { players: [
        freshP(shuffled[1][0], { bottleSize: sizes[1][0], bottleSips: sizes[1][0] }),
        freshP(shuffled[1][1], { bottleSize: sizes[1][1], bottleSips: sizes[1][1] }),
      ] },
    ];
  };

  const buildBotTeams = (): State["teams"] => {
    // Host + imaginärer Teammate (vom User gesteuert), gegen 2 Bots
    return [
      { players: [
        freshP(botName1 || "Bot 1", { bottleSize: DEFAULT_BOTTLE, bottleSips: DEFAULT_BOTTLE, isBot: true, botLevel }),
        freshP(botName2 || "Bot 2", { bottleSize: DEFAULT_BOTTLE, bottleSips: DEFAULT_BOTTLE, isBot: true, botLevel }),
      ] },
      { players: [
        freshP(hostName || "Du", { bottleSize: sizes[1][0], bottleSips: sizes[1][0] }),
        freshP(hostMate || "Imaginär", { bottleSize: sizes[1][1], bottleSips: sizes[1][1] }),
      ] },
    ];
  };

  const startGame = (target: "starterPick" | "ausschnippen") => {
    let teams: State["teams"] | null = null;
    if (mode === "fixed") teams = buildFixedTeams();
    else if (mode === "random") teams = buildRandomTeams();
    else if (mode === "bots") teams = buildBotTeams();
    if (!teams) return;
    sfx.confirm();
    setState(() => ({
      ...initial(),
      teams,
      mode,
      phase: target,
    }));
  };

  const startTraining = () => {
    if (!trainerName.trim()) { toast.error("Bitte Namen eingeben"); return; }
    sfx.confirm();
    setState(() => ({
      ...initial(),
      mode: "training",
      teams: [
        { players: [freshP(""), freshP("")] },
        { players: [freshP(trainerName, { bottleSize: trainerSize, bottleSips: trainerSize }), freshP("")] },
      ],
      phase: "training",
    }));
  };

  return (
    <div className="space-y-5 pt-5 anim-slide">
      <div className="text-center space-y-1">
        <h1 className="text-3xl font-semibold">Neues Spiel</h1>
        <p className="text-sm text-muted-foreground">Modus wählen & los geht's</p>
      </div>

      <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-muted">
        {([
          ["fixed", Users, "Feste Teams"],
          ["random", Shuffle, "Zufällig"],
          ["bots", Bot, "Vs Bots"],
          ["training", Dumbbell, "Training"],
        ] as const).map(([m, Icon, label]) => (
          <button key={m} onClick={() => { setMode(m); sfx.tap(); }}
            className={"flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-all " +
              (mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === "fixed" && (
        <FixedSetup
          hostName={hostName} setHostName={setHostName}
          hostMate={hostMate} setHostMate={setHostMate}
          opp1={opp1} setOpp1={setOpp1} opp2={opp2} setOpp2={setOpp2}
          sizes={sizes} setSize={setSize}
        />
      )}

      {mode === "random" && (
        <RandomSetup pool={pool} setPool={setPool} shuffled={shuffled} doShuffle={doShuffle}
          sizes={sizes} setSize={setSize} />
      )}

      {mode === "bots" && (
        <BotSetup hostName={hostName} setHostName={setHostName}
          hostMate={hostMate} setHostMate={setHostMate}
          botName1={botName1} setBotName1={setBotName1}
          botName2={botName2} setBotName2={setBotName2}
          botLevel={botLevel} setBotLevel={setBotLevel}
          sizes={sizes} setSize={setSize} />
      )}

      {mode === "training" && (
        <Card className="p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Training</div>
          <p className="text-xs text-muted-foreground">
            Schnipp unbegrenzt und tracke deine Treffer. Beende das Training, um deine Statistik zu sehen.
          </p>
          <Input value={trainerName} onChange={e => setTrainerName(e.target.value)} placeholder="Dein Name" />
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2">
            <div className="text-xs text-muted-foreground">Flaschengröße (Schlücke)</div>
            <SizePicker value={trainerSize} onChange={v => setTrainerSize(v)} />
          </div>
        </Card>
      )}

      {mode !== "training" ? (
        <div className="space-y-2">
          <Button size="lg" className="w-full text-base" onClick={() => startGame("starterPick")}>
            Spiel starten
          </Button>
          <Button size="lg" variant="outline" className="w-full text-base" onClick={() => startGame("ausschnippen")}>
            Ausschnippen wurde geext
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Klick „Ausschnippen wurde geext" <b>nur</b>, wenn beim Aufstellen der Flaschen eine Mutter getroffen wurde und ihr deshalb extra exen musstet.
          </p>
        </div>
      ) : (
        <Button size="lg" className="w-full text-base" onClick={startTraining}>Training starten</Button>
      )}
    </div>
  );
}

function SizePicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="icon" variant="outline" onClick={() => onChange(Math.max(3, value - 1))}>
        <Minus className="h-4 w-4" />
      </Button>
      <div className="text-lg font-semibold tabular-nums w-6 text-center">{value}</div>
      <Button size="icon" variant="outline" onClick={() => onChange(Math.min(5, value + 1))}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FixedSetup(props: {
  hostName: string; setHostName: (v: string) => void;
  hostMate: string; setHostMate: (v: string) => void;
  opp1: string; setOpp1: (v: string) => void;
  opp2: string; setOpp2: (v: string) => void;
  sizes: [[number, number], [number, number]];
  setSize: (ti: 0 | 1, pi: 0 | 1, delta: number) => void;
}) {
  const { hostName, setHostName, hostMate, setHostMate, opp1, setOpp1, opp2, setOpp2, sizes, setSize } = props;
  return (
    <Card className="p-4 space-y-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Sitzplätze</div>
      <p className="text-[11px] text-muted-foreground">
        Person 1 = Host (du). Person 2 = dein Teammitglied. Person 3 sitzt diagonal gegenüber Person 2.
        Person 4 sitzt diagonal gegenüber dem Host.
      </p>

      <SeatField
        person={1} label="Host (du) · Team 1"
        name={hostName} onChange={setHostName}
        size={sizes[1][0]} onSize={(d) => setSize(1, 0, d)}
        highlight
      />
      <SeatField
        person={2} label="Dein Teammitglied · Team 1"
        name={hostMate} onChange={setHostMate}
        size={sizes[1][1]} onSize={(d) => setSize(1, 1, d)}
        highlight
      />
      <SeatField
        person={3} label="Gegner · diagonal zu Person 2 · Team 2"
        name={opp1} onChange={setOpp1}
        size={sizes[0][1]} onSize={(d) => setSize(0, 1, d)}
      />
      <SeatField
        person={4} label="Gegner · diagonal zu Person 1 · Team 2"
        name={opp2} onChange={setOpp2}
        size={sizes[0][0]} onSize={(d) => setSize(0, 0, d)}
      />
    </Card>
  );
}

function SeatField({ person, label, name, onChange, size, onSize, highlight }: {
  person: number; label: string; name: string; onChange: (v: string) => void;
  size: number; onSize: (d: number) => void; highlight?: boolean;
}) {
  return (
    <div className={"rounded-lg border p-2.5 space-y-2 " + (highlight ? "border-primary/50 bg-primary/5" : "border-border")}>
      <div className="text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Person {person}</span> · {label}
      </div>
      <Input value={name} placeholder={`Person ${person}`} onChange={e => onChange(e.target.value)} />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Schlücke pro Flasche</span>
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onSize(-1)}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <div className="font-semibold tabular-nums w-5 text-center">{size}</div>
          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => onSize(+1)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function RandomSetup(props: {
  pool: string[]; setPool: (v: string[]) => void;
  shuffled: [[string, string], [string, string]] | null;
  doShuffle: () => void;
  sizes: [[number, number], [number, number]];
  setSize: (ti: 0 | 1, pi: 0 | 1, delta: number) => void;
}) {
  const { pool, setPool, shuffled, doShuffle, sizes, setSize } = props;
  return (
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
        <p className="text-[11px] text-muted-foreground">
          Sitzordnung: Person 1 sitzt z.B. unten links — Person 2 (Teammate) unten rechts —
          Person 3 oben links (diagonal zu Person 2) — Person 4 oben rechts (diagonal zu Person 1).
          Solange die Diagonalen stimmen, ist es egal wer wo sitzt.
        </p>
      </Card>
      {shuffled && (
        <Card className="p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Ausgeloste Teams</div>
          {([0, 1] as const).map(ti => (
            <div key={ti} className="rounded-lg border border-border p-2 space-y-2">
              <div className="text-[11px] text-muted-foreground">Team {ti + 1}</div>
              {([0, 1] as const).map(pi => (
                <div key={pi} className="flex items-center justify-between gap-2">
                  <div className="text-sm truncate">{shuffled[ti][pi]}</div>
                  <div className="flex items-center gap-1.5">
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setSize(ti, pi, -1)}>
                      <Minus className="h-3.5 w-3.5" />
                    </Button>
                    <div className="font-semibold tabular-nums w-5 text-center text-xs">{sizes[ti][pi]}</div>
                    <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setSize(ti, pi, +1)}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function BotSetup(props: {
  hostName: string; setHostName: (v: string) => void;
  hostMate: string; setHostMate: (v: string) => void;
  botName1: string; setBotName1: (v: string) => void;
  botName2: string; setBotName2: (v: string) => void;
  botLevel: BotLevel; setBotLevel: (v: BotLevel) => void;
  sizes: [[number, number], [number, number]];
  setSize: (ti: 0 | 1, pi: 0 | 1, delta: number) => void;
}) {
  const { hostName, setHostName, hostMate, setHostMate, botName1, setBotName1, botName2, setBotName2,
    botLevel, setBotLevel, sizes, setSize } = props;
  return (
    <Card className="p-4 space-y-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Vs Bots</div>
      <p className="text-[11px] text-muted-foreground">
        Du spielst alleine — du schnippst pro Runde 2× (für dich & deinen imaginären Mitspieler). Die Bots schnippen automatisch.
      </p>
      <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-muted">
        {(["mittel", "gut", "extrem"] as const).map(l => (
          <button key={l} onClick={() => { setBotLevel(l); sfx.tap(); }}
            className={"rounded-md py-2 text-xs font-medium capitalize transition-all " +
              (botLevel === l ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {l}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <SeatField person={1} label="Du · Team 1" name={hostName} onChange={setHostName}
          size={sizes[1][0]} onSize={d => setSize(1, 0, d)} highlight />
        <SeatField person={2} label="Imaginärer Mitspieler · Team 1" name={hostMate} onChange={setHostMate}
          size={sizes[1][1]} onSize={d => setSize(1, 1, d)} highlight />
        <div className="rounded-lg border border-border p-2.5 space-y-2">
          <div className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Person 3</span> · Bot · diagonal zu Person 2
          </div>
          <Input value={botName1} onChange={e => setBotName1(e.target.value)} placeholder="Bot Name" />
        </div>
        <div className="rounded-lg border border-border p-2.5 space-y-2">
          <div className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Person 4</span> · Bot · diagonal zu Person 1
          </div>
          <Input value={botName2} onChange={e => setBotName2(e.target.value)} placeholder="Bot Name" />
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// StarterPick
// ─────────────────────────────────────────────────────────────
function StarterPick({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [pick, setPick] = useState<PlayerRef>(state.originalStarter);
  return (
    <div className="space-y-5 pt-5 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setState(s => ({ ...s, phase: "setup" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" />Zurück
        </Button>
        <div className="text-sm font-medium">Wer fängt an?</div>
        <div className="w-16" />
      </div>
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {([1, 0] as const).flatMap(ti => ([0, 1] as const).map(pi => {
            const ref = { team: ti, player: pi };
            const sel = pick.team === ti && pick.player === pi;
            const p = state.teams[ti].players[pi];
            return (
              <button key={`${ti}-${pi}`} onClick={() => { setPick(ref); sfx.tap(); }}
                className={"rounded-lg border px-3 py-3 text-sm font-medium transition-all text-left " +
                  (sel ? "border-primary bg-primary/15 anim-pop" : "border-border hover:bg-accent/40")}>
                <div className="truncate">{p.name || defaultName(ref)}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Team {ti === 1 ? 1 : 2}{p.isBot ? " · Bot" : ""}
                </div>
              </button>
            );
          }))}
        </div>
      </Card>
      <Button size="lg" className="w-full" onClick={() => {
        sfx.confirm();
        setState(s => ({ ...s, originalStarter: pick, phase: "turn", turnIdx: 0, pendingShots: {} }));
      }}>
        Los geht's
      </Button>
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
      const teams = snapshotTeams(s.teams);
      ([0, 1] as const).forEach(ti => {
        const teamM = mut[ti][0] + mut[ti][1];
        if (teamM > 0) {
          const opp: 0 | 1 = (ti ^ 1) as 0 | 1;
          teams[opp].players.forEach(p => { p.emptied += teamM; });
        }
      });
      // Auch in Spieler-Stats:
      ([0, 1] as const).forEach(ti => ([0, 1] as const).forEach(pi => {
        teams[ti].players[pi].mutterHits += mut[ti][pi];
      }));
      return { ...s, teams, ausschnippenMutter: mut, phase: "starterPick" };
    });
    sfx.confirm();
  };

  const total = (ti: 0 | 1) => mut[ti][0] + mut[ti][1];
  const setVal = (ti: 0 | 1, pi: 0 | 1, v: number) => {
    const c = mut.map(r => [...r]) as typeof mut;
    c[ti][pi] = Math.max(0, v);
    setMut(c); sfx.tap();
  };

  return (
    <div className="space-y-5 pt-5 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setState(s => ({ ...s, phase: "setup" }))}>
          <ArrowLeft className="h-4 w-4 mr-1" />Zurück
        </Button>
        <div className="text-sm font-medium">Ausschnippen — Muttern?</div>
        <div className="w-16" />
      </div>

      <Card className="p-3 bg-mutter/10 border-mutter/30 text-sm space-y-1">
        <div className="font-semibold text-mutter">Nur Muttern eintragen!</div>
        <div className="text-xs text-muted-foreground">
          Hier zählen <b>ausschließlich getroffene Muttern</b> beim Ausschnippen.
          Normale Schlücke werden hier <b>nicht</b> erfasst. Pro Mutter ext jeder Gegner 1 Bier extra.
        </div>
      </Card>

      <div className="space-y-3">
        {([0, 1] as const).map(ti => (
          <Card key={ti} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{teamShort(state, ti)}</div>
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

      <Button className="w-full" onClick={apply}>Übernehmen & Starter wählen</Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Turn
// ─────────────────────────────────────────────────────────────
function TurnScreen({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const roundIdx = state.rounds.length;
  const starter = useMemo(() => starterOfRound(state.originalStarter, roundIdx), [state.originalStarter, roundIdx]);
  const order = useMemo(() => turnOrder(starter), [starter]);
  const ref = order[state.turnIdx];
  const player = state.teams[ref.team].players[ref.player];
  const [flash, setFlash] = useState<Shot | null>(null);

  // Bot-automatisch schnippen
  useEffect(() => {
    if (player.isBot && player.botLevel) {
      const v = botShot(player.botLevel);
      const id = setTimeout(() => setShot(v), 700);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.turnIdx, roundIdx]);

  const setShot = (val: Shot) => {
    setFlash(val);
    if (val === "M") sfx.mutter();
    else if (typeof val === "number" && val > 0) sfx.hit();
    else if (typeof val === "number" && val < 0) sfx.miss();
    else sfx.tap();

    const nextShots = { ...state.pendingShots, [k(ref)]: val };
    const nextIdx = state.turnIdx + 1;
    setTimeout(() => {
      setFlash(null);
      if (nextIdx >= 4) {
        setState(s => ({ ...s, pendingShots: nextShots, phase: "summary", redoShot: null, redoFromSummary: false }));
      } else {
        setState(s => ({ ...s, pendingShots: nextShots, turnIdx: nextIdx, redoShot: null }));
      }
    }, 350);
  };

  const back = () => {
    sfx.back();
    if (state.turnIdx === 0) {
      if (state.rounds.length === 0) {
        setState(s => ({ ...s, phase: "starterPick" }));
      } else {
        undoLastRound(setState);
      }
      return;
    }
    const prevRef = order[state.turnIdx - 1];
    const prevVal = state.pendingShots[k(prevRef)];
    const next = { ...state.pendingShots };
    delete next[k(prevRef)];
    setState(s => ({
      ...s, turnIdx: s.turnIdx - 1, pendingShots: next,
      redoShot: prevVal !== undefined ? { ref: prevRef, value: prevVal } : null,
    }));
  };

  const forward = () => {
    if (!state.redoShot) return;
    sfx.tap();
    setShot(state.redoShot.value);
  };

  // Aktuelle Team-Differenz (was wurde in dieser Runde schon erzielt)
  const teamSum = (ti: 0 | 1) => order.reduce<number>((n, r) => {
    if (r.team !== ti) return n;
    const v = state.pendingShots[k(r)];
    return n + (typeof v === "number" ? v : 0);
  }, 0);
  const myTeam = ref.team;
  const oppTeam: 0 | 1 = (myTeam ^ 1) as 0 | 1;
  const myCurrent = teamSum(myTeam);
  const oppCurrent = teamSum(oppTeam);
  const myRemaining = teamSipsLeft(state, myTeam);

  const hintText = (() => {
    // Diff falls Gegner mehr Punkte hat
    const diff = oppCurrent - myCurrent;
    if (diff > 0) return `Trefft mind. ${diff}, um nicht zu trinken`;
    if (diff < 0) return `Gegner braucht ${Math.abs(diff)}, um nicht zu trinken`;
    return `Gleichstand — jeder Treffer zählt`;
  })();

  const isBot = !!player.isBot;

  return (
    <div className="pt-4 space-y-4 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={back}><ArrowLeft className="h-4 w-4 mr-1" />Zurück</Button>
        <div className="text-xs text-muted-foreground">Runde {roundIdx + 1} · Schuss {state.turnIdx + 1}/4</div>
        {state.redoShot ? (
          <Button variant="ghost" size="sm" onClick={forward}>Vor<ArrowRight className="h-4 w-4 ml-1" /></Button>
        ) : <div className="w-16" />}
      </div>

      <Card className="p-5 text-center space-y-1 anim-pop">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">Am Zug</div>
        <div className="text-3xl font-semibold">{player.name || defaultName(ref)}</div>
        <div className="text-xs text-muted-foreground">
          Team {ref.team === 1 ? 1 : 2}{isBot ? ` · Bot (${player.botLevel})` : ""} · noch {schluecke(myRemaining)} im Team
        </div>
        <div className="text-[11px] text-primary pt-1">{hintText}</div>
      </Card>

      {isBot ? (
        <Card className="p-6 text-center text-sm text-muted-foreground anim-pop">
          {flash !== null ? (
            <div className="text-3xl font-bold text-primary">
              {flash === "M" ? "MUTTER" : flash}
            </div>
          ) : (
            <>Bot überlegt…</>
          )}
        </Card>
      ) : (
        <Card className="p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {[3, 2, 1].map(v => (
              <ShotButton key={v} value={v} active={flash === v} onClick={() => setShot(v)} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ShotButton value={0} active={flash === 0} onClick={() => setShot(0)} />
            <button onClick={() => setShot("M")}
              className={"py-5 rounded-xl text-white text-xl font-bold tracking-wider shadow-lg transition-all anim-glow " +
                (flash === "M" ? "bg-mutter scale-95 brightness-125" : "bg-mutter hover:brightness-110 active:scale-95")}>
              MUTTER
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[-1, -2, -3].map(v => (
              <ShotButton key={v} value={v} active={flash === v} onClick={() => setShot(v)} negative />
            ))}
          </div>
        </Card>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none text-center">Feldübersicht</summary>
        <div className="mt-2 flex justify-center">
          <img src={field} alt="Spielfeld" className="h-48 w-auto rounded-md opacity-80" />
        </div>
      </details>
    </div>
  );
}

function ShotButton({ value, onClick, negative, active }: { value: Shot; onClick: () => void; negative?: boolean; active?: boolean }) {
  const label = value === 0 ? "0" : String(value);
  const base = "py-5 rounded-xl text-2xl font-bold border-2 transition-all active:scale-95 ";
  const idle = negative
    ? "border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10"
    : value === 0
      ? "border-border bg-muted hover:bg-accent/40"
      : "border-primary/50 bg-primary/10 hover:bg-primary/20 text-foreground";
  const hot = negative
    ? "border-destructive bg-destructive/30 text-destructive scale-95 brightness-110"
    : value === 0
      ? "border-foreground bg-accent scale-95"
      : "border-primary bg-primary/40 text-foreground scale-95 brightness-110";
  return (
    <button onClick={onClick} className={base + (active ? hot : idle)}>{label}</button>
  );
}

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────
function Summary({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const roundIdx = state.rounds.length;
  const starter = useMemo(() => starterOfRound(state.originalStarter, roundIdx), [state.originalStarter, roundIdx]);
  const order = useMemo(() => turnOrder(starter), [starter]);
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

  const cap = (ti: 0 | 1, pi: 0 | 1) => state.teams[ti].players[pi].bottleSips;

  const [split, setSplit] = useState<[number, number]>(() => {
    if (drinking === null) return [0, 0];
    const cap0 = cap(drinking, 0), cap1 = cap(drinking, 1);
    const isBotTeam = state.teams[drinking].players.every(p => p.isBot);
    return isBotTeam ? botSplit(net, cap0, cap1) : smartSplit(net, cap0, cap1);
  });

  const checkEnd = (s: State): boolean =>
    ([0, 1] as const).some(ti => s.teams[ti].players[0].bottleSips === 0 && s.teams[ti].players[1].bottleSips === 0);

  const apply = () => {
    setState(s => {
      const prevTeams = snapshotTeams(s.teams);
      const prevAus = JSON.parse(JSON.stringify(s.ausschnippenMutter));
      const teams = snapshotTeams(s.teams);

      const drinksByPlayer: [[number, number], [number, number]] = [[0, 0], [0, 0]];

      ([0, 1] as const).forEach(ti => ([0, 1] as const).forEach(pi => {
        const v = shots[`${ti}-${pi}`];
        const p = teams[ti].players[pi];
        p.roundsPlayed += 1;
        if (v === "M") p.mutterHits += 1;
        else if (typeof v === "number") { p.shotsTotal += v; if (v < 0) p.ownGoals += 1; }
      }));

      if (drinking !== null && applyNormal) {
        drinksByPlayer[drinking] = [split[0], split[1]];
        ([0, 1] as const).forEach(pi => drinkSips(teams[drinking].players, pi, split[pi]));
      }
      if (mutterEffective !== null) {
        teams[mutterEffective].players.forEach(p => {
          p.emptied += 1;
          p.bottleSips = p.bottleSize;
        });
      }

      const round: Round = {
        shots: { ...shots },
        drinksByPlayer,
        mutterCount: [mA, mB],
        mutterEffective,
        totals: [tA, tB],
        starter,
        prevTeams, prevAusschnippen: prevAus,
      };

      const next: State = {
        ...s,
        teams,
        rounds: [...s.rounds, round],
        pendingShots: {},
        turnIdx: 0,
        phase: "turn",
        redoShot: null,
        redoFromSummary: false,
      };

      if (checkEnd(next)) next.phase = "winner";
      return next;
    });
    if (mutterEffective !== null) sfx.mutter(); else sfx.confirm();
  };

  const splitSum = split[0] + split[1];
  const maxNet = Math.min(net, cap(drinking ?? 0, 0) + cap(drinking ?? 0, 1));
  const splitOK = drinking === null || splitSum === maxNet;

  const setPlayerSips = (pi: 0 | 1, delta: number) => {
    if (drinking === null) return;
    const cap0 = cap(drinking, 0), cap1 = cap(drinking, 1);
    const other: 0 | 1 = (pi ^ 1) as 0 | 1;
    const c: [number, number] = [split[0], split[1]];
    const capMe = pi === 0 ? cap0 : cap1;
    const capOther = other === 0 ? cap0 : cap1;
    const newVal = Math.max(0, Math.min(capMe, c[pi] + delta));
    c[pi] = newVal;
    c[other] = Math.max(0, Math.min(capOther, maxNet - c[pi]));
    setSplit(c); sfx.tap();
  };

  const back = () => {
    sfx.back();
    setState(s => ({
      ...s, phase: "turn", turnIdx: 3,
      // redo erlaubt → letzten Wert ist eh in pendingShots, kein Datenverlust
      redoFromSummary: true,
    }));
  };

  return (
    <div className="pt-4 space-y-4 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={back}>
          <ArrowLeft className="h-4 w-4 mr-1" />Zurück
        </Button>
        <div className="text-sm font-medium">Runde {roundIdx + 1}</div>
        <div className="w-16" />
      </div>

      <Card className="p-4 space-y-3">
        {order.map((r, i) => {
          const v = shots[k(r)];
          const isM = v === "M";
          return (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="font-medium">{pname(state, r)} <span className="text-[10px] text-muted-foreground">T{r.team === 1 ? 1 : 2}</span></span>
              <span className={"px-2.5 py-1 rounded-md font-semibold " +
                (isM ? "bg-mutter text-white" : v === 0 ? "bg-muted text-muted-foreground" :
                  (v as number) > 0 ? "bg-primary/20" : "bg-destructive/15 text-destructive")}>
                {isM ? "Mutter" : v}
              </span>
            </div>
          );
        })}
      </Card>

      {(mutterEffective !== null || (mA > 0 && mB > 0) || (applyNormal && net === 0)) && (
        <Card className="p-4 space-y-2">
          {mutterEffective !== null ? (
            <div className="text-center space-y-1">
              <div className="text-mutter font-bold text-lg">Mutter!</div>
              <div className="text-sm">{teamShort(state, mutterEffective)} muss exen — neue Flaschen</div>
              {(mA > 0 && mB > 0) && <div className="text-xs text-muted-foreground">({mA} vs {mB})</div>}
            </div>
          ) : mA > 0 && mB > 0 ? (
            <div className="text-center text-sm">
              <span className="text-mutter font-medium">Muttern ausgeglichen</span> — keine Wirkung
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground">Gleichstand — niemand trinkt</div>
          )}
        </Card>
      )}

      {drinking !== null && (
        <Card className="p-4 space-y-3">
          <div className="text-center text-sm">
            <span className="font-semibold">{teamShort(state, drinking)}</span> trinkt{" "}
            <span className="font-bold text-primary">{schluecke(maxNet)}</span>
            {maxNet < net && <span className="text-xs text-muted-foreground"> (nur {maxNet} Plätze frei)</span>}
          </div>
          <div className="text-xs text-muted-foreground text-center">Verteilung anpassen:</div>
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
            Summe {splitSum} / {maxNet}
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
    return {
      ...s,
      teams: snapshotTeams(last.prevTeams),
      ausschnippenMutter: last.prevAusschnippen,
      rounds: s.rounds.slice(0, -1),
      pendingShots: last.shots,
      turnIdx: 3,
      phase: "turn",
      redoShot: null,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Winner
// ─────────────────────────────────────────────────────────────
function Winner({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  useEffect(() => { sfx.win(); }, []);

  const loserTeam: 0 | 1 | null =
    state.teams[0].players[0].bottleSips === 0 && state.teams[0].players[1].bottleSips === 0 ? 0 :
    state.teams[1].players[0].bottleSips === 0 && state.teams[1].players[1].bottleSips === 0 ? 1 : null;
  const winnerTeam: 0 | 1 | null = loserTeam === null ? null : (loserTeam ^ 1) as 0 | 1;

  // Verlierer ext +1 Bier pro Mitglied (das letzte aktuelle Getränk)
  const finalized = useMemo(() => {
    if (loserTeam === null) return state;
    const teams = snapshotTeams(state.teams);
    teams[loserTeam].players.forEach(p => { p.emptied += 1; });
    return { ...state, teams };
  }, [loserTeam, state]);

  const beer = beerCounts(finalized);
  const { mvps, ankers } = computeMvpAnker(finalized);

  const back = () => { sfx.back(); setState(s => ({ ...s, phase: "summary" })); };

  const nochmal = () =>
    setState(s => ({
      ...s,
      teams: s.teams.map(t => ({
        players: t.players.map(p => freshP(p.name, { bottleSize: p.bottleSize, bottleSips: p.bottleSize, isBot: p.isBot, botLevel: p.botLevel })) as [PlayerStats, PlayerStats],
      })) as State["teams"],
      rounds: [], ausschnippenMutter: [[0, 0], [0, 0]],
      pendingShots: {}, turnIdx: 0,
      phase: "starterPick",
      redoShot: null, redoFromSummary: false,
    }));

  const newTeams = () => {
    if (confirm("Neue Teams erstellen? Aktuelle Aufstellung wird verworfen.")) setState(() => ({ ...initial() }));
  };

  const fmt = (arr: { name: string; team: 0 | 1; score: number }[]) =>
    arr.map(a => `${a.name} (Team ${a.team === 1 ? 1 : 2})`).join(" & ");

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
          : `${finalized.teams[winnerTeam].players[0].name} & ${finalized.teams[winnerTeam].players[1].name} gewinnen!`}
      </h2>
      <div className="text-sm text-muted-foreground">
        {bier(beer[0])} : {bier(beer[1])}
      </div>
      {loserTeam !== null && (
        <div className="text-xs text-mutter">
          {teamShort(finalized, loserTeam)} muss noch je 1 Bier exen — wurde bereits angerechnet.
        </div>
      )}

      <Card className="p-4 space-y-3 text-left">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">MVP{mvps.length > 1 ? "s" : ""}</div>
          <div className="text-sm font-semibold">{mvps.length ? fmt(mvps) : "—"}</div>
          {mvps.length > 0 && (
            <div className="text-[11px] text-muted-foreground">Ø {mvps[0].score.toFixed(2)} pro Runde</div>
          )}
        </div>
        <div className="border-t border-border" />
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Anker</div>
          <div className="text-sm font-semibold">{ankers.length ? fmt(ankers) : "—"}</div>
          {ankers.length > 0 && (
            <div className="text-[11px] text-muted-foreground">Ø {ankers[0].score.toFixed(2)} pro Runde</div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" onClick={() => setState(s => ({ ...s, prevPhase: "winner", phase: "stats" }))}>
          <BarChart3 className="h-4 w-4 mr-1" />Stats
        </Button>
        <Button onClick={nochmal}>Nochmal</Button>
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
      score: p.roundsPlayed ? (p.shotsTotal + p.mutterHits * 4) / p.roundsPlayed : 0,
      rounds: p.roundsPlayed,
    }))
  );
  const played = all.filter(a => a.rounds > 0);
  if (!played.length) return { mvps: [], ankers: [] };
  const best = Math.max(...played.map(a => a.score));
  const worst = Math.min(...played.map(a => a.score));
  return { mvps: played.filter(a => a.score === best), ankers: played.filter(a => a.score === worst) };
}

// ─────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────
function Stats({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const back = () => {
    sfx.back();
    setState(s => ({ ...s, phase: s.prevPhase ?? (s.rounds.length ? "turn" : "setup"), prevPhase: null }));
  };
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
            <div className="text-xs text-muted-foreground truncate">{teamShort(state, ti)}</div>
            <div className="text-2xl font-semibold">{bier(beer[ti])}</div>
            <div className="text-xs text-muted-foreground">
              {muttern(totalMutter(state, ti))} · {teamSipsLeft(state, ti)}/{teamSipsMax(state, ti)} Schlücke übrig
            </div>
          </Card>
        ))}
      </div>

      <Card className="divide-y divide-border">
        {([0, 1] as const).flatMap(ti => state.teams[ti].players.map((p, pi) => (
          <div key={`${ti}-${pi}`} className="p-3 grid grid-cols-5 gap-2 items-center text-sm">
            <div className="col-span-2 font-medium truncate">
              {p.name || defaultName({ team: ti, player: pi as 0 | 1 })}{" "}
              <span className="text-[10px] text-muted-foreground">Team {ti === 1 ? 1 : 2}</span>
            </div>
            <Stat label="Ø/Runde" value={p.roundsPlayed ? ((p.shotsTotal + p.mutterHits * 4) / p.roundsPlayed).toFixed(1) : "0"} />
            <Stat label="Muttern" value={p.mutterHits} />
            <Stat label="Eigentor" value={p.ownGoals} />
          </div>
        )))}
      </Card>

      <div className="text-xs text-muted-foreground text-center">
        Runden: {state.rounds.length}
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

// ─────────────────────────────────────────────────────────────
// Training
// ─────────────────────────────────────────────────────────────
function Training({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const p = state.teams[1].players[0];
  const [flash, setFlash] = useState<Shot | null>(null);

  const addShot = (v: Shot) => {
    setFlash(v);
    if (v === "M") sfx.mutter();
    else if (typeof v === "number" && v > 0) sfx.hit();
    else if (typeof v === "number" && v < 0) sfx.miss();
    else sfx.tap();

    setTimeout(() => setFlash(null), 350);
    setState(s => ({ ...s, trainingShots: [...s.trainingShots, v] }));
  };

  const undo = () => {
    sfx.back();
    setState(s => ({ ...s, trainingShots: s.trainingShots.slice(0, -1) }));
  };

  const end = () => { sfx.confirm(); setState(s => ({ ...s, phase: "trainingEnd" })); };

  const stats = useMemo(() => {
    const nums = state.trainingShots.filter(v => typeof v === "number") as number[];
    const mutter = state.trainingShots.filter(v => v === "M").length;
    const sum = nums.reduce((a, b) => a + b, 0);
    return {
      count: state.trainingShots.length,
      mutter,
      avg: state.trainingShots.length ? (sum + mutter * 4) / state.trainingShots.length : 0,
    };
  }, [state.trainingShots]);

  return (
    <div className="pt-4 space-y-4 anim-slide">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={undo}><ArrowLeft className="h-4 w-4 mr-1" />Letzten</Button>
        <div className="text-sm font-medium">Training · {p.name}</div>
        <div className="w-16" />
      </div>

      <Card className="p-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Würfe" value={stats.count} />
        <Stat label="Muttern" value={stats.mutter} />
        <Stat label="Ø/Wurf" value={stats.avg.toFixed(2)} />
      </Card>

      <Card className="p-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[3, 2, 1].map(v => (
            <ShotButton key={v} value={v} active={flash === v} onClick={() => addShot(v)} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ShotButton value={0} active={flash === 0} onClick={() => addShot(0)} />
          <button onClick={() => addShot("M")}
            className={"py-5 rounded-xl text-white text-xl font-bold tracking-wider shadow-lg transition-all anim-glow " +
              (flash === "M" ? "bg-mutter scale-95 brightness-125" : "bg-mutter hover:brightness-110 active:scale-95")}>
            MUTTER
          </button>
        </div>
      </Card>

      <Button className="w-full" variant="default" onClick={end}>Training beenden</Button>
    </div>
  );
}

function TrainingEnd({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const p = state.teams[1].players[0];
  const nums = state.trainingShots.filter(v => typeof v === "number") as number[];
  const mutter = state.trainingShots.filter(v => v === "M").length;
  const sum = nums.reduce((a, b) => a + b, 0);
  const ownGoals = nums.filter(v => v < 0).length;
  const hits3 = nums.filter(v => v === 3).length;
  const avg = state.trainingShots.length ? (sum + mutter * 4) / state.trainingShots.length : 0;

  useEffect(() => { sfx.win(); }, []);

  return (
    <div className="pt-4 space-y-4 text-center anim-slide">
      <Trophy className="h-14 w-14 text-primary mx-auto anim-pop" />
      <h2 className="text-2xl font-semibold">Training beendet</h2>
      <p className="text-sm text-muted-foreground">{p.name}</p>

      <Card className="p-4 grid grid-cols-2 gap-3 text-left">
        <Stat label="Würfe" value={state.trainingShots.length} />
        <Stat label="Ø/Wurf" value={avg.toFixed(2)} />
        <Stat label="Muttern" value={muttern(mutter)} />
        <Stat label="3er Treffer" value={hits3} />
        <Stat label="Eigentore" value={eigentore(ownGoals)} />
        <Stat label="Summe" value={sum} />
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => setState(s => ({ ...s, trainingShots: [], phase: "training" }))}>
          Nochmal
        </Button>
        <Button onClick={() => setState(() => initial())}>Hauptmenü</Button>
      </div>
    </div>
  );
}
