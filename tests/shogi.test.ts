import { describe, expect, test } from 'vitest';
import { Color, PieceType, Position, Record as ShogiRecord, Square } from 'tsshogi';
import { LocalGame, isLegalUSI, legalMoves, positionFromSFEN, validatePV } from '../src/features/shogi/game';

const kings = '4k4/9/9/9/9/9/9/9/4K4';

describe('tsshogi rules integration', () => {
  test('standard board: 81 squares, 40 pieces, Black turn, 30 legal opening moves', () => {
    const game = new LocalGame();
    expect(Square.all).toHaveLength(81);
    expect(game.position.board.listNonEmptySquares()).toHaveLength(40);
    expect(game.position.color).toBe(Color.BLACK);
    expect([...legalMoves(game.position)]).toHaveLength(30);
  });

  test('legal opening is recorded; illegal movement and wrong side are rejected without mutation', () => {
    const game = new LocalGame();
    const before = game.record.sfen;
    expect(game.play('7g7e')).toBe(false);
    expect(game.play('3c3d')).toBe(false);
    expect(game.record.sfen).toBe(before);
    expect(game.play('7g7f')).toBe(true);
    expect(game.moves).toEqual(['7g7f']);
    expect(game.position.color).toBe(Color.WHITE);
  });

  test('capture adds an unpromoted enemy piece to the hand', () => {
    const game = new LocalGame(positionFromSFEN('4k4/9/9/4+p4/4R4/9/9/9/4K4 b - 1'));
    expect(game.play('5e5d')).toBe(true);
    expect(game.position.blackHand.count(PieceType.PAWN)).toBe(1);
  });

  test('legal drop consumes hand; unavailable and occupied drops rejected', () => {
    const game = new LocalGame(positionFromSFEN(`${kings} b P 1`));
    expect(game.play('R*4e')).toBe(false);
    expect(game.play('P*5i')).toBe(false);
    expect(game.play('P*4e')).toBe(true);
    expect(game.position.blackHand.count(PieceType.PAWN)).toBe(0);
    expect(game.position.board.at(new Square(4, 5))?.type).toBe(PieceType.PAWN);
  });

  test('nifu forbids pawn drop on a file containing an unpromoted own pawn', () => {
    const p = positionFromSFEN('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
    expect(isLegalUSI(p, 'P*5e')).toBe(false);
    expect(isLegalUSI(p, 'P*4e')).toBe(true);
  });

  test('promoted pawn does not cause nifu', () => {
    const p = positionFromSFEN('4k4/9/9/9/9/9/4+P4/9/4K4 b P 1');
    expect(isLegalUSI(p, 'P*5e')).toBe(true);
  });

  test.each(['P*4a', 'L*4a', 'N*4a', 'N*4b'])('dead-rank drop %s rejected', usi => {
    const p = positionFromSFEN(`${kings} b PLN 1`);
    expect(isLegalUSI(p, usi)).toBe(false);
  });

  test('pawn drop mate rejected while a checking pawn drop with escape is legal', () => {
    const p = positionFromSFEN('3lkl3/9/4G4/9/9/9/9/9/4K4 b P 1');
    expect(isLegalUSI(p, 'P*5b')).toBe(false);
    expect(isLegalUSI(positionFromSFEN(`${kings} b P 1`), 'P*5b')).toBe(true);
  });

  test('promotion can be chosen; promotion outside zone rejected', () => {
    const game = new LocalGame(positionFromSFEN('4k4/9/4P4/9/9/9/9/9/4K4 b - 1'));
    expect(isLegalUSI(game.position, '5c5b')).toBe(true);
    expect(game.play('5c5b+')).toBe(true);
    expect(game.position.board.at(new Square(5, 2))?.type).toBe(PieceType.PROM_PAWN);
    expect(isLegalUSI(new Position(), '7g7f+')).toBe(false);
  });

  test('mandatory last-rank promotion has only promoted alternative', () => {
    const p = positionFromSFEN('k8/4P4/9/9/9/9/9/9/4K4 b - 1');
    expect(isLegalUSI(p, '5b5a')).toBe(false);
    expect([...legalMoves(p, new Square(5, 2))].map(m => m.usi)).toEqual(['5b5a+']);
  });

  test('pinned piece cannot expose its king', () => {
    const p = positionFromSFEN('k3r4/9/9/9/9/9/9/4G4/4K4 b - 1');
    expect(isLegalUSI(p, '5h4h')).toBe(false);
    expect(isLegalUSI(p, '5h5g')).toBe(true);
  });

  test('check requires escape; cannot move into attack', () => {
    const p = positionFromSFEN('k3r4/9/9/9/9/9/P8/9/4K4 b - 1');
    expect(p.checked).toBe(true);
    expect(isLegalUSI(p, '9g9f')).toBe(false);
    expect(isLegalUSI(p, '5i5h')).toBe(false);
    expect(isLegalUSI(p, '5i4i')).toBe(true);
  });

  test('checkmate and resignation terminate play; undo restores it', () => {
    const mate = new LocalGame(positionFromSFEN('3lkl3/4R4/4G4/9/9/9/9/9/4K4 w - 1'));
    expect(mate.outcome).toEqual({ reason: 'Checkmate', winner: Color.BLACK });
    expect(mate.play('5a5b')).toBe(false);
    const game = new LocalGame();
    game.resign();
    expect(game.outcome).toEqual({ reason: 'Resignation', winner: Color.WHITE });
    expect(game.play('7g7f')).toBe(false);
    expect(game.undo()).toBe(true);
    expect(game.outcome).toBeNull();
  });

  test('fourfold repetition ends in a draw', () => {
    const game = new LocalGame(positionFromSFEN(`${kings} b - 1`));
    for (let i = 0; i < 3; i++) {
      for (const move of ['5i4i', '5a4a', '4i5i', '4a5a']) expect(game.play(move)).toBe(true);
    }
    expect(game.outcome).toEqual({ reason: 'Fourfold repetition', winner: null });
  });

  test('perpetual checker loses on the fourth occurrence', () => {
    const game = new LocalGame(positionFromSFEN('4k4/5R3/9/9/9/9/9/9/4K4 b - 1'));
    for (let i = 0; i < 3; i++) {
      for (const move of ['4b5b', '5a4a', '5b4b', '4a5a']) expect(game.play(move)).toBe(true);
    }
    expect(game.outcome).toEqual({ reason: 'Perpetual check', winner: Color.WHITE });
  });

  test('a side with no legal moves loses even without check', () => {
    const game = new LocalGame(positionFromSFEN('8k/9/6NG1/9/9/9/9/9/K8 w - 1'));
    expect(game.position.checked).toBe(false);
    expect(game.outcome).toEqual({ reason: 'No legal moves', winner: Color.BLACK });
  });

  test('SFEN / USI replay round-trip includes captures, hands and promotion', () => {
    const game = new LocalGame();
    const moves = ['7g7f', '3c3d', '8h2b+', '3a2b', 'B*4e', 'B*8h'];
    for (const usi of moves) expect(game.play(usi)).toBe(true);
    const restored = ShogiRecord.newByUSI(game.record.usi);
    expect(restored).not.toBeInstanceOf(Error);
    if (restored instanceof Error) throw restored;
    expect(restored.sfen).toBe(game.record.sfen);
    expect(positionFromSFEN(game.record.sfen).sfen).toBe(game.position.sfen);
    const final = game.record.sfen;
    restored.goto(0);
    while (restored.goForward()) { /* replay */ }
    expect(restored.sfen).toBe(final);
    expect(game.undo()).toBe(true);
    expect(game.moves).toHaveLength(moves.length - 1);
  });

  test('PV validation checks every ply and leaves original position unchanged', () => {
    const p = new Position();
    const sfen = p.sfen;
    expect(validatePV(p, ['7g7f', '3c3d'])).toBe(true);
    expect(validatePV(p, ['7g7f', '7f7e'])).toBe(false);
    expect(p.sfen).toBe(sfen);
  });
});
