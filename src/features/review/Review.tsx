import { useEffect, useRef, useState } from "react";
import { Board } from "../shogi/Board";
import { validatePV } from "../shogi/game";
import { WasmEngineAdapter } from "../engine/adapter";
import { formatScore } from "../engine/usi";
import type { SearchResult } from "../../shared/contracts/engine";
import { assertAnalysisAllowed } from "./access";
import { ArchiveStore } from "./store";
import {
  MAX_BYTES,
  MAX_GAMES,
  parseArchive,
  exportArchive,
  replay,
  variationPosition,
} from "./archive";
import type { GameArchive } from "./archive";
export function Review({
  namespace,
  blocked,
}: {
  namespace: string;
  blocked: boolean;
}) {
  const [rows, setRows] = useState<GameArchive[]>([]),
    [record, setRecord] = useState<GameArchive | null>(null),
    [ply, setPly] = useState(0),
    [json, setJSON] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("Loading saved games…"),
    [busy, setBusy] = useState(false),
    [analysis, setAnalysis] = useState<SearchResult | null>(null),
    [candidate, setCandidate] = useState(0),
    [future, setFuture] = useState(0),
    [deleting, setDeleting] = useState<string | null>(null);
  const store = useRef<ArchiveStore | null>(null),
    engine = useRef<WasmEngineAdapter | null>(null),
    generation = useRef(0),
    focus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const s = new ArchiveStore(namespace);
    store.current = s;
    const reload = () =>
      s.list().then((r) => {
        if (store.current === s) {
          setRows(r);
          setNotice(
            s.warning ||
              "Saved on this device. Imported results are unverified descriptions.",
          );
        }
      });
    void reload();
    const changed = (e: Event) => {
      if ((e as CustomEvent).detail === namespace) void reload();
    };
    window.addEventListener("archive-saved", changed);
    return () => {
      window.removeEventListener("archive-saved", changed);
      store.current = null;
      s.close();
      engine.current?.dispose();
      generation.current++;
    };
  }, [namespace]);
  function stop() {
    generation.current++;
    engine.current?.dispose();
    engine.current = null;
    setBusy(false);
    setAnalysis(null);
    setFuture(0);
  }
  useEffect(() => {
    if (blocked) stop();
  }, [blocked]);
  function jump(n: number) {
    stop();
    setPly(n);
  }
  async function load() {
    if (!store.current) return;
    setRows(await store.current.list());
    setNotice(store.current.warning || "Saved on this device.");
  }
  async function importJSON(text: string) {
    try {
      setError("");
      const game = parseArchive(text);
      await store.current!.put(game, true);
      await load();
      stop();
      setRecord(game);
      setPly(0);
      setNotice(
        store.current!.warning ||
          "Imported valid standard-start game. The recorded result is not independently verified.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function analyze() {
    if (!record || busy || blocked) return;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setAnalysis(null);
    setFuture(0);
    try {
      await assertAnalysisAllowed();
      if (token !== generation.current) return;
      const e = (engine.current ??= new WasmEngineAdapter());
      const result = await e.search(
        { kind: "startpos", moves: record.moves.slice(0, ply) },
        { maxTimeMs: 300, multiPv: 3 },
      );
      if (token !== generation.current) return;
      await assertAnalysisAllowed();
      if (token !== generation.current) return;
      const position = replay(record, ply).position;
      if (
        (result.bestMoveUSI && !validatePV(position, [result.bestMoveUSI])) ||
        result.candidates.some((c) => !validatePV(position, c.pvUSI))
      )
        throw new Error("Engine returned an illegal move or variation");
      setAnalysis(result);
      setCandidate(0);
    } catch (e) {
      if (token === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  if (blocked)
    return (
      <main>
        <h1>Review paused</h1>
        <p role="status">
          Finish or reconnect to your online match before opening Review. No
          engine advice is available.
        </p>
      </main>
    );
  const line = analysis?.candidates[candidate];
  const position = record
    ? future && line
      ? variationPosition(record, ply, line.pvUSI, future)
      : replay(record, ply).position
    : null;
  return (
    <main className="review-page">
      <h1>Review</h1>
      <p>
        Offline replay and post-game analysis. Standard-start JSON v1 only; at
        most 512 plies and 64 KiB per import.
      </p>
      <p role="status">{notice}</p>
      {error && <p role="alert">{error}</p>}
      <section aria-label="Saved games">
        <h2>Saved games</h2>
        <p>
          Up to {MAX_GAMES} records per profile. New saves replace the oldest
          when full.
        </p>
        {!rows.length && <p>No games saved for this profile.</p>}
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <button
                aria-pressed={record?.id === r.id}
                onClick={() => {
                  stop();
                  setRecord(r);
                  setPly(0);
                  setError("");
                }}
              >
                {r.mode} · {r.moves.length} plies · {r.result.text} ·{" "}
                {new Date(r.savedAt).toLocaleString("en")}
              </button>
              <button
                aria-label={`Delete saved game ${r.id}`}
                onClick={(e) => {
                  focus.current = e.currentTarget;
                  setDeleting(r.id);
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
      {deleting && (
        <section
          role="alertdialog"
          aria-modal="false"
          aria-label="Delete saved game"
        >
          <p>Delete this saved game from this profile on this device?</p>
          <button
            autoFocus
            onClick={() => {
              setDeleting(null);
              focus.current?.focus();
            }}
          >
            Cancel deletion
          </button>
          <button
            onClick={async () => {
              await store.current!.remove(deleting);
              if (record?.id === deleting) {
                stop();
                setRecord(null);
              }
              setDeleting(null);
              await load();
            }}
          >
            Confirm deletion
          </button>
        </section>
      )}
      <section aria-label="Import and export">
        <h2>Portable game JSON</h2>
        <label>
          Game JSON
          <textarea
            aria-label="Game JSON"
            maxLength={MAX_BYTES}
            value={json}
            onChange={(e) => setJSON(e.target.value)}
            rows={5}
          />
        </label>
        <button onClick={() => void importJSON(json)}>Import JSON</button>
        <label>
          Import JSON file
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > MAX_BYTES) {
                setError("Game file exceeds 64 KiB");
                return;
              }
              await importJSON(await f.text());
              e.target.value = "";
            }}
          />
        </label>
        <button
          disabled={!record}
          onClick={() => {
            const text = exportArchive(record!);
            setJSON(text);
            const url = URL.createObjectURL(
              new Blob([text], { type: "application/json" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `shogi-${record!.id}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export selected JSON
        </button>
      </section>
      {record && position && (
        <section aria-label="Game replay">
          <h2>
            {future
              ? `Variation preview · ${future} plies`
              : `Replay · ply ${ply} of ${record.moves.length}`}
          </h2>
          <p role="status">
            Saved ply {ply}; {position.color} to move.
          </p>
          <p>
            {record.result.text} · {record.publicNames?.join(" / ")}
          </p>
          <div className="review-controls">
            <button disabled={!ply || busy} onClick={() => jump(0)}>
              Beginning
            </button>
            <button disabled={!ply || busy} onClick={() => jump(ply - 1)}>
              Previous move
            </button>
            <button
              disabled={ply === record.moves.length || busy}
              onClick={() => jump(ply + 1)}
            >
              Next move
            </button>
            <button
              disabled={ply === record.moves.length || busy}
              onClick={() => jump(record.moves.length)}
            >
              End
            </button>
            <label>
              Jump to ply
              <input
                aria-label="Jump to ply"
                type="number"
                min={0}
                max={record.moves.length}
                value={ply}
                disabled={busy}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 0 && n <= record.moves.length)
                    jump(n);
                }}
              />
            </label>
          </div>
          <Board
            position={position}
            selected={null}
            disabled
            onSelect={() => {}}
            onHand={() => {}}
          />
          <code data-testid="replay-sfen">
            {position.getSFEN(ply + future + 1)}
          </code>
          <button disabled={busy} onClick={() => void analyze()}>
            {busy ? "Analyzing saved position…" : "Analyze saved position"}
          </button>
          {busy && <button onClick={stop}>Stop analysis</button>}
          {analysis && (
            <>
              <p>
                Score perspective: side to move at saved ply {ply}.{" "}
                {analysis.elapsedMs.toFixed(0)} ms. Mate distances are plies;
                negative means being mated.
              </p>
              <div className="review-candidates">
                {analysis.candidates.map((c, i) => (
                  <button
                    key={c.multiPv}
                    onClick={() => {
                      setCandidate(i);
                      setFuture(1);
                    }}
                  >
                    {c.firstMoveUSI} · depth {c.depth} · {formatScore(c.score)}
                  </button>
                ))}
              </div>
              {line && (
                <>
                  <p data-testid="review-pv">{line.pvUSI.join(" → ")}</p>
                  <button
                    disabled={!future}
                    onClick={() => setFuture((n) => n - 1)}
                  >
                    Previous variation ply
                  </button>
                  <button
                    disabled={future >= line.pvUSI.length}
                    onClick={() => setFuture((n) => n + 1)}
                  >
                    Next variation ply
                  </button>
                  <button onClick={() => setFuture(0)}>
                    Return to saved position
                  </button>
                </>
              )}
              {!analysis.candidates.length && (
                <p>No variations reported for this position.</p>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
