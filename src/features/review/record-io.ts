import {
  Move,
  Position,
  SpecialMoveType,
  exportKIF,
  exportCSA,
  importKIF,
  importCSA,
  formatSpecialMove,
  isKnownSpecialMove,
} from 'tsshogi';
import { LocalGame } from '../shogi/game';
import {
  MAX_BYTES,
  MAX_PLIES,
  parseArchive,
  replay,
  validateArchive,
} from './archive';
import type { GameArchive } from './archive';

const terminalTypes = Object.values(SpecialMoveType).filter(
  (t) => t !== SpecialMoveType.START,
);
/** Old v1 archives store descriptions, not an authoritative structured result. */
export function archiveTerminal(
  record: GameArchive,
): SpecialMoveType | undefined {
  return descriptionTerminal(record.result.text);
}
export function descriptionTerminal(text: string): SpecialMoveType | undefined {
  for (const type of terminalTypes)
    if (text === formatSpecialMove(type)) return type;
  if (
    /^(?:black|white|Draw): Resignation$|^(?:White|Black) wins by resignation$/.test(
      text,
    )
  )
    return SpecialMoveType.RESIGN;
  if (/^(?:White|Black) wins on time$/.test(text))
    return SpecialMoveType.TIMEOUT;
  if (/^(?:black|white)(?::| wins:) Checkmate$/.test(text))
    return SpecialMoveType.MATE;
  if (/^(?:black|white)(?::| wins:) Perpetual check$/.test(text))
    return SpecialMoveType.FOUL_LOSE;
  if (text === 'Draw: Fourfold repetition' || text === 'Fourfold repetition')
    return SpecialMoveType.REPETITION_DRAW;
  return undefined;
}
export function exportCompatible(record: GameArchive, format: 'kif' | 'csa') {
  const checked = validateArchive(record),
    game = replay(checked);
  const terminal = archiveTerminal(checked) ?? SpecialMoveType.INTERRUPT;
  if (!game.record.append(terminal))
    throw new Error('Cannot export terminal event');
  return format === 'kif' ? exportKIF(game.record) : exportCSA(game.record);
}
export function importCompatible(
  text: string,
  format: 'kif' | 'csa',
): GameArchive {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw new Error('Game file exceeds 64 KiB');
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\ufffd'))
    throw new Error('Use UTF-8 text; this file has invalid encoding');
  if (format === 'kif' && !/^手数[-ー\s]*指手/m.test(text))
    throw new Error('Unsupported KIF: a standard move table is required');
  if (format === 'csa' && (!/^PI\s*$/m.test(text) || !/^[+-]\s*$/m.test(text)))
    throw new Error(
      'Unsupported CSA: standard PI start and side-to-move required',
    );
  const record = format === 'kif' ? importKIF(text) : importCSA(text);
  if (record instanceof Error)
    throw new Error(`Invalid ${format.toUpperCase()}: ${record.message}`);
  if (record.initialPosition.sfen !== new Position().sfen)
    throw new Error('Only standard-start records are supported');
  const game = new LocalGame();
  let terminal: SpecialMoveType | undefined,
    nodes = 0;
  for (let node = record.first.next; node; node = node.next) {
    if (++nodes > MAX_PLIES + 1) throw new Error('Record exceeds 512 plies');
    if (node.hasBranch || node.branch)
      throw new Error(
        'Import one main line at a time; KIF branches are unsupported',
      );
    if (node.move instanceof Move) {
      if (
        terminal ||
        game.moves.length >= MAX_PLIES ||
        !game.play(node.move.usi)
      )
        throw new Error('Illegal move in imported record');
    } else {
      if (
        terminal ||
        !isKnownSpecialMove(node.move) ||
        node.move.type === SpecialMoveType.START
      )
        throw new Error('Unsupported terminal event');
      terminal = node.move.type;
    }
  }
  // Imported metadata/comments are not copied into local archives (emails, private notes, etc.).
  return validateArchive({
    source: 'shogi-study',
    version: 1,
    id: crypto.randomUUID(),
    mode: 'local',
    moves: game.moves,
    result: {
      status:
        terminal && terminal !== SpecialMoveType.INTERRUPT
          ? 'finished'
          : 'unfinished',
      text: terminal ? formatSpecialMove(terminal) : 'Imported unfinished game',
    },
    savedAt: Date.now(),
  });
}
export function parseGameText(text: string, format: 'json' | 'kif' | 'csa') {
  return format === 'json'
    ? parseArchive(text)
    : importCompatible(text, format);
}
export function downloadGame(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], {
      type: name.endsWith('.json')
        ? 'application/json'
        : 'text/plain;charset=utf-8',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
