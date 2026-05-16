import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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

type Player = { name: string; bottleSips: number; emptied: number };
type Team = { name: string; players: [Player, Player] };
type Round = {
  // sips each player of each team had to drink this round
  drinks: [[number, number], [number, number]];
  // mutter hit against opponent (team index that GOT HIT)
  mutterAgainst: [boolean, boolean];
  totals: [number, number]; // schluck totals scored per team (incl. mutter)
};
type State = {
  teams: [Team, Team];
  bottleSize: number;
  rounds: Round[];
  starter: 0 | 1; // who starts next round
  setupDone: boolean;
};

const STORAGE_KEY = "leberschuss.de.v1";

const freshPlayer = (name: string, bottleSize: number): Player => ({
  name,
  bottleSips: bottleSize,
  emptied: 0,
});

const initialState = (): State => ({
  teams: [
    { name: "Team 1", players: [freshPlayer("Spieler 1", 20), freshPlayer("Spieler 2", 20)] },
    { name: "Team 2", players: [freshPlayer("Spieler 3", 20), freshPlayer("Spieler 4", 20)] },
  ],
  bottleSize: 20,
  rounds: [],
  starter: 0,
  setupDone: false,
});

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

function Setup({
  state,
  setState,
}: {
  state: State;
  setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  const update = (ti: 0 | 1, pi: 0 | 1, name: string) =>
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

  const start = () =>
    setState((s) => ({
      ...s,
      setupDone: true,
      rounds: [],
      teams: s.teams.map((t) => ({
        ...t,
        players: t.players.map((p) => ({ ...p, bottleSips: s.bottleSize, emptied: 0 })) as [
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
              Zwei Teams mit jeweils zwei Spielern. Gib die Namen ein und lege die Flaschengröße fest.
            </p>
          </div>

          <div>
            <Label htmlFor="bottle">Schlücke pro Flasche</Label>
            <Input
              id="bottle"
              type="number"
              min={1}
              value={state.bottleSize}
              onChange={(e) =>
                setState((s) => ({ ...s, bottleSize: Math.max(1, parseInt(e.target.value) || 1) }))
              }
              className="mt-1 w-32"
            />
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
                      onChange={(e) => update(ti, pi, e.target.value)}
                      className="mt-1"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <Button onClick={start} size="lg" className="w-full">
            Spiel starten
          </Button>
        </Card>
      </main>
    </div>
  );
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

function Game({
  state,
  setState,
}: {
  state: State;
  setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  // form for next round
  const [sipsA, setSipsA] = useState("");
  const [sipsB, setSipsB] = useState("");
  const [mutterA, setMutterA] = useState(false); // team A hit mutter on team B
  const [mutterB, setMutterB] = useState(false);
  const [splitA1, setSplitA1] = useState(""); // how many sips player A1 drinks (only when A is hit / drinks B's sips? -> drinks come from opponent's Wertung)
  const [splitB1, setSplitB1] = useState("");

  // In Leberschuss: a team's earned sips go to the OPPONENT to drink.
  // The opponent team distributes those sips between its two players.
  // sipsA = Wertung Team A schnippst -> Team B trinkt. splitB1 = wie viele davon Spieler B1.
  const totalForB = (parseInt(sipsA) || 0);
  const totalForA = (parseInt(sipsB) || 0);

  const winner = useMemo(() => {
    const aDone = state.teams[0].players.every((p) => p.bottleSips <= 0 && p.emptied >= 1);
    const bDone = state.teams[1].players.every((p) => p.bottleSips <= 0 && p.emptied >= 1);
    if (aDone && bDone) {
      const last = state.rounds[state.rounds.length - 1];
      if (!last) return null;
      if (last.totals[0] > last.totals[1]) return 0;
      if (last.totals[1] > last.totals[0]) return 1;
      return null; // tie -> next round decides
    }
    if (aDone) return 0;
    if (bDone) return 1;
    return null;
  }, [state]);

  const applyRound = () => {
    const a = parseInt(sipsA) || 0;
    const b = parseInt(sipsB) || 0;

    // distribute
    const b1 = Math.min(Math.max(parseInt(splitB1) || 0, 0), totalForB);
    const b2 = totalForB - b1;
    const a1 = Math.min(Math.max(parseInt(splitA1) || 0, 0), totalForA);
    const a2 = totalForA - a1;

    setState((s) => {
      const teams = s.teams.map((t, ti) => {
        const drinks = ti === 0 ? [a1, a2] : [b1, b2];
        const mutterHit = ti === 0 ? mutterB : mutterA; // this team got hit on mutter
        let players = t.players.map((p, pi) => {
          let sips = p.bottleSips - drinks[pi];
          let emptied = p.emptied;
          if (sips <= 0) {
            emptied += 1;
            sips = 0;
          }
          return { ...p, bottleSips: sips, emptied };
        }) as [Player, Player];
        if (mutterHit) {
          // opponent hit Mutter -> beide Flaschen werden ausgetrunken & ersetzt
          players = players.map((p) => ({
            ...p,
            emptied: p.emptied + (p.bottleSips > 0 ? 1 : 0),
            bottleSips: s.bottleSize,
          })) as [Player, Player];
        }
        return { ...t, players };
      }) as [Team, Team];

      const round: Round = {
        drinks: [
          [a1, a2],
          [b1, b2],
        ],
        mutterAgainst: [mutterB, mutterA],
        totals: [a, b],
      };

      return {
        ...s,
        teams,
        rounds: [...s.rounds, round],
        starter: (s.starter === 0 ? 1 : 0) as 0 | 1,
      };
    });

    setSipsA("");
    setSipsB("");
    setMutterA(false);
    setMutterB(false);
    setSplitA1("");
    setSplitB1("");
  };

  const undo = () => {
    if (state.rounds.length === 0) return;
    setState((s) => {
      const last = s.rounds[s.rounds.length - 1];
      const teams = s.teams.map((t, ti) => {
        const drinks = last.drinks[ti];
        const mutterHit = last.mutterAgainst[ti];
        let players = t.players.map((p, pi) => ({ ...p })) as [Player, Player];
        if (mutterHit) {
          // can't perfectly reverse mutter; just refund bottle to previous? approximate: revert bottle to size - drink, undo emptied bump
          players = players.map((p, pi) => ({
            ...p,
            bottleSips: Math.max(0, s.bottleSize - drinks[pi]),
            emptied: Math.max(0, p.emptied - 1),
          })) as [Player, Player];
        } else {
          players = players.map((p, pi) => {
            let sips = p.bottleSips + drinks[pi];
            let emptied = p.emptied;
            if (sips > s.bottleSize) {
              // bottle was replaced this round; reduce emptied
              emptied = Math.max(0, emptied - 1);
              sips = sips - s.bottleSize;
            }
            return { ...p, bottleSips: sips, emptied };
          }) as [Player, Player];
        }
        return { ...t, players };
      }) as [Team, Team];
      return {
        ...s,
        teams,
        rounds: s.rounds.slice(0, -1),
        starter: (s.starter === 0 ? 1 : 0) as 0 | 1,
      };
    });
  };

  const newGame = () => {
    if (!confirm("Neues Spiel starten? Die aktuellen Punkte gehen verloren.")) return;
    setState((s) => ({
      ...s,
      rounds: [],
      teams: s.teams.map((t) => ({
        ...t,
        players: t.players.map((p) => ({ ...p, bottleSips: s.bottleSize, emptied: 0 })) as [
          Player,
          Player,
        ],
      })) as [Team, Team],
      starter: 0,
    }));
  };

  const fullReset = () => {
    if (!confirm("Alles zurücksetzen (auch Teams)?")) return;
    setState({ ...initialState(), setupDone: false });
  };

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
            <TeamCard
              key={ti}
              team={t}
              isStarter={state.starter === ti}
              bottleSize={state.bottleSize}
            />
          ))}
        </div>

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Neue Runde</h2>
            <p className="text-sm text-muted-foreground">
              Beginnt: <span className="font-medium text-foreground">{state.teams[state.starter].name}</span>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {([0, 1] as const).map((ti) => {
              const sips = ti === 0 ? sipsA : sipsB;
              const setSips = ti === 0 ? setSipsA : setSipsB;
              const mutter = ti === 0 ? mutterA : mutterB;
              const setMutter = ti === 0 ? setMutterA : setMutterB;
              return (
                <div key={ti} className="rounded-lg border border-border p-4 space-y-3">
                  <p className="font-medium">{state.teams[ti].name} hat erschnippst</p>
                  <div>
                    <Label>Schlücke (aus gelben Feldern)</Label>
                    <Input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={sips}
                      onChange={(e) => setSips(e.target.value)}
                      className="mt-1"
                      placeholder="0"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={mutter}
                      onCheckedChange={(v) => setMutter(Boolean(v))}
                    />
                    Mutter getroffen (Gegner bekommt neue Flaschen)
                  </label>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SplitInput
              label={`${state.teams[1].name} trinkt insgesamt ${totalForB}. Aufteilung:`}
              p1Name={state.teams[1].players[0].name}
              p2Name={state.teams[1].players[1].name}
              total={totalForB}
              p1Value={splitB1}
              setP1Value={setSplitB1}
            />
            <SplitInput
              label={`${state.teams[0].name} trinkt insgesamt ${totalForA}. Aufteilung:`}
              p1Name={state.teams[0].players[0].name}
              p2Name={state.teams[0].players[1].name}
              total={totalForA}
              p1Value={splitA1}
              setP1Value={setSplitA1}
            />
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
                <div key={i} className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border/60 pb-2">
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

function SplitInput({
  label,
  p1Name,
  p2Name,
  total,
  p1Value,
  setP1Value,
}: {
  label: string;
  p1Name: string;
  p2Name: string;
  total: number;
  p1Value: string;
  setP1Value: (v: string) => void;
}) {
  const p1 = Math.min(Math.max(parseInt(p1Value) || 0, 0), total);
  const p2 = total - p1;
  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">{p1Name}</Label>
          <Input
            type="number"
            min={0}
            max={total}
            value={p1Value}
            onChange={(e) => setP1Value(e.target.value)}
            className="mt-1"
            placeholder="0"
            disabled={total === 0}
          />
        </div>
        <div>
          <Label className="text-xs">{p2Name}</Label>
          <Input value={p2} readOnly className="mt-1 bg-muted" />
        </div>
      </div>
    </div>
  );
}

function TeamCard({
  team,
  isStarter,
  bottleSize,
}: {
  team: Team;
  isStarter: boolean;
  bottleSize: number;
}) {
  return (
    <Card className={"p-5 " + (isStarter ? "border-primary" : "")}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-lg">{team.name}</h3>
        {isStarter && (
          <span className="text-xs uppercase tracking-wider text-primary">Startet</span>
        )}
      </div>
      <div className="space-y-3">
        {team.players.map((p, i) => {
          const pct = Math.max(0, Math.min(100, (p.bottleSips / bottleSize) * 100));
          const empty = p.bottleSips <= 0;
          return (
            <div key={i}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{p.name}</span>
                <span className={empty ? "text-destructive" : "text-muted-foreground"}>
                  {p.bottleSips}/{bottleSize} {empty && "· LEER"}
                  {p.emptied > 0 && (
                    <span className="ml-2 text-accent">🍺 ×{p.emptied}</span>
                  )}
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
