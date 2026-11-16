import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, Square } from 'tsshogi';
import type { Move, Position } from 'tsshogi';
import { Board } from '../features/shogi/Board';
import { LocalGame, isLegalUSI, legalMoves, sideName, validatePV } from '../features/shogi/game';
import type { MoveSource } from '../features/shogi/game';
import { WasmEngineAdapter } from '../features/engine/adapter';
import { formatScore } from '../features/engine/usi';
import type { EngineDiagnostics, SearchResult } from '../shared/contracts/engine';

type Analysis = { result: SearchResult; base: Position; ply: number };
type Status = 'idle' | 'loading' | 'ready' | 'searching' | 'error';

export function App() {
  const [game, setGame] = useState(() => new LocalGame());
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<'local' | 'ai'>('local');
  const [budget, setBudget] = useState(500);
  const [selected, setSelected] = useState<MoveSource | null>(null);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('Black moves first.');
  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [previewPly, setPreviewPly] = useState(0);
  const engine = useRef<WasmEngineAdapter | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const outcome = useMemo(() => game.outcome, [game, revision]);
  const position = game.position;
  const busy = status === 'loading' || status === 'searching';
  const candidate = analysis?.result.candidates[candidateIndex];
  const preview = useMemo(() => {
    if (!analysis || !previewPly || !candidate) return null;
    const copy = analysis.base.clone();
    for (const usi of candidate.pvUSI.slice(0, previewPly)) {
      const move = copy.createMoveByUSI(usi);
      if (!move || !copy.doMove(move)) return null;
    }
    return copy;
  }, [analysis, candidate, previewPly]);

  useEffect(() => () => { generation.current++; engine.current?.dispose(); }, []);
  useEffect(() => {
    if (mode === 'ai' && game.position.color === Color.WHITE && !game.outcome) void runSearch(true);
    // The position revision triggers one reply; stopping leaves the turn paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, revision, mode]);

  function clearAnalysis() { setAnalysis(null); setPreviewPly(0); setCandidateIndex(0); }
  function cancelWork() {
    generation.current++;
    engine.current?.dispose();
    engine.current = null;
    running.current = false;
    setStatus('idle');
    setDiagnostics(null);
    setError('');
    setSelected(null);
    setPromotion(null);
    clearAnalysis();
  }
  function reset(nextMode = mode) {
    cancelWork(); setMode(nextMode); setGame(new LocalGame()); setRevision(0); setNotice('New game. Black moves first.');
  }
  function play(usi: string) {
    if (!game.play(usi)) { setNotice(`Illegal move rejected: ${usi}`); return; }
    setSelected(null); setPromotion(null); clearAnalysis(); setError('');
    setNotice(`${usi} played.`); setRevision(value => value + 1);
  }
  function selectSquare(square: Square) {
    if (selected) {
      const options = [...legalMoves(position, selected)].filter(move => move.to.equals(square));
      if (options.length === 1) { play(options[0].usi); return; }
      if (options.length > 1) { setPromotion(options); return; }
      setNotice('That move is not legal. Choose a highlighted destination.');
    }
    const piece = position.board.at(square);
    setSelected(piece?.color === position.color ? square : null);
  }
  async function runSearch(applyMove: boolean) {
    if (running.current || game.outcome) return;
    running.current = true;
    const token = generation.current;
    const adapter = engine.current ??= new WasmEngineAdapter();
    const base = game.position.clone();
    const ply = game.moves.length;
    setError(''); setSelected(null); setPromotion(null); clearAnalysis();
    try {
      setStatus('loading');
      await adapter.init();
      if (token !== generation.current) return;
      setDiagnostics(adapter.diagnostics);
      setStatus('searching');
      const result = await adapter.search({ kind: 'startpos', moves: game.moves }, { maxTimeMs: budget, multiPv: 3 });
      if (token !== generation.current) return;
      if (result.bestMoveUSI && !isLegalUSI(base, result.bestMoveUSI)) throw new Error(`Engine returned an illegal best move: ${result.bestMoveUSI}`);
      if (result.candidates.some(line => !validatePV(base, line.pvUSI))) throw new Error('Engine returned an illegal candidate variation; result rejected.');
      if (applyMove) {
        if (!result.bestMoveUSI) {
          // An engine's terminal token cannot override deterministic game adjudication.
          throw new Error(`Engine reported ${result.terminal ?? 'no move'} in a playable position.`);
        }
        play(result.bestMoveUSI);
      }
      setAnalysis({ result, base, ply });
      setStatus('ready');
      setNotice(applyMove ? `AI played ${result.bestMoveUSI}. Your turn.` : 'Analysis complete. Select a candidate to explore its variation.');
    } catch (cause) {
      if (token !== generation.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      adapter.dispose(); engine.current = null; setStatus('error');
    } finally { if (token === generation.current) running.current = false; }
  }
  async function stop() {
    const token = ++generation.current;
    try {
      await engine.current?.stop();
      if (token !== generation.current) return;
      setStatus('ready'); setNotice('Search stopped.');
    } catch (cause) { if (token === generation.current) { setError(String(cause)); setStatus('error'); } }
    finally { if (token === generation.current) running.current = false; }
  }

  return <div className="app-shell">
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="Shogi Study home"><span className="brand-mark">歩</span>SHOGI <b>STUDY</b></a>
      <span className="prototype-badge">LOCAL PROTOTYPE · SPIKE 01</span>
    </header>
    <main>
      <div className="page-intro"><div><p className="eyebrow">PLAY. EXPLORE. UNDERSTAND.</p><h1>Your next move starts here.</h1>
        <p>A quiet place to learn Shogi, one position at a time.</p></div><span className="local-label"><span />Local session</span></div>
      <div className="workspace">
        <section className="play-panel" aria-label="Local Shogi game">
          <div className="panel-top"><div><p className="eyebrow">{preview ? 'VARIATION PREVIEW' : mode === 'ai' ? 'HUMAN VS WASM AI' : 'TWO PLAYERS · ONE BOARD'}</p>
            <h2>{preview ? `Variation · ply ${previewPly}` : outcome ? `${outcome.winner ? `${sideName(outcome.winner)} wins` : 'Draw'}` : `${sideName(position.color)} to move`}</h2>
          </div><span className={`turn-token ${position.color}`}>{preview ? 'PREVIEW' : outcome ? 'FINISHED' : position.checked ? 'CHECK' : `MOVE ${game.moves.length + 1}`}</span></div>
          {outcome && <p className="outcome" role="status">{outcome.reason}. {outcome.winner ? `${sideName(outcome.winner)} wins.` : 'The game is drawn.'}</p>}
          {preview && <button className="return-button" onClick={() => setPreviewPly(0)}>← Return to game</button>}
          <Board position={preview ?? position} selected={preview ? null : selected}
            disabled={!!preview || !!outcome || busy || !!promotion || (mode === 'ai' && position.color === Color.WHITE)}
            onSelect={selectSquare} onHand={setSelected} />
          {promotion && <div className="promotion-choice" role="dialog" aria-modal="false" aria-label="Choose promotion">
            <strong>Promote this piece?</strong>
            {promotion.map(move => <button autoFocus={move.promote} key={move.usi} onClick={() => play(move.usi)}>{move.promote ? 'Promote' : 'Keep unpromoted'}</button>)}
            <button onClick={() => { setPromotion(null); setSelected(null); }}>Cancel</button>
          </div>}
          <div className="game-controls">
            <button onClick={() => reset()}>New game</button>
            <button disabled={!game.record.current.prev} onClick={() => {
              cancelWork();
              game.undo();
              if (mode === 'ai' && game.position.color === Color.WHITE) game.undo();
              setRevision(value => value + 1); setNotice('Move undone.');
            }}>Undo{mode === 'ai' ? ' turn' : ''}</button>
            <button disabled={!!outcome || busy || !!preview || (mode === 'ai' && position.color === Color.WHITE)} onClick={() => {
              cancelWork(); game.resign(); setRevision(value => value + 1);
            }}>Resign</button>
          </div>
          <p className="live-notice" aria-live="polite">{notice}</p>
        </section>
        <aside className="sidebar">
          <section className="card settings"><p className="eyebrow">MAKE IT YOUR GAME</p><h2>Practice room</h2>
            <label htmlFor="mode">Play mode</label><select id="mode" value={mode} onChange={e => reset(e.target.value as typeof mode)}>
              <option value="local">Local two-player</option><option value="ai">Play AI · you are Black</option>
            </select>
            <label htmlFor="budget">Search budget</label><select id="budget" value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))}>
              <option value={200}>Quick · 0.2 seconds</option><option value={500}>Standard · 0.5 seconds</option><option value={1500}>Patient · 1.5 seconds</option>
            </select><p className="muted small">Classical evaluation. Strength is uncalibrated.</p>
          </section>
          <section className="card analysis" aria-label="Engine analysis"><div className="card-title"><h2>Explore the position</h2><span className={`engine-light ${status}`} aria-label={`Engine ${status}`} /></div>
            <p className="muted">Real candidate moves from Fairy-Stockfish, running in your browser.</p>
            <div className="analysis-controls"><button className="primary" disabled={busy || !!outcome || !!preview} onClick={() => void runSearch(mode === 'ai' && position.color === Color.WHITE)}>
              {status === 'loading' ? 'Loading WASM…' : status === 'searching' ? 'Thinking…' : mode === 'ai' && position.color === Color.WHITE ? 'Resume AI turn' : 'Analyze position'}</button>
              {busy && <button onClick={() => void stop()}>Stop search</button>}</div>
            {error && <div role="alert" className="error"><strong>Engine unavailable</strong><p>{error}</p><p>Local two-player mode remains available.</p></div>}
            {analysis ? <>
              <p className="analysis-caption">After {analysis.ply} moves · {sideName(analysis.base.color)} to move · {analysis.result.elapsedMs.toFixed(0)} ms</p>
              <p className="small">Scores are from the analyzed side’s perspective. Positive favors {sideName(analysis.base.color)}.</p>
              <div className="candidates">{analysis.result.candidates.map((line, index) => <button key={line.multiPv}
                aria-pressed={index === candidateIndex && !!previewPly} onClick={() => { setCandidateIndex(index); setPreviewPly(1); setSelected(null); }}>
                <span className="candidate-rank">{line.multiPv.toString().padStart(2, '0')}</span><strong>{line.firstMoveUSI}</strong>
                <span>{formatScore(line.score)}<small>Depth {line.depth}</small></span>
              </button>)}</div>
              {!analysis.result.candidates.length && <p>No candidate variations were reported by this search.</p>}
              {candidate && <div className="variation"><p className="eyebrow">PRINCIPAL VARIATION · USI</p>
                <p className="pv" data-testid="pv">{candidate.pvUSI.join(' → ')}</p>
                <div className="preview-controls"><button disabled={previewPly <= 0} onClick={() => setPreviewPly(p => p - 1)}>← Previous</button>
                  <button disabled={previewPly >= candidate.pvUSI.length} onClick={() => setPreviewPly(p => p + 1)}>Next →</button></div>
              </div>}
              {diagnostics?.multiPvMax === 1 && <p>MultiPV is unsupported by this engine artifact.</p>}
            </> : <div className="analysis-empty"><span>↗</span><p>Every position has possibilities.</p><small>Analyze to see the engine’s top moves and explore their continuations.</small></div>}
            {diagnostics && <details><summary>Engine details</summary><p>{diagnostics.name}</p><p>Startup {diagnostics.startupMs.toFixed(0)} ms · WASM memory {(diagnostics.wasmMemoryBytes / 1048576).toFixed(0)} MiB · 1 search thread · 16 MiB hash</p><p>Shared memory requires COOP/COEP headers. Memory shown excludes browser and worker overhead.</p></details>}
          </section>
          <section className="card record"><div className="card-title"><h2>Move record</h2><span className="muted">{game.moves.length} plies</span></div>
            {game.moves.length ? <ol className="move-list">{game.moves.map((usi, index) => <li key={index}><span>{index + 1}.</span><code>{usi}</code></li>)}</ol> : <p className="muted">Your opening move goes here.</p>}
            <details><summary>Current SFEN</summary><code data-testid="sfen">{game.record.sfen}</code></details>
          </section>
        </aside>
      </div>
      <footer>English piece initials · + means promoted · Black moves toward rank a · Local technical prototype
        <br /><a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a></footer>
    </main>
  </div>;
}
