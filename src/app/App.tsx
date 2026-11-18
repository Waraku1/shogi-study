import { historyNotation, pvNotation, japaneseMove, terminalNotation, outcomeTerminal } from '../features/shogi/notation';
import { SpecialMoveType } from 'tsshogi';
import { Review } from '../features/review/Review';
import { useAccess, refreshAccess, assertAnalysisAllowed, guestOnly } from '../features/review/access';
import { saveGame } from '../features/review/store';
import '../features/review/review.css';
import './workspace.css';
import { QuickLearn } from '../features/learning/QuickLearn';
import { guestNamespace } from '../features/learning/types';
import { Online } from '../features/shogi/Online';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, Square, Move } from 'tsshogi';
import type { Position } from 'tsshogi';
import { Board, focusBoardSquare } from '../features/shogi/Board';
import { LocalGame, isLegalUSI, legalMoves, sideName, validatePV } from '../features/shogi/game';
import type { MoveSource } from '../features/shogi/game';
import { WasmEngineAdapter } from '../features/engine/adapter';
import { formatScore } from '../features/engine/usi';
import type { EngineDiagnostics, SearchResult } from '../shared/contracts/engine';

type Analysis = { result: SearchResult; base: Position; ply: number };
type Status = 'idle' | 'loading' | 'ready' | 'searching' | 'error';

export function App() {
  const query = new URLSearchParams(location.search);
  const [view, setView] = useState<'play'|'learn'|'review'>(query.has('learn')?'learn':query.has('review')?'review':'play');
  const [learnVisited,setLearnVisited]=useState(query.has('learn'));
  const [reviewVisited,setReviewVisited]=useState(query.has('review'));
  const [learningContext,setLearningContext]=useState<'play'|'review'>(query.has('review')?'review':'play');
  const [onlineOpen,setOnlineOpen]=useState(!guestOnly&&query.has('room'));
  const [onlineShown,setOnlineShown]=useState(!guestOnly&&query.has('room'));
  const [onlineKey,setOnlineKey]=useState(query.get('room')??'new');
  const roomRef=useRef(query.get('room')??'');
  const access=useAccess();
  function navigate(next:'play'|'learn'|'review') {
    const context=next==='learn'?(view==='learn'?learningContext:view==='review'?'review':'play'):next==='review'?'review':'play';
    setLearningContext(context);setView(next); if(next==='learn')setLearnVisited(true);if(next==='review')setReviewVisited(true);
    history.replaceState(null,'',next==='play'?(onlineShown?`?room=${encodeURIComponent(roomRef.current)}`:'/'):next==='learn'?(context==='review'?'?learn=1&review=1':onlineShown?'?room='+encodeURIComponent(roomRef.current)+'&learn=1':'?learn=1'):'?review=1');void refreshAccess();
  }
  function online(id?:string){
    if(id){roomRef.current=id;setOnlineKey(id);}
    history.replaceState(null,'',`?room=${encodeURIComponent(roomRef.current)}`);setOnlineOpen(true);setOnlineShown(true);setLearningContext('play');setView('play');void refreshAccess();
  }
  useEffect(()=>{if(access.blocked){setOnlineShown(true);setLearningContext('play');}},[access.blocked]);
  const reviewVisible=view==='review'||(view==='learn'&&learningContext==='review');
  const localVisible=!reviewVisible&&!onlineShown&&!access.blocked&&!access.checking;
  const onlineVisible=!reviewVisible&&onlineShown;
  return <>
    <nav className="app-nav" aria-label="Main navigation">
      <button aria-current={view==='play'?'page':undefined} onClick={()=>navigate('play')}>Play</button>
      <button aria-current={view==='learn'?'page':undefined} onClick={()=>navigate('learn')}>Learn</button>
      <button aria-current={view==='review'?'page':undefined} disabled={access.blocked||access.checking} onClick={()=>navigate('review')}>Review</button>
      {!guestOnly&&<button onClick={()=>online()}>Online rooms</button>}
    </nav>
    {access.reason&&<div className="access-notice" role="status">{access.reason}{access.activeRooms.map(id=><button key={id} onClick={()=>online(id)}>Resume online room</button>)}</div>}
    {access.checking&&<p role="status">Checking play status…</p>}
    {access.blocked&&<p className="access-notice">No Review or engine assistance while match status is active or unknown. This restriction cannot prevent use of external engines. <button onClick={()=>void refreshAccess()}>Retry online status</button></p>}
    <div className={`shared-workspace${view==='learn'&&(localVisible||reviewVisible)&&!access.blocked?' learning-open':''}`}>
      <div className="game-space">{access.namespace&&<LocalApp key={'practice:'+access.namespace} namespace={access.namespace} analysisBlocked={access.blocked} visible={localVisible}/>}{reviewVisited&&access.namespace&&!access.blocked&&!access.checking&&<Review key={'review:'+access.namespace} namespace={access.namespace} blocked={access.blocked} visible={reviewVisible}/> }</div>
      {onlineOpen&&<Online key={onlineKey} visible={onlineVisible} workspaceLearn={view==='learn'} onRoom={id=>{roomRef.current=id;}} back={()=>{setOnlineShown(false);history.replaceState(null,'','/');void refreshAccess();}}/>}
      {learnVisited&&!(onlineOpen&&onlineShown&&!reviewVisible)&&<section hidden={view!=='learn'} className="learn-page workspace-learning" aria-label="Learning workspace">
        <button onClick={()=>navigate('play')}>Back to practice</button><h1>Learn</h1><p>Keep the board in view while you study. No login needed.</p>
        <details open><summary>Learning cards beside the board</summary><QuickLearn key={guestNamespace} namespace={guestNamespace} standalone/></details>
      </section>}
    </div>
    {reviewVisible&&(access.checking||access.blocked||!access.namespace)&&<main><h1>Review paused</h1><p role="status">Finish or reconnect to your online match before using Review.</p></main>}
  </>;
}

