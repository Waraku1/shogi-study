import { expect, test } from 'vitest';
import { Position, SpecialMoveType, formatSpecialMove } from 'tsshogi';
import {
  japaneseMove,
  japaneseSequence,
  historyNotation,
  pvNotation,
  terminalNotation,
} from '../src/features/shogi/notation';
import {
  exportArchive,
  parseArchive,
  replay,
} from '../src/features/review/archive';
import type { GameArchive } from '../src/features/review/archive';
import {
  exportCompatible,
  importCompatible,
} from '../src/features/review/record-io';

const moves = ['7g7f', '3c3d', '8h2b+', '3a2b', 'B*4e', 'B*8h'];
const game: GameArchive = {
  source: 'shogi-study',
  version: 1,
  id: 'japanese-game-001',
  mode: 'local',
  moves,
  result: { status: 'finished', text: 'White wins by resignation' },
  savedAt: 1234,
};
test('position-aware notation: sides, full-width files, ranks, captures, 同, promotion, drops and PV boundary', () => {
  expect(historyNotation(moves).map((m) => m.japanese)).toEqual([
    '▲７六歩',
    '△３四歩',
    '▲２二角成',
    '△同　銀',
    '▲４五角打',
    '△８八角打',
  ]);
  expect(historyNotation(moves).map((m) => m.ply)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(pvNotation(moves.slice(0, 3), ['3a2b'])[0]).toEqual({
    ply: 4,
    usi: '3a2b',
    japanese: '△同　銀',
  });
  expect(pvNotation(moves.slice(0, 2), ['8h2b'])[0].japanese).toBe(
    '▲２二角不成',
  );
});
test.each([
  ['k8/9/9/9/9/9/3G1G3/9/4K4 b - 1', '4g5f', '▲５六金右'],
  ['k8/9/9/9/9/9/3G1G3/9/4K4 b - 1', '6g5f', '▲５六金左'],
  ['k8/9/3g1g3/9/9/9/9/9/4K4 w - 1', '6c5d', '△５四金右'],
  ['k8/9/3g1g3/9/9/9/9/9/4K4 w - 1', '4c5d', '△５四金左'],
  ['k8/9/9/9/9/9/3GGG3/9/4K4 b - 1', '5g5f', '▲５六金直'],
  ['k8/9/9/9/4G4/9/4G4/9/4K4 b - 1', '5e5f', '▲５六金引'],
  ['k8/9/9/9/4G4/9/4G4/9/4K4 b - 1', '5g5f', '▲５六金上'],
  ['k8/9/9/9/9/5G3/4G4/9/4K4 b - 1', '4f5f', '▲５六金寄'],
  ['k8/9/9/9/3+B1+B3/9/9/9/4K4 b - 1', '4e5e', '▲５五馬右'],
])('side-relative disambiguation: %s %s', (sfen, usi, expected) => {
  const p = Position.newBySFEN(sfen)!;
  const before = p.sfen;
  expect(japaneseMove(p, usi)).toBe(expected);
  expect(p.sfen).toBe(before);
});
test.each([
  ['+P', 'と'],
  ['+L', '成香'],
  ['+N', '成桂'],
  ['+S', '成銀'],
  ['+B', '馬'],
  ['+R', '龍'],
])('already-promoted piece keeps its name: %s', (piece, name) => {
  expect(
    japaneseMove(
      Position.newBySFEN('k8/9/9/9/4' + piece + '4/9/9/9/4K4 b - 1')!,
      '5e5d',
    ),
  ).toBe('▲５四' + name);
});
test('combined movement qualifiers and a drop competing with a board move remain unambiguous', () => {
  const black = Position.newBySFEN('k8/9/9/9/3S1S3/9/3S1S3/9/4K4 b - 1')!;
  expect(japaneseMove(black, '4g5f')).toBe('▲５六銀右上');
  expect(japaneseMove(black, '6g5f')).toBe('▲５六銀左上');
  expect(japaneseMove(black, '4e5f')).toBe('▲５六銀右引');
  const white = Position.newBySFEN('k8/9/3s1s3/9/3s1s3/9/9/9/4K4 w - 1')!;
  expect(japaneseMove(white, '6c5d')).toBe('△５四銀右上');
  const drop = Position.newBySFEN('k8/9/9/9/9/9/4G4/9/4K4 b G 1')!;
  expect(japaneseMove(drop, 'G*5f')).toBe('▲５六金打');
  expect(japaneseMove(drop, '5g5f')).toBe('▲５六金');
});
test('forced promotion, illegal moves, side-to-move numbering and terminal events', () => {
  const p = Position.newBySFEN('k8/4P4/9/9/9/9/9/9/4K4 b - 1')!;
  expect(japaneseMove(p, '5b5a+')).toBe('▲５一歩成');
  expect(() => japaneseMove(p, '5b5a')).toThrow('Illegal');
  expect(() => historyNotation(['7g7e'])).toThrow('Illegal');
  const white = Position.newBySFEN('k8/9/3g1g3/9/9/9/9/9/4K4 w - 1')!;
  expect(japaneseSequence(white, ['6c5d'], { startPly: 42 })[0]).toEqual({
    ply: 42,
    usi: '6c5d',
    japanese: '△５四金右',
  });
  for (const t of [
    SpecialMoveType.RESIGN,
    SpecialMoveType.TIMEOUT,
    SpecialMoveType.MATE,
    SpecialMoveType.REPETITION_DRAW,
    SpecialMoveType.DRAW,
  ])
    expect(terminalNotation(t)).toBe(formatSpecialMove(t));
});
test.each(['kif', 'csa'] as const)(
  '%s export/import preserves all legal moves, terminal event and exact final position',
  (format) => {
    const before = exportArchive(game),
      text = exportCompatible(game, format),
      imported = importCompatible(text, format);
    expect(imported.moves).toEqual(game.moves);
    expect(replay(imported).record.sfen).toBe(replay(game).record.sfen);
    expect(imported.result).toEqual({ status: 'finished', text: '投了' });
    expect(exportArchive(game)).toBe(before);
    expect(parseArchive(exportArchive(game))).toEqual(game);
  },
);
test('compatible imports reject illegal, excessive, custom-start or branched data and discard private metadata', () => {
  const kif = exportCompatible(game, 'kif');
  expect(() =>
    importCompatible(kif.replace('７六歩(77)', '７五歩(77)'), 'kif'),
  ).toThrow();
  expect(() => importCompatible('x'.repeat(65537), 'kif')).toThrow('64 KiB');
  expect(() => importCompatible('not a game', 'kif')).toThrow('Unsupported');
  expect(() =>
    importCompatible(kif.replace('手合割：平手', '手合割：飛車落ち'), 'kif'),
  ).toThrow('standard-start');
  expect(() =>
    importCompatible(kif + '\n変化：1手\n1 ２六歩(27)\n', 'kif'),
  ).toThrow();
  const imported = importCompatible('先手：secret@example.test\n' + kif, 'kif');
  expect(JSON.stringify(imported)).not.toContain('secret');
  expect(imported.publicNames).toBeUndefined();
});
test('every historical ply is reconstructed without altering the full original', () => {
  const before = exportArchive(game),
    p = new Position();
  expect(replay(game, 0).record.sfen).toBe(p.getSFEN(1));
  for (let i = 0; i < moves.length; i++) {
    expect(p.doMove(p.createMoveByUSI(moves[i])!)).toBe(true);
    expect(replay(game, i + 1).record.sfen).toBe(p.getSFEN(i + 2));
  }
  expect(exportArchive(game)).toBe(before);
});
