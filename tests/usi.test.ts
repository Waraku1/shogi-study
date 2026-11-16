import { describe, expect, test } from 'vitest';
import { formatScore, isUSIMove, parseInfo, parseOption, positionCommand } from '../src/features/engine/usi';

describe('USI protocol boundaries', () => {
  test('actual Fairy-Stockfish info with MultiPV, depth, score and full PV', () => {
    expect(parseInfo('info depth 10 seldepth 13 multipv 2 score cp -23 nodes 34877 nps 131116 tbhits 0 time 266 pv 4a4b 6i6h 5c5d')).toEqual({
      multiPv: 2, firstMoveUSI: '4a4b', pvUSI: ['4a4b', '6i6h', '5c5d'], depth: 10,
      score: { kind: 'cp', value: -23, perspective: 'side-to-move' },
    });
  });
  test('mate sign, zero, score bounds and missing score remain explicit', () => {
    expect(formatScore(parseInfo('info depth 4 score mate 3 pv R*5b')!.score)).toBe('Mating in 3 plies');
    expect(formatScore(parseInfo('info depth 4 score mate -2 upperbound pv 5a4a')!.score)).toBe('≤ Being mated in 2 plies');
    expect(formatScore(parseInfo('info depth 0 score mate 0 pv 5a4a')!.score)).toBe('Checkmated (mate 0)');
    expect(parseInfo('info depth 1 pv 7g7f')!.score).toBeNull();
    expect(parseInfo('info depth 1 score cp 3 lowerbound pv 7g7f')!.score?.bound).toBe('lowerbound');
  });
  test.each([
    'info string pv 7g7f', 'info depth 4', 'info depth nope pv 7g7f', 'info depth 1 pv',
    'info depth 1 pv 7g7f garbage', 'info depth 1 multipv 0 pv 7g7f', 'bestmove 7g7f',
  ])('ignores malformed or irrelevant line: %s', line => expect(parseInfo(line)).toBeNull());
  test('does not invent an unknown score', () => {
    expect(parseInfo('info depth 4 score mate + pv 7g7f')?.score).toBeNull();
  });
  test('USI option names follow the actual handshake, including underscores', () => {
    expect(parseOption('option name USI_MultiPV type spin default 1 min 1 max 500')).toMatchObject({ name: 'USI_MultiPV', type: 'spin', max: 500 });
    expect(parseOption('option name Use_NNUE type check default true')?.name).toBe('Use_NNUE');
    expect(parseOption('info string not an option')).toBeNull();
  });
  test('moves, drops and promotions accepted; terminal and injected tokens not moves', () => {
    for (const token of ['7g7f', '8h2b+', 'B*4e']) expect(isUSIMove(token)).toBe(true);
    for (const token of ['resign', '(none)', '0000', '0a1a', '7g7f\nquit', 'K*4e']) expect(isUSIMove(token)).toBe(false);
  });
  test('search commands cannot inject lines', () => {
    expect(positionCommand({ kind: 'startpos', moves: ['7g7f'] })).toBe('position startpos moves 7g7f');
    expect(positionCommand({ kind: 'sfen', sfen: '4k4/9/9/9/9/9/9/9/4K4 b P 1' })).toContain('position sfen ');
    expect(() => positionCommand({ kind: 'startpos', moves: ['7g7f\nquit'] })).toThrow();
    expect(() => positionCommand({ kind: 'sfen', sfen: 'bad\nquit' })).toThrow();
  });
});
