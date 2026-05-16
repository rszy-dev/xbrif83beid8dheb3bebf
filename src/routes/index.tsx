import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2, RotateCcw, Trophy } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Leberschuss – Score Tracker" },
      {
        name: "description",
        content:
          "Keep score for your Leberschuss games. Add players, log rounds, see who's winning.",
      },
    ],
  }),
});

type Player = { id: string; name: string; scores: number[] };

const STORAGE_KEY = "leberschuss.state.v1";
const uid = () => Math.random().toString(36).slice(2, 9);

function Index() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setPlayers(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
  }, [players, loaded]);

  const rounds = useMemo(
    () => Math.max(0, ...players.map((p) => p.scores.length)),
    [players],
  );

  const totals = useMemo(
    () => players.map((p) => p.scores.reduce((a, b) => a + b, 0)),
    [players],
  );

  const leaderTotal = totals.length ? Math.max(...totals) : 0;

  const addPlayer = () => {
    const n = name.trim();
    if (!n) return;
    setPlayers((p) => [
      ...p,
      { id: uid(), name: n, scores: Array(rounds).fill(0) },
    ]);
    setName("");
  };

  const removePlayer = (id: string) =>
    setPlayers((p) => p.filter((x) => x.id !== id));

  const addRound = () => {
    if (players.length === 0) return;
    const next = players.map((p) => {
      const v = parseInt(inputs[p.id] ?? "", 10);
      return { ...p, scores: [...p.scores, Number.isFinite(v) ? v : 0] };
    });
    setPlayers(next);
    setInputs({});
  };

  const undoRound = () => {
    if (rounds === 0) return;
    setPlayers((p) => p.map((x) => ({ ...x, scores: x.scores.slice(0, -1) })));
  };

  const resetAll = () => {
    if (!confirm("Reset all scores and players?")) return;
    setPlayers([]);
    setInputs({});
  };

  const resetScores = () => {
    if (!confirm("Reset all scores (keep players)?")) return;
    setPlayers((p) => p.map((x) => ({ ...x, scores: [] })));
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Score Tracker
            </p>
            <h1 className="text-4xl md:text-5xl font-semibold mt-1">
              Leberschuss
            </h1>
          </div>
          <Trophy className="h-10 w-10 text-accent shrink-0" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <Card className="p-5">
          <h2 className="text-lg font-semibold mb-3">Players</h2>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPlayer()}
              placeholder="Add player name…"
            />
            <Button onClick={addPlayer}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
          {players.length === 0 && (
            <p className="text-sm text-muted-foreground mt-3">
              Add at least one player to start tracking rounds.
            </p>
          )}
        </Card>

        {players.length > 0 && (
          <Card className="p-5 overflow-x-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Scoreboard</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={undoRound} disabled={rounds === 0}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Undo round
                </Button>
                <Button variant="outline" size="sm" onClick={resetScores}>
                  Reset scores
                </Button>
                <Button variant="destructive" size="sm" onClick={resetAll}>
                  <Trash2 className="h-4 w-4 mr-1" /> Reset all
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Round</TableHead>
                  {players.map((p) => (
                    <TableHead key={p.id} className="min-w-[120px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{p.name}</span>
                        <button
                          onClick={() => removePlayer(p.id)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${p.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: rounds }).map((_, r) => (
                  <TableRow key={r}>
                    <TableCell className="text-muted-foreground">{r + 1}</TableCell>
                    {players.map((p) => (
                      <TableCell key={p.id}>{p.scores[r] ?? 0}</TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow className="bg-secondary/40">
                  <TableCell className="font-medium">New</TableCell>
                  {players.map((p) => (
                    <TableCell key={p.id}>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={inputs[p.id] ?? ""}
                        onChange={(e) =>
                          setInputs((s) => ({ ...s, [p.id]: e.target.value }))
                        }
                        onKeyDown={(e) => e.key === "Enter" && addRound()}
                        placeholder="0"
                        className="h-9"
                      />
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  {players.map((p, i) => {
                    const isLeader = totals[i] === leaderTotal && rounds > 0;
                    return (
                      <TableCell
                        key={p.id}
                        className={
                          isLeader
                            ? "font-display text-2xl text-primary"
                            : "font-display text-2xl"
                        }
                      >
                        {totals[i]}
                        {isLeader && (
                          <Trophy className="inline h-4 w-4 ml-1 text-accent" />
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>

            <div className="mt-4 flex justify-end">
              <Button onClick={addRound}>
                <Plus className="h-4 w-4 mr-1" /> Add round
              </Button>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