function LocalApp({namespace,analysisBlocked,visible}:{namespace:string;analysisBlocked:boolean;visible:boolean}) {
  const [game, setGame] = useState(() => new LocalGame());
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<'local' | 'ai'>('local');
  const [budget, setBudget] = useState(500);
  const [selected, setSelected] = useState<MoveSource | null>(null);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const promotionTarget=useRef<string|null>(null);
  useEffect(()=>{if(!promotion&&visible&&promotionTarget.current){focusBoardSquare(promotionTarget.current);promotionTarget.current=null;}},[promotion,visible]);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('Black moves first.');
  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [previewPly, setPreviewPly] = useState(0);
  const engine = useRef<WasmEngineAdapter | null>(null);
  const generation = useRef(0);
  const archiveId=useRef(crypto.randomUUID());
  const archived=useRef(false);
  const [archiveNotice,setArchiveNotice]=useState('Games are saved on this device as you play.');
  const running = useRef(false);
  const outcome = useMemo(() => game.outcome, [game, revision]);
  const position = game.position;
  const displayMoves = useMemo(()=>historyNotation(game.moves),[game,revision]);
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
  useEffect(()=>{if(analysisBlocked)cancelWork();},[analysisBlocked]);
  function saveCurrent(){
    if(analysisBlocked)return;
    archived.current=true;setArchiveNotice('Saving game…');
    void saveGame(namespace,{source:'shogi-study',version:1,id:archiveId.current,mode,moves:[...game.moves],result:{status:outcome?'finished':'unfinished',text:outcome?`${outcome.winner??'Draw'}: ${outcome.reason}`:'Unfinished practice'},savedAt:Date.now()}).then(setArchiveNotice,e=>setArchiveNotice(`Game could not be saved: ${String(e)}`));
  }
  useEffect(()=>{if(game.moves.length||outcome||archived.current)saveCurrent();},[game,revision,mode,namespace]);

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
    archiveId.current=crypto.randomUUID();archived.current=false;
    cancelWork(); setMode(nextMode); setGame(new LocalGame()); setRevision(0); setNotice('New game. Black moves first.');
  }
  function play(usi: string) {
    const display = japaneseMove(game.position,usi,game.record.current.move instanceof Move ? game.record.current.move : undefined);
    if (!game.play(usi)) { setNotice(`Illegal move rejected: ${usi}`); return; }
    setSelected(null); setPromotion(null); clearAnalysis(); setError('');
    setNotice(`${display} played.`); setRevision(value => value + 1);
  }
  function selectSquare(square: Square) {
    if (selected) {
      const options = [...legalMoves(position, selected)].filter(move => move.to.equals(square));
      if (options.length === 1) { play(options[0].usi); return; }
      if (options.length > 1) { promotionTarget.current=square.usi;setPromotion(options); return; }
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
      await assertAnalysisAllowed();
      if(token!==generation.current)return;
      await adapter.init();
      if (token !== generation.current) return;
      setDiagnostics(adapter.diagnostics);
      setStatus('searching');
      const result = await adapter.search({ kind: 'startpos', moves: game.moves }, { maxTimeMs: budget, multiPv: 3 });
      if (token !== generation.current) return;
      await assertAnalysisAllowed();
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
      setNotice(applyMove ? `AI played ${pvNotation(game.moves.slice(0,ply),[result.bestMoveUSI!])[0].japanese}. Your turn.` : 'Analysis complete. Select a candidate to explore its variation.');
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

  if (!visible) return null;
  return <div className="app-shell">
    <header className="site-header">
      <a className="wordmark" href="/" aria-label="Shogi Study home"><span className="brand-mark">歩</span>SHOGI <b>STUDY</b></a>
      <span className="prototype-badge">LOCAL STUDY WORKSPACE</span>
    </header>
    <main>
      <div className="page-intro"><div><p className="eyebrow">PLAY. EXPLORE. UNDERSTAND.</p><h1>Your next move starts here.</h1>
        <p>A quiet place to learn Shogi, one position at a time.</p></div><span className="local-label"><span />Local session</span></div>
      <div className="workspace">
        <section className="play-panel" aria-label="Local Shogi game">
          <div className="panel-top"><div><p className="eyebrow">{preview ? 'VARIATION PREVIEW' : mode === 'ai' ? 'HUMAN VS WASM AI' : 'TWO PLAYERS · ONE BOARD'}</p>
            <h2 aria-live="polite">{preview ? `Variation · ply ${previewPly}` : outcome ? `${outcome.winner ? `${sideName(outcome.winner)} wins` : 'Draw'}` : `${sideName(position.color)} to move`}</h2>
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
          <p className="live-notice" aria-live="polite">{notice}</p><button disabled={analysisBlocked} onClick={saveCurrent}>Save game</button><p role="status">{archiveNotice}</p>
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
                <span className="candidate-rank">{line.multiPv.toString().padStart(2, '0')}</span><strong lang="ja">{pvNotation(game.moves.slice(0,analysis.ply),[line.firstMoveUSI])[0].japanese}</strong>
                <span>{formatScore(line.score)}<small>Depth {line.depth}</small></span>
              </button>)}</div>
              {!analysis.result.candidates.length && <p>No candidate variations were reported by this search.</p>}
              {candidate && <div className="variation"><p className="eyebrow">PRINCIPAL VARIATION · JAPANESE</p>
                <p className="pv" lang="ja" data-testid="pv">{pvNotation(game.moves.slice(0,analysis.ply),candidate.pvUSI).map(m=>`${m.ply}. ${m.japanese}`).join(' → ')}</p>
                <div className="preview-controls"><button disabled={previewPly <= 0} onClick={() => setPreviewPly(p => p - 1)}>← Previous</button>
                  <button disabled={previewPly >= candidate.pvUSI.length} onClick={() => setPreviewPly(p => p + 1)}>Next →</button></div>
              </div>}
              {diagnostics?.multiPvMax === 1 && <p>MultiPV is unsupported by this engine artifact.</p>}
            </> : <div className="analysis-empty"><span>↗</span><p>Every position has possibilities.</p><small>Analyze to see the engine’s top moves and explore their continuations.</small></div>}
            {diagnostics && <details><summary>Engine details</summary><p>{diagnostics.name}</p><p>Startup {diagnostics.startupMs.toFixed(0)} ms · WASM memory {(diagnostics.wasmMemoryBytes / 1048576).toFixed(0)} MiB · 1 search thread · 16 MiB hash</p><p>Shared memory requires COOP/COEP headers. Memory shown excludes browser and worker overhead.</p></details>}
          </section>
          <section className="card record"><div className="card-title"><h2>Move record</h2><span className="muted">{game.moves.length} plies</span></div>
            {game.moves.length ? <ol className="move-list">{displayMoves.map(move => <li key={move.ply}><span>{move.ply}.</span><span lang="ja" title={move.usi}>{move.japanese}</span></li>)}</ol> : <p className="muted">Your opening move goes here.</p>}
            {outcome&&<p lang="ja">{game.moves.length+1}. {terminalNotation(game.record.current.move instanceof Move ? outcomeTerminal(outcome.reason) : game.record.current.move.type === 'any' ? SpecialMoveType.INTERRUPT : game.record.current.move.type)}</p>}
            <details><summary>Current SFEN</summary><code data-testid="sfen">{game.record.sfen}</code></details>
          </section>
        </aside>
      </div>
      <footer>Japanese pieces · ▲ Black faces up · △ White faces down · Red lettering marks promotion
        <br /><a href="/THIRD_PARTY_NOTICES.txt">Third-party notices</a></footer>
    </main>
  </div>;
}
