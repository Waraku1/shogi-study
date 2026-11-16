import {
  Color, Move, PieceType, Position, Record as ShogiRecord, SpecialMoveType,
  Square, handPieceTypes, reverseColor,
} from 'tsshogi';
import type { ImmutablePosition } from 'tsshogi';

export const pieceNames: Record<PieceType, string> = {
  pawn: 'Pawn', lance: 'Lance', knight: 'Knight', silver: 'Silver', gold: 'Gold',
  bishop: 'Bishop', rook: 'Rook', king: 'King', promPawn: 'Promoted pawn',
  promLance: 'Promoted lance', promKnight: 'Promoted knight', promSilver: 'Promoted silver',
  horse: 'Horse (promoted bishop)', dragon: 'Dragon (promoted rook)',
};
export const pieceSymbols: Record<PieceType, string> = {
  pawn: 'P', lance: 'L', knight: 'N', silver: 'S', gold: 'G', bishop: 'B', rook: 'R',
  king: 'K', promPawn: '+P', promLance: '+L', promKnight: '+N', promSilver: '+S',
  horse: '+B', dragon: '+R',
};
export const sideName = (color: Color) => color === Color.BLACK ? 'Black' : 'White';
export type MoveSource = Square | PieceType;

/** Enumerate candidates only; every rules decision belongs to tsshogi. */
export function* legalMoves(position: ImmutablePosition, source?: MoveSource): Generator<Move> {
  const sources = source ? [source] : [
    ...position.board.listNonEmptySquares().filter(sq => position.board.at(sq)?.color === position.color),
    ...handPieceTypes.filter(type => position.hand(position.color).count(type) > 0),
  ];
  for (const from of sources) {
    for (const to of Square.all) {
      const move = position.createMove(from, to);
      if (!move) continue;
      if (position.isValidMove(move)) yield move;
      const promoted = move.withPromote();
      if (position.isValidMove(promoted)) yield promoted;
    }
  }
}

export function isLegalUSI(position: ImmutablePosition, usi: string): boolean {
  const move = position.createMoveByUSI(usi);
  return !!move && position.isValidMove(move);
}

export function validatePV(position: ImmutablePosition, pv: string[]): boolean {
  const copy = position.clone();
  return pv.length > 0 && pv.every(usi => {
    const move = copy.createMoveByUSI(usi);
    return !!move && copy.doMove(move);
  });
}

export type Outcome = { reason: string; winner: Color | null };

export class LocalGame {
  readonly record: ShogiRecord;

  constructor(position?: ImmutablePosition) {
    this.record = new ShogiRecord(position);
  }

  get position(): ImmutablePosition { return this.record.position; }
  get moves(): string[] {
    return this.record.movesBefore.flatMap(node => node.move instanceof Move ? [node.move.usi] : []);
  }
  get outcome(): Outcome | null {
    const move = this.record.current.move;
    if (!(move instanceof Move) && move.type === SpecialMoveType.RESIGN) {
      return { reason: 'Resignation', winner: reverseColor(this.position.color) };
    }
    if (this.record.repetition) {
      const checker = this.record.perpetualCheck;
      return checker
        ? { reason: 'Perpetual check', winner: reverseColor(checker) }
        : { reason: 'Fourfold repetition', winner: null };
    }
    if (legalMoves(this.position).next().done) {
      return { reason: this.position.checked ? 'Checkmate' : 'No legal moves', winner: reverseColor(this.position.color) };
    }
    return null;
  }

  play(usi: string): boolean {
    if (this.outcome) return false;
    const move = this.position.createMoveByUSI(usi);
    return !!move && this.position.isValidMove(move) && this.record.append(move);
  }

  resign(): void { if (!this.outcome) this.record.append(SpecialMoveType.RESIGN); }
  undo(): boolean {
    if (!this.record.goBack()) return false;
    this.record.removeNextMove();
    return true;
  }
}

export function positionFromSFEN(sfen: string): Position {
  const position = Position.newBySFEN(sfen);
  if (!position) throw new Error('Invalid SFEN');
  return position;
}
