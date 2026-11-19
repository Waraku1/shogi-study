import { useEffect, useRef, useState } from 'react';
import { Move, Square } from 'tsshogi';
import { Board, focusBoardSquare } from '../shogi/Board';
import { legalMoves, validatePV } from '../shogi/game';
import type { MoveSource } from '../shogi/game';
import {
  historyNotation,
  japaneseMove,
  pvNotation,
  terminalNotation,
} from '../shogi/notation';
import { WasmEngineAdapter } from '../engine/adapter';
import { formatScore } from '../engine/usi';
import type { SearchResult } from '../../shared/contracts/engine';
import { assertAnalysisAllowed } from './access';
import { ArchiveStore } from './store';
import { StudyStore, studyArchive, validateStudy } from './studies';
import type { StudyVariation } from './studies';
import {
  archiveTerminal,
  downloadGame,
  exportCompatible,
  parseGameText,
} from './record-io';
import {
  MAX_BYTES,
  MAX_GAMES,
  exportArchive,
  replay,
  variationPosition,
} from './archive';
import type { GameArchive } from './archive';

type Draft = { anchorPly: number; moves: string[]; label: string };
export function Review({
  namespace,
  blocked,
  visible = true,
}: {
  namespace: string;
  blocked: boolean;
  visible?: boolean;
}) {
  const [rows, setRows] = useState<GameArchive[]>([]);
  const [record, setRecord] = useState<GameArchive | null>(null);
  const [ply, setPly] = useState(0);
  const [json, setJSON] = useState('');
  const [format, setFormat] = useState<'json' | 'kif' | 'csa'>('json');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('Loading saved games…');
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<SearchResult | null>(null);
  const [candidate, setCandidate] = useState(0);
  const [future, setFuture] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingStudy, setDeletingStudy] = useState<string | null>(null);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [studyDeleteError, setStudyDeleteError] = useState('');
  const deletionPending = useRef(false);
  const currentRecord = useRef(record);
  currentRecord.current = record;
  const [studies, setStudies] = useState<StudyVariation[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [studyActive, setStudyActive] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [studyNotice, setStudyNotice] = useState('');
  const [savingStudy, setSavingStudy] = useState(false);
  const [selected, setSelected] = useState<MoveSource | null>(null);
  const [promotion, setPromotion] = useState<Move[] | null>(null);
  const promotionTarget = useRef<string | null>(null);
  const store = useRef<ArchiveStore | null>(null),
    studyStore = useRef<StudyStore | null>(null);
  const engine = useRef<WasmEngineAdapter | null>(null),
    generation = useRef(0);
  const deleteFocus = useRef<HTMLButtonElement | null>(null);
  const studyDeleteFocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const s = new ArchiveStore(namespace),
      t = new StudyStore(namespace);
    store.current = s;
    studyStore.current = t;
    const reload = () =>
      s.list().then((r) => {
        if (store.current === s) {
          setRows(r);
          setNotice(
            s.warning ||
              'Saved on this device. Imported results are unverified descriptions.',
          );
        }
      });
    void reload();
    void t.list().then((r) => {
      if (studyStore.current === t) {
        setStudies(r);
        setStudyNotice(t.warning);
      }
    });
    const changed = (e: Event) => {
      if ((e as CustomEvent).detail === namespace) void reload();
    };
    window.addEventListener('archive-saved', changed);
    return () => {
      window.removeEventListener('archive-saved', changed);
      store.current = null;
      studyStore.current = null;
      s.close();
      t.close();
      engine.current?.dispose();
      generation.current++;
    };
  }, [namespace]);
  useEffect(() => {
    if (!visible) {
      generation.current++;
      engine.current?.dispose();
      engine.current = null;
      setBusy(false);
    }
  }, [visible]);
  useEffect(() => {
    if (!promotion && visible && promotionTarget.current) {
      focusBoardSquare(promotionTarget.current);
      promotionTarget.current = null;
    }
  }, [promotion, visible]);
  function stop() {
    generation.current++;
    engine.current?.dispose();
    engine.current = null;
    setBusy(false);
    setAnalysis(null);
    setFuture(0);
    setSelected(null);
    setPromotion(null);
  }
  useEffect(() => {
    if (blocked) stop();
  }, [blocked]);
  function jump(n: number) {
    stop();
    setStudyActive(false);
    setPly(n);
  }
  function jumpStudy(n: number) {
    stop();
    setCursor(n);
  }
  function selectRecord(r: GameArchive) {
    stop();
    setRecord(r);
    setPly(0);
    setDraft(null);
    setStudyActive(false);
    setError('');
  }
  async function load() {
    const s = store.current;
    if (!s) return;
    const rows = await s.list();
    if (store.current === s) {
      setRows(rows);
      setNotice(s.warning || 'Saved on this device.');
    }
  }
  async function deleteSavedGame() {
    const s = store.current,
      id = deleting;
    if (!s || !id || deletionPending.current) return;
    deletionPending.current = true;
    setDeletionBusy(true);
    setDeleteError('');
    setNotice('');
    try {
      const mode = await s.remove(id);
      if (store.current !== s) return;
      setRows((rows) => rows.filter((r) => r.id !== id));
      if (currentRecord.current?.id === id) {
        stop();
        setRecord(null);
        setDraft(null);
      }
      setDeleting(null);
      setNotice(
        mode === 'memory'
          ? 'Saved game removed from this session only. Device storage was not changed; earlier saved copies may reappear after reload.'
          : 'Saved game deleted from this device.',
      );
    } catch (e) {
      if (store.current === s)
        setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      deletionPending.current = false;
      setDeletionBusy(false);
    }
  }
  async function deleteSavedStudy() {
    const s = studyStore.current,
      id = deletingStudy;
    if (!s || !id || deletionPending.current) return;
    deletionPending.current = true;
    setDeletionBusy(true);
    setStudyDeleteError('');
    setStudyNotice('');
    try {
      const mode = await s.remove(id);
      if (studyStore.current !== s) return;
      setStudies((rows) => rows.filter((r) => r.id !== id));
      setDeletingStudy(null);
      setStudyNotice(
        mode === 'memory'
          ? 'Study variation removed from this session only. Device storage was not changed; earlier saved copies may reappear after reload.'
          : 'Study variation deleted.',
      );
    } catch (e) {
      if (studyStore.current === s)
        setStudyDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      deletionPending.current = false;
      setDeletionBusy(false);
    }
  }
  async function importText(text: string, kind = format) {
    try {
      setError('');
      await assertAnalysisAllowed();
      const s = store.current;
      if (!s) return;
      const game = parseGameText(text, kind);
      await s.put(game, true);
      if (store.current !== s) return;
      await load();
      selectRecord(game);
      setNotice(
        s.warning ||
          'Imported valid standard-start game. The recorded result is not independently verified.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const inStudy = studyActive && draft !== null;
  const activeArchive = record
    ? inStudy
      ? studyArchive({
          parent: record,
          anchorPly: draft.anchorPly,
          moves: draft.moves.slice(0, cursor),
        })
      : { ...record, moves: record.moves.slice(0, ply) }
    : null;
  const activeMoves = activeArchive?.moves ?? [];
  const line = analysis?.candidates[candidate];
  const position = activeArchive
    ? future && line
      ? variationPosition(activeArchive, activeMoves.length, line.pvUSI, future)
      : replay(activeArchive).position
    : null;
  const terminal = record ? archiveTerminal(record) : undefined;
  async function analyze() {
    if (!activeArchive || busy || blocked) return;
    const token = ++generation.current,
      target = activeArchive;
    setBusy(true);
    setError('');
    setAnalysis(null);
    setFuture(0);
    setSelected(null);
    setPromotion(null);
    try {
      await assertAnalysisAllowed();
      if (token !== generation.current) return;
      const e = (engine.current ??= new WasmEngineAdapter());
      const result = await e.search(
        { kind: 'startpos', moves: target.moves },
        { maxTimeMs: 300, multiPv: 3 },
      );
      if (token !== generation.current) return;
      await assertAnalysisAllowed();
      if (token !== generation.current) return;
      const base = replay(target).position;
      if (
        (result.bestMoveUSI && !validatePV(base, [result.bestMoveUSI])) ||
        result.candidates.some((c) => !validatePV(base, c.pvUSI))
      )
        throw new Error('Engine returned an illegal move or variation');
      setAnalysis(result);
      setCandidate(0);
    } catch (e) {
      if (token === generation.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function startStudy() {
    if (!record) return;
    try {
      await assertAnalysisAllowed();
      if (!store.current) return;
      stop();
      setDraft({ anchorPly: ply, moves: [], label: 'Study from ply ' + ply });
      setCursor(0);
      setStudyActive(true);
      setStudyNotice(
        'Unsaved study. Play an alternative line, then save it separately from the original.',
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function playStudy(usi: string) {
    if (!inStudy || !draft || !activeArchive || !position) return;
    const game = replay(activeArchive);
    const display = japaneseMove(
      game.position,
      usi,
      game.record.current.move instanceof Move
        ? game.record.current.move
        : undefined,
    );
    if (!game.play(usi)) {
      setError('Illegal study move');
      return;
    }
    const moves = [...draft.moves.slice(0, cursor), usi];
    stop();
    setDraft({ ...draft, moves });
    setCursor(moves.length);
    setError('');
    setStudyNotice(
      display + ' played in an unsaved study; the original game is unchanged.',
    );
  }
  function selectSquare(square: Square) {
    if (!inStudy || !position || future) return;
    if (selected) {
      const options = [...legalMoves(position, selected)].filter((m) =>
        m.to.equals(square),
      );
      if (options.length === 1) {
        playStudy(options[0].usi);
        return;
      }
      if (options.length > 1) {
        promotionTarget.current = square.usi;
        setPromotion(options);
        return;
      }
      setError('Illegal move. Choose a highlighted destination.');
    }
    setSelected(
      position.board.at(square)?.color === position.color ? square : null,
    );
  }
  async function saveStudy() {
    if (!record || !draft?.moves.length || savingStudy) return;
    const target = studyStore.current;
    if (!target) return;
    setSavingStudy(true);
    setStudyNotice('Saving study variation…');
    try {
      await assertAnalysisAllowed();
      if (studyStore.current !== target) return;
      const saved = validateStudy({
        source: 'shogi-study-variation',
        version: 1,
        id: crypto.randomUUID(),
        parent: record,
        ...draft,
        savedAt: Date.now(),
      });
      await target.put(saved);
      const list = await target.list();
      if (studyStore.current !== target) return;
      setStudies(list);
      setStudyNotice(
        target.warning ||
          'Study variation saved on this device. Original game unchanged.',
      );
    } catch (e) {
      setStudyNotice('Study could not be saved: ' + String(e));
    } finally {
      setSavingStudy(false);
    }
  }
  function openStudy(s: StudyVariation) {
    stop();
    setRecord(s.parent);
    setPly(s.anchorPly);
    setDraft({ anchorPly: s.anchorPly, moves: [...s.moves], label: s.label });
    setCursor(s.moves.length);
    setStudyActive(true);
    setError('');
    setStudyNotice(
      'Saved study opened. Further edits are a draft; Save creates a separate copy.',
    );
  }
  function exportStudy(kind: 'json' | 'kif') {
    if (!record || !draft) return;
    const game = validateArchiveForStudy(record, draft);
    downloadGame(
      kind === 'json' ? exportArchive(game) : exportCompatible(game, 'kif'),
      'shogi-study-' + game.id + '.' + kind,
    );
  }
  if (!visible) return null;
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
  return (
    <main className={'review-page' + (record ? ' has-record' : '')}>
      <h1>Review</h1>
      <p>
        Replay, research and independent study variations. Standard-start JSON
        v1, UTF-8 KIF and CSA; at most 512 plies and 64 KiB per import.
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
                aria-pressed={record?.id === r.id && !inStudy}
                onClick={() => selectRecord(r)}
              >
                {r.mode +
                  ' · ' +
                  r.moves.length +
                  ' plies · ' +
                  r.result.text +
                  ' · ' +
                  new Date(r.savedAt).toLocaleString('en')}
              </button>
              <button
                aria-label={'Delete saved game ' + r.id}
                disabled={deletionBusy}
                onClick={(e) => {
                  deleteFocus.current = e.currentTarget;
                  setDeleteError('');
                  setDeletingStudy(null);
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
          <p>
            Delete this saved game from this profile on this device? Saved
            studies retain their original snapshot. In memory-only mode, removal
            affects this session only.
          </p>
          {deleteError && <p role="alert">{deleteError}</p>}
          {deletionBusy && (
            <p role="status">
              Deleting saved game… Waiting for device storage.
            </p>
          )}
          <button
            autoFocus
            disabled={deletionBusy}
            onClick={() => {
              setDeleting(null);
              deleteFocus.current?.focus();
            }}
          >
            Cancel deletion
          </button>
          <button
            disabled={deletionBusy}
            onClick={() => void deleteSavedGame()}
          >
            {deleteError ? 'Retry deletion' : 'Confirm deletion'}
          </button>
        </section>
      )}
      <section aria-label="Saved study variations">
        <h2>Study variations</h2>
        <p>
          Separate local copies, up to {MAX_GAMES} per profile. A study never
          rewrites the original archive.
        </p>
        <p role="status">{studyNotice}</p>
        {!studies.length && <p>No study variations saved for this profile.</p>}
        <div className="study-list">
          {studies.map((s) => (
            <div key={s.id}>
              <button onClick={() => openStudy(s)}>
                {s.label + ' · ' + s.moves.length + ' branch plies'}
              </button>
              <button
                aria-label={'Delete study variation ' + s.id}
                disabled={deletionBusy}
                onClick={(e) => {
                  studyDeleteFocus.current = e.currentTarget;
                  setStudyDeleteError('');
                  setDeleting(null);
                  setDeletingStudy(s.id);
                }}
              >
                Delete study
              </button>
            </div>
          ))}
        </div>
        {deletingStudy && (
          <div
            role="alertdialog"
            aria-modal="false"
            aria-label="Delete study variation"
          >
            <p>
              Delete this saved study variation? The original game is kept. In
              memory-only mode, removal affects this session only.
            </p>
            {studyDeleteError && <p role="alert">{studyDeleteError}</p>}
            {deletionBusy && (
              <p role="status">
                Deleting study variation… Waiting for device storage.
              </p>
            )}
            <button
              autoFocus
              disabled={deletionBusy}
              onClick={() => {
                setDeletingStudy(null);
                studyDeleteFocus.current?.focus();
              }}
            >
              Cancel study deletion
            </button>
            <button
              disabled={deletionBusy}
              onClick={() => void deleteSavedStudy()}
            >
              {studyDeleteError
                ? 'Retry study deletion'
                : 'Confirm study deletion'}
            </button>
          </div>
        )}
      </section>
      <section aria-label="Import and export">
        <h2>Portable game records</h2>
        <label>
          Record format{' '}
          <select
            aria-label="Record format"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as typeof format);
              setError('');
            }}
          >
            <option value="json">JSON v1</option>
            <option value="kif">KIF (UTF-8)</option>
            <option value="csa">CSA (UTF-8)</option>
          </select>
        </label>
        <label>
          {format === 'json' ? 'Game JSON' : 'Game record text'}
          <textarea
            aria-label={format === 'json' ? 'Game JSON' : 'Game record text'}
            maxLength={MAX_BYTES}
            value={json}
            onChange={(e) => setJSON(e.target.value)}
            rows={5}
          />
        </label>
        <button onClick={() => void importText(json)}>
          {'Import ' + format.toUpperCase()}
        </button>
        <label>
          {'Import ' + format.toUpperCase() + ' file'}
          <input
            type="file"
            accept=".json,.kif,.csa,.txt,application/json,text/plain"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > MAX_BYTES) {
                setError('Game file exceeds 64 KiB');
                return;
              }
              const ext = f.name.split('.').pop()?.toLowerCase();
              const kind =
                ext === 'kif' || ext === 'csa' || ext === 'json' ? ext : format;
              await importText(await f.text(), kind);
              e.target.value = '';
            }}
          />
        </label>
        <button
          disabled={!record}
          onClick={() => {
            const text = exportArchive(record!);
            setJSON(text);
            downloadGame(text, 'shogi-' + record!.id + '.json');
          }}
        >
          Export selected JSON
        </button>
        <button
          disabled={!record}
          onClick={() =>
            downloadGame(
              exportCompatible(record!, 'kif'),
              'shogi-' + record!.id + '.kif',
            )
          }
        >
          Export selected KIF
        </button>
        <button
          disabled={!record}
          onClick={() =>
            downloadGame(
              exportCompatible(record!, 'csa'),
              'shogi-' + record!.id + '.csa',
            )
          }
        >
          Export selected CSA
        </button>
        <p>
          These controls export the original selected game. KIF/CSA import
          accepts one standard-start main line; comments/private metadata,
          custom starts and embedded branches are not imported. Unknown result
          descriptions export as 中断.
        </p>
      </section>
      {record && position && (
        <section aria-label="Game replay">
          <h2>
            {future
              ? 'Variation preview · ' + future + ' plies'
              : inStudy
                ? 'Study · ply ' +
                  activeMoves.length +
                  ' (' +
                  cursor +
                  '/' +
                  draft!.moves.length +
                  ' branch plies)'
                : 'Replay · ply ' + ply + ' of ' + record.moves.length}
          </h2>
          <p role="status">
            {(inStudy ? 'Study' : 'Saved') +
              ' ply ' +
              activeMoves.length +
              '; ' +
              position.color +
              ' to move.'}
          </p>
          <p>
            {record.result.text +
              ' · ' +
              (record.publicNames?.join(' / ') ?? '')}
          </p>
          <div className="review-controls">
            <button disabled={!ply && !inStudy} onClick={() => jump(0)}>
              Beginning
            </button>
            <button
              disabled={!ply && !inStudy}
              onClick={() => jump(Math.max(0, ply - 1))}
            >
              Previous move
            </button>
            <button
              disabled={ply === record.moves.length && !inStudy}
              onClick={() => jump(Math.min(record.moves.length, ply + 1))}
            >
              Next move
            </button>
            <button
              disabled={ply === record.moves.length && !inStudy}
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
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 0 && n <= record.moves.length)
                    jump(n);
                }}
              />
            </label>
          </div>
          <div className="review-history" aria-label="Original move sequence">
            {historyNotation(record.moves).map((m) => (
              <button
                key={m.ply}
                lang="ja"
                aria-current={!inStudy && ply === m.ply ? 'step' : undefined}
                title={m.usi}
                onClick={() => jump(m.ply)}
              >
                {m.ply + '. ' + m.japanese}
              </button>
            ))}
          </div>
          {terminal && (
            <p lang="ja">
              {record.moves.length + 1 + '. ' + terminalNotation(terminal)}
            </p>
          )}
          <div className="study-controls">
            {!inStudy && (
              <button onClick={() => void startStudy()}>
                Start study variation
              </button>
            )}
            {!inStudy && draft && (
              <button
                onClick={() => {
                  stop();
                  setStudyActive(true);
                }}
              >
                Resume draft variation
              </button>
            )}
            {inStudy && (
              <>
                <button onClick={() => jump(draft!.anchorPly)}>
                  Return to original game
                </button>
                <button
                  disabled={!cursor}
                  onClick={() => jumpStudy(cursor - 1)}
                >
                  Previous study move
                </button>
                <button
                  disabled={cursor >= draft!.moves.length}
                  onClick={() => jumpStudy(cursor + 1)}
                >
                  Next study move
                </button>
                <button
                  disabled={!draft!.moves.length || savingStudy}
                  onClick={() => void saveStudy()}
                >
                  Save study variation
                </button>
                <button
                  disabled={!draft!.moves.length}
                  onClick={() => exportStudy('json')}
                >
                  Export study JSON
                </button>
                <button
                  disabled={!draft!.moves.length}
                  onClick={() => exportStudy('kif')}
                >
                  Export study KIF
                </button>
              </>
            )}
          </div>
          {inStudy && (
            <div className="study-banner">
              <label>
                Study name
                <input
                  aria-label="Study name"
                  maxLength={80}
                  value={draft!.label}
                  onChange={(e) =>
                    setDraft({ ...draft!, label: e.target.value })
                  }
                />
              </label>
              <p>
                Editable study from original ply {draft!.anchorPly}. Playing at
                an earlier study move replaces only the draft continuation.
              </p>
              <div className="review-history" aria-label="Study move sequence">
                {pvNotation(
                  record.moves.slice(0, draft!.anchorPly),
                  draft!.moves,
                ).map((m, i) => (
                  <button
                    key={i}
                    lang="ja"
                    aria-current={cursor === i + 1 ? 'step' : undefined}
                    onClick={() => jumpStudy(i + 1)}
                  >
                    {m.ply + '. ' + m.japanese}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Board
            position={position}
            selected={inStudy && !future ? selected : null}
            disabled={!inStudy || !!future || busy || !!promotion}
            onSelect={selectSquare}
            onHand={setSelected}
          />
          {promotion && (
            <div
              role="dialog"
              aria-label="Choose promotion"
              className="promotion-choice"
            >
              {promotion.map((m) => (
                <button
                  autoFocus={m.promote}
                  key={m.usi}
                  onClick={() => playStudy(m.usi)}
                >
                  {m.promote ? 'Promote' : 'Keep unpromoted'}
                </button>
              ))}
              <button
                onClick={() => {
                  setPromotion(null);
                  setSelected(null);
                }}
              >
                Cancel
              </button>
            </div>
          )}
          <code data-testid="replay-sfen">
            {position.getSFEN(activeMoves.length + future + 1)}
          </code>
          <button disabled={busy} onClick={() => void analyze()}>
            {busy ? 'Analyzing saved position…' : 'Analyze saved position'}
          </button>
          {busy && <button onClick={stop}>Stop analysis</button>}
          {analysis && (
            <>
              <p>
                Score perspective: side to move at analyzed ply{' '}
                {activeMoves.length}. {analysis.elapsedMs.toFixed(0)} ms. Mate
                distances are plies; negative means being mated.
              </p>
              <div className="review-candidates">
                {analysis.candidates.map((c, i) => (
                  <button
                    key={c.multiPv}
                    onClick={() => {
                      setCandidate(i);
                      setFuture(1);
                      setSelected(null);
                    }}
                  >
                    <span lang="ja">
                      {pvNotation(activeMoves, [c.firstMoveUSI])[0].japanese}
                    </span>
                    {' · depth ' + c.depth + ' · ' + formatScore(c.score)}
                  </button>
                ))}
              </div>
              {line && (
                <>
                  <p data-testid="review-pv" lang="ja">
                    {pvNotation(activeMoves, line.pvUSI)
                      .map((m) => m.ply + '. ' + m.japanese)
                      .join(' → ')}
                  </p>
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
function validateArchiveForStudy(
  parent: GameArchive,
  draft: Draft,
): GameArchive {
  return {
    ...studyArchive({ parent, anchorPly: draft.anchorPly, moves: draft.moves }),
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };
}
