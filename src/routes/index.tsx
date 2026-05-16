import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import { Beer, RotateCcw, Trash2, Trophy, Undo2 } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Leberschuss – Punktezähler" },
      {
        name: "description",
        content:
          "Punktezähler für das Trinkspiel Leberschuss. Zwei Teams, Schlücke pro Runde, Mutter-Treffer und leere Flaschen verfolgen.",
      },
    ],
  }),
});

const BOTTLE = 4;
const MAX_PER_TEAM = 6;

type Player = { name: string; bottleSips: number; emptied: number };
type Team = { name: string; players: [Player, Player] };
type PlayerRef = { team: 0 | 1; player: 0 | 1 };
type Round = {
  drinks: [[number, number], [number, number]];
  mutterAgainst: [boolean, boolean];
  totals: [number, number];
};
type State = {
  teams: [Team, Team];
  rounds: Round[];
  starter: PlayerRef;
  setupDone: boolean;
};

const STORAGE_KEY = "leberschuss.de.v2";

const freshPlayer = (name: string): Player => ({
  name,
  bottleSips: BOTTLE,
  emptied: 0,
});

const initialState = (): State => ({
  teams: [
    { name: "Team 1", players: [freshPlayer("Spieler 1"), freshPlayer("Spieler 2")] },
    { name: "Team 2", players: [freshPlayer("Spieler 3"), freshPlayer("Spieler 4")] },
  ],
  rounds: [],
  starter: { team: 0, player: 0 },
  setupDone: false,
});

// Turn order: starter → diagonal opponent → starter's teammate → remaining opponent
// Diagonal mapping: T1P1 ↔ T2P2, T1P2 ↔ T2P1
const diagonal = (p: PlayerRef): PlayerRef => ({
  team: (p.team === 0 ? 1 : 0) as 0 | 1,
  player: (p.player === 0 ? 1 : 0) as 0 | 1,
});
const teammate = (p: PlayerRef): PlayerRef => ({
  team: p.team,
  player: (p.player === 0 ? 1 : 0) as 0 | 1,
});
const turnOrder = (starter: PlayerRef): PlayerRef[] => {
  const diag = diagonal(starter);
  const mate = teammate(starter);
  const last = diagonal(mate);
  return [starter, diag, mate, last];
};

function Index() {
  const [state, setState] = useState<State>(initialState);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, loaded]);

  if (!state.setupDone) return <Setup state={state} setState={setState} />;
  return <Game state={state} setState={setState} />;
}

function Header() {
  return (
    <header className="border-b border-border bg-card/60 backdrop-blur">
      <div className="mx-auto max-w-3xl px-4 py-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Punktezähler</p>
          <h1 className="text-3xl md:text-4xl font-semibold mt-1">Leberschuss</h1>
        </div>
        <Beer className="h-9 w-9 text-accent shrink-0" />
      </div>
    </header>
  );
}

