import {
  Color,
  Move,
  Position,
  Square,
  SpecialMoveType,
  formatMove,
  formatSpecialMove,
} from 'tsshogi';
import type { ImmutablePosition } from 'tsshogi';

export type DisplayMove = { ply: number; usi: string; japanese: string };
/** Presentation only. Validate against the pre-move position; USI remains canonical. */
export function japaneseMove(
  position: ImmutablePosition,
  usi: string,
  previous?: Move,
): string {
  const move = position.createMoveByUSI(usi);
  if (!move || !position.isValidMove(move))
    throw new Error(`Illegal move in notation: ${usi}`);
  const text = formatMove(position, move, {
    lastMove: previous,
    compatible: true,
  });
  // Explicit 打 is valid and useful even when a board move cannot be confused with it.
  return !(move.from instanceof Square) && !text.endsWith('打')
    ? text + '打'
    : text;
}
export function japaneseSequence(
  position: ImmutablePosition,
  moves: readonly string[],
  options: { previous?: Move; startPly?: number } = {},
): DisplayMove[] {
  const copy = position.clone();
  let previous = options.previous;
  return moves.map((usi, i) => {
    const japanese = japaneseMove(copy, usi, previous);
    const move = copy.createMoveByUSI(usi)!;
    if (!copy.doMove(move)) throw new Error('Illegal notation sequence');
    previous = move;
    return { ply: (options.startPly ?? 1) + i, usi, japanese };
  });
}
export function historyNotation(moves: readonly string[]) {
  return japaneseSequence(new Position(), moves);
}
export function positionContext(moves: readonly string[]) {
  const position = new Position();
  let previous: Move | undefined;
  for (const usi of moves) {
    const move = position.createMoveByUSI(usi);
    if (!move || !position.doMove(move)) throw new Error('Illegal history');
    previous = move;
  }
  return { position, previous, startPly: moves.length + 1 };
}
export function pvNotation(prefix: readonly string[], pv: readonly string[]) {
  const context = positionContext(prefix);
  return japaneseSequence(context.position, pv, context);
}
export function terminalNotation(type: SpecialMoveType, color?: Color) {
  return formatSpecialMove(type, color);
}
export function outcomeTerminal(reason: string): SpecialMoveType {
  switch (reason) {
    case 'Resignation':
      return SpecialMoveType.RESIGN;
    case 'Checkmate':
      return SpecialMoveType.MATE;
    case 'Fourfold repetition':
      return SpecialMoveType.REPETITION_DRAW;
    case 'Perpetual check':
      return SpecialMoveType.FOUL_LOSE;
    default:
      return SpecialMoveType.INTERRUPT;
  }
}
