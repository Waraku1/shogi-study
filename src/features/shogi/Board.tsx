import { Color, Square, handPieceTypes } from 'tsshogi';
import type { ImmutablePosition } from 'tsshogi';
import { legalMoves, pieceNames, pieceSymbols, sideName } from './game';
import type { MoveSource } from './game';

type Props = {
  position: ImmutablePosition;
  selected: MoveSource | null;
  disabled: boolean;
  onSelect: (square: Square) => void;
  onHand: (source: MoveSource) => void;
};

export function Board({ position, selected, disabled, onSelect, onHand }: Props) {
  const targets = new Set(selected ? [...legalMoves(position, selected)].map(move => move.to.usi) : []);
  const hand = (color: Color) => (
    <section className="hand" aria-label={`${sideName(color)} captured pieces`}>
      <strong><span className={`side-dot ${color}`} />{sideName(color)} hand</strong>
      <div className="hand-pieces">
        {handPieceTypes.filter(type => position.hand(color).count(type)).map(type => (
          <button key={type} disabled={disabled || position.color !== color}
            aria-pressed={selected === type} title={`Drop ${pieceNames[type]}`}
            onClick={() => onHand(type)}>
            {pieceSymbols[type]} <small>×{position.hand(color).count(type)}</small>
          </button>
        ))}
        {!handPieceTypes.some(type => position.hand(color).count(type)) && <span className="muted">No captured pieces</span>}
      </div>
    </section>
  );
  return <>
    {hand(Color.WHITE)}
    <div className="files" aria-hidden="true">{[9, 8, 7, 6, 5, 4, 3, 2, 1].map(file => <span key={file}>{file}</span>)}</div>
    <div className="board" role="grid" aria-label="Shogi board, 9 by 9" aria-rowcount={9} aria-colcount={9}>
      {Array.from({ length: 9 }, (_, y) => <div className="board-row" role="row" key={y}>
        {Array.from({ length: 9 }, (_, x) => {
          const square = Square.newByXY(x, y);
          const piece = position.board.at(square);
          const isSelected = selected instanceof Square && selected.equals(square);
          const label = `${square.usi}${piece ? ` ${sideName(piece.color)} ${pieceNames[piece.type]}` : ' empty'}`;
          return <button role="gridcell" data-square={square.usi} aria-label={label} title={label}
            aria-selected={isSelected} aria-disabled={disabled} tabIndex={x === 2 && y === 6 ? 0 : -1}
            key={square.usi} className={`square${isSelected ? ' selected' : ''}${targets.has(square.usi) ? ' legal-target' : ''}`}
            onClick={() => { if (!disabled) onSelect(square); }}
            onKeyDown={event => {
              const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 };
              if (event.key === 'Escape') { event.currentTarget.blur(); return; }
              const delta = deltas[event.key];
              if (delta === undefined) return;
              event.preventDefault();
              const next = Square.newByIndex(Math.max(0, Math.min(80, square.index + delta)));
              event.currentTarget.closest('[role="grid"]')?.querySelector<HTMLElement>(`[data-square="${next.usi}"]`)?.focus();
            }}>
            <small className="coordinate" aria-hidden="true">{square.usi}</small>
            {piece && <span className={`piece ${piece.color}${pieceSymbols[piece.type].startsWith('+') ? ' promoted' : ''}`} aria-hidden="true">
              <span>{pieceSymbols[piece.type]}</span>
            </span>}
            {!piece && targets.has(square.usi) && <span className="target-dot" aria-hidden="true" />}
          </button>;
        })}
      </div>)}
    </div>
    {hand(Color.BLACK)}
    <p className="board-help">Select a piece, then a highlighted square. Select a captured piece to drop it. Arrow keys move focus; Enter selects.</p>
  </>;
}

export function focusBoardSquare(usi: string) {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-square="${usi}"]`)) {
    if (!node.closest('[hidden]')) { node.focus(); return; }
  }
}