function Setup({
  state,
  setState,
}: {
  state: State;
  setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  const updatePlayer = (ti: 0 | 1, pi: 0 | 1, name: string) =>
    setState((s) => {
      const teams = s.teams.map((t, i) =>
        i === ti
          ? {
              ...t,
              players: t.players.map((p, j) => (j === pi ? { ...p, name } : p)) as [Player, Player],
            }
          : t,
      ) as [Team, Team];
      return { ...s, teams };
    });

  const updateTeamName = (ti: 0 | 1, name: string) =>
    setState((s) => {
      const teams = s.teams.map((t, i) => (i === ti ? { ...t, name } : t)) as [Team, Team];
      return { ...s, teams };
    });

  const setStarter = (ref: PlayerRef) =>
    setState((s) => ({ ...s, starter: ref }));

  const start = () =>
    setState((s) => ({
      ...s,
      setupDone: true,
      rounds: [],
      teams: s.teams.map((t) => ({
        ...t,
        players: t.players.map((p) => ({ ...p, bottleSips: BOTTLE, emptied: 0 })) as [
          Player,
          Player,
        ],
      })) as [Team, Team],
    }));

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        <Card className="p-5 space-y-5">
          <div>
            <h2 className="text-xl font-semibold">Spielvorbereitung</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Zwei Teams mit je zwei Spielern. Jede Flasche hat {BOTTLE} Schlücke.
            </p>
          </div>

          {([0, 1] as const).map((ti) => (
            <div key={ti} className="rounded-lg border border-border p-4 space-y-3">
              <div>
                <Label>Teamname</Label>
                <Input
                  value={state.teams[ti].name}
                  onChange={(e) => updateTeamName(ti, e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([0, 1] as const).map((pi) => (
                  <div key={pi}>
                    <Label>Spieler {pi + 1}</Label>
                    <Input
                      value={state.teams[ti].players[pi].name}
                      onChange={(e) => updatePlayer(ti, pi, e.target.value)}
                      className="mt-1"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div>
            <Label className="mb-2 block">Wer fängt an?</Label>
            <div className="grid grid-cols-2 gap-2">
              {([0, 1] as const).flatMap((ti) =>
                ([0, 1] as const).map((pi) => {
                  const sel =
                    state.starter.team === ti && state.starter.player === pi;
                  return (
                    <button
                      key={`${ti}-${pi}`}
                      type="button"
                      onClick={() => setStarter({ team: ti, player: pi })}
                      className={
                        "rounded-md border px-3 py-2 text-left text-sm transition-colors " +
                        (sel
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border hover:bg-accent/30")
                      }
                    >
                      <span className="block text-xs text-muted-foreground">
                        {state.teams[ti].name}
                      </span>
                      <span className="font-medium">
                        {state.teams[ti].players[pi].name}
                      </span>
                    </button>
                  );
                }),
              )}
            </div>
          </div>

          <Button onClick={start} size="lg" className="w-full">
            Spiel starten
          </Button>
        </Card>
      </main>
    </div>
  );
}

function Game({
  state,
  setState,
}: {
  state: State;
  setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  // Pro-Spieler-Ergebnis: "0" | "1" | "2" | "3" | "M" (Mutter)
  type Shot = "0" | "1" | "2" | "3" | "M";
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const [split1, setSplit1] = useState("");

  const order = useMemo(() => turnOrder(state.starter), [state.starter]);
  const keyOf = (r: PlayerRef) => `${r.team}-${r.player}`;

  const teamSips = (ti: 0 | 1) => {
    let total = 0;
    for (const pi of [0, 1] as const) {
      const v = shots[`${ti}-${pi}`];
      if (v && v !== "M") total += parseInt(v);
    }
    return total;
  };
  const teamMutter = (ti: 0 | 1) =>
    (["0", "1"] as const).some((pi) => shots[`${ti}-${pi}`] === "M");

  const a = teamSips(0);
  const b = teamSips(1);
  const mutterA = teamMutter(0); // Team A traf Mutter → Team B verliert Flaschen
  const mutterB = teamMutter(1);
  const net = Math.abs(a - b);
  const drinkingTeam: 0 | 1 | null = a === b ? null : a > b ? 0 : 1;

  const winner = useMemo(() => {
    const done = (ti: 0 | 1) =>
      state.teams[ti].players.every((p) => p.bottleSips <= 0 && p.emptied >= 1);
    const aDone = done(0);
    const bDone = done(1);
    if (aDone && bDone) {
      const last = state.rounds[state.rounds.length - 1];
      if (!last) return null;
      if (last.totals[0] > last.totals[1]) return 0;
      if (last.totals[1] > last.totals[0]) return 1;
      return null;
    }
    if (aDone) return 0;
    if (bDone) return 1;
    return null;
  }, [state]);

  const applyRound = () => {
    const p1 = drinkingTeam === null ? 0 : clamp(parseInt(split1) || 0, 0, net);
    const p2 = drinkingTeam === null ? 0 : net - p1;

    setState((s) => {
      const teams = s.teams.map((t, ti) => {
        const drinks: [number, number] =
          drinkingTeam === ti ? [p1, p2] : [0, 0];
        const mutterHit = ti === 0 ? mutterB : mutterA;
        let players = t.players.map((p, pi) => {
          let sips = p.bottleSips - drinks[pi];
          let emptied = p.emptied;
          if (sips <= 0) {
            if (p.bottleSips > 0) emptied += 1;
            sips = 0;
          }
          return { ...p, bottleSips: sips, emptied };
        }) as [Player, Player];
        if (mutterHit) {
          players = players.map((p) => ({
            ...p,
            emptied: p.emptied + (p.bottleSips > 0 ? 1 : 0),
            bottleSips: BOTTLE,
          })) as [Player, Player];
        }
        return { ...t, players };
      }) as [Team, Team];

      const round: Round = {
        drinks: [
          drinkingTeam === 0 ? [p1, p2] : [0, 0],
          drinkingTeam === 1 ? [p1, p2] : [0, 0],
        ],
        mutterAgainst: [mutterB, mutterA],
        totals: [a, b],
      };

      // Starter nächste Runde: gleiches Team beginnt abwechselnd, intern Spielerwechsel
      const nextStarterTeam = (s.starter.team === 0 ? 1 : 0) as 0 | 1;
      // intern Spielerwechsel innerhalb dieses (gegnerischen) Teams: nimm den anderen Spieler des letzten Starters dieses Teams
      // Heuristik: tausche einfach Player-Index ebenfalls
      const nextStarter: PlayerRef = {
        team: nextStarterTeam,
        player: (s.starter.player === 0 ? 1 : 0) as 0 | 1,
      };

      return { ...s, teams, rounds: [...s.rounds, round], starter: nextStarter };
    });

    setShots({});
    setSplit1("");
  };

  const undo = () => {
    if (state.rounds.length === 0) return;
    setState((s) => {
      const last = s.rounds[s.rounds.length - 1];
      const teams = s.teams.map((t, ti) => {
        const drinks = last.drinks[ti];
        const mutterHit = last.mutterAgainst[ti];
        let players = t.players.map((p) => ({ ...p })) as [Player, Player];
        if (mutterHit) {
          players = players.map((p, pi) => ({
            ...p,
            bottleSips: Math.max(0, BOTTLE - drinks[pi]),
            emptied: Math.max(0, p.emptied - 1),
          })) as [Player, Player];
        } else {
          players = players.map((p, pi) => {
            let sips = p.bottleSips + drinks[pi];
            let emptied = p.emptied;
            if (sips > BOTTLE) {
              emptied = Math.max(0, emptied - 1);
              sips = sips - BOTTLE;
            }
            return { ...p, bottleSips: sips, emptied };
          }) as [Player, Player];
        }
        return { ...t, players };
      }) as [Team, Team];
      const prevStarter: PlayerRef = {
        team: (s.starter.team === 0 ? 1 : 0) as 0 | 1,
        player: (s.starter.player === 0 ? 1 : 0) as 0 | 1,
      };
      return { ...s, teams, rounds: s.rounds.slice(0, -1), starter: prevStarter };
    });
  };

  const newGame = () => {
    if (!confirm("Neues Spiel starten? Die aktuellen Punkte gehen verloren.")) return;
    setState((s) => ({
      ...s,
      rounds: [],
      teams: s.teams.map((t) => ({
        ...t,
        players: t.players.map((p) => ({ ...p, bottleSips: BOTTLE, emptied: 0 })) as [
          Player,
          Player,
        ],
      })) as [Team, Team],
    }));
  };

  const fullReset = () => {
    if (!confirm("Alles zurücksetzen (auch Teams)?")) return;
    setState({ ...initialState(), setupDone: false });
  };

  const drinkingTeamObj = drinkingTeam !== null ? state.teams[drinkingTeam] : null;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6 space-y-5">
        {winner !== null && (
          <Card className="p-5 border-primary bg-primary/10">
            <div className="flex items-center gap-3">
              <Trophy className="h-7 w-7 text-primary" />
              <div>
                <p className="text-sm uppercase tracking-wider text-muted-foreground">Gewinner</p>
                <h2 className="text-2xl font-semibold">{state.teams[winner].name}</h2>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {state.teams.map((t, ti) => (
            <TeamCard key={ti} team={t} isStarterTeam={state.starter.team === ti} />
          ))}
        </div>

        <Card className="p-5 space-y-3">
          <h2 className="text-lg font-semibold">Schnipps-Reihenfolge</h2>
          <ol className="space-y-1 text-sm">
            {order.map((ref, i) => {
              const p = state.teams[ref.team].players[ref.player];
              return (
                <li key={i} className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                    {i + 1}
                  </span>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground text-xs">
                    ({state.teams[ref.team].name})
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card className="p-5 space-y-4">
          <h2 className="text-lg font-semibold">Neue Runde</h2>

          <div className="space-y-3">
            {order.map((ref, i) => {
              const player = state.teams[ref.team].players[ref.player];
              const teamName = state.teams[ref.team].name;
              const k = keyOf(ref);
              const current = shots[k];
              const options: Shot[] = ["0", "1", "2", "3", "M"];
              return (
                <div
                  key={k}
                  className="rounded-lg border border-border p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-medium shrink-0">
                      {i + 1}
                    </span>
                    <span className="font-medium">{player.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({teamName}) hat geschnippst:
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {options.map((opt) => {
                      const sel = current === opt;
                      const isMutter = opt === "M";
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() =>
                            setShots((s) => ({ ...s, [k]: opt }))
                          }
                          className={
                            "h-10 min-w-12 px-3 rounded-md border text-sm font-medium transition-colors " +
                            (sel
                              ? isMutter
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-primary bg-primary/10"
                              : "border-border hover:bg-accent/30")
                          }
                        >
                          {isMutter ? "Mutter" : opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between text-sm px-1">
            <span>
              <b>{state.teams[0].name}:</b> {a} Schlücke
              {mutterA && <span className="ml-1 text-primary">+ Mutter</span>}
            </span>
            <span>
              <b>{state.teams[1].name}:</b> {b} Schlücke
              {mutterB && <span className="ml-1 text-primary">+ Mutter</span>}
            </span>
          </div>

          <div className="rounded-lg border border-border p-4 space-y-3 bg-secondary/30">
            {drinkingTeamObj === null ? (
              <p className="text-sm text-muted-foreground">
                Gleichstand ({a} : {b}) – niemand trinkt diese Runde.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  <span className="font-semibold">{drinkingTeamObj.name}</span> trinkt{" "}
                  <span className="font-display text-xl text-primary">{net}</span>{" "}
                  Schlücke ({a} − {b} netto). Aufteilung:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">{drinkingTeamObj.players[0].name}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={net}
                      value={split1}
                      onChange={(e) => setSplit1(e.target.value)}
                      className="mt-1"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{drinkingTeamObj.players[1].name}</Label>
                    <Input
                      value={Math.max(0, net - (clamp(parseInt(split1) || 0, 0, net)))}
                      readOnly
                      className="mt-1 bg-muted"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={undo} disabled={state.rounds.length === 0}>
              <Undo2 className="h-4 w-4 mr-1" /> Runde rückgängig
            </Button>
            <Button variant="outline" size="sm" onClick={newGame}>
              <RotateCcw className="h-4 w-4 mr-1" /> Neues Spiel
            </Button>
            <Button variant="destructive" size="sm" onClick={fullReset}>
              <Trash2 className="h-4 w-4 mr-1" /> Alles zurücksetzen
            </Button>
            <Button onClick={applyRound} disabled={winner !== null}>
              Runde abschließen
            </Button>
          </div>
        </Card>

        {state.rounds.length > 0 && (
          <Card className="p-5">
            <h2 className="text-lg font-semibold mb-3">Rundenverlauf</h2>
            <div className="space-y-1 text-sm">
              {state.rounds.map((r, i) => (
                <div
                  key={i}
                  className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border/60 pb-2"
                >
                  <span className="text-muted-foreground w-12">#{i + 1}</span>
                  <span>
                    {state.teams[0].name}: <b>{r.totals[0]}</b>
                    {r.mutterAgainst[1] && <span className="ml-1 text-primary">(Mutter!)</span>}
                  </span>
                  <span>
                    {state.teams[1].name}: <b>{r.totals[1]}</b>
                    {r.mutterAgainst[0] && <span className="ml-1 text-primary">(Mutter!)</span>}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function TeamCard({ team, isStarterTeam }: { team: Team; isStarterTeam: boolean }) {
  return (
    <Card className={"p-5 " + (isStarterTeam ? "border-primary" : "")}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg">{team.name}</h3>
        {isStarterTeam && (
          <span className="text-xs uppercase tracking-wider text-primary">Startet</span>
        )}
      </div>
      <div className="space-y-3">
        {team.players.map((p, i) => {
          const pct = Math.max(0, Math.min(100, (p.bottleSips / BOTTLE) * 100));
          const empty = p.bottleSips <= 0;
          return (
            <div key={i}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{p.name}</span>
                <span className={empty ? "text-destructive" : "text-muted-foreground"}>
                  {p.bottleSips}/{BOTTLE} {empty && "· LEER"}
                  {p.emptied > 0 && <span className="ml-2 text-accent">🍺 ×{p.emptied}</span>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={"h-full transition-all " + (empty ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
