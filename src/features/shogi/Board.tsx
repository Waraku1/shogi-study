import { Color, PieceType, Square, handPieceTypes, unpromotedPieceType, fileToMultiByteChar, rankToKanji } from 'tsshogi';
import type { ImmutablePosition } from 'tsshogi';
import { legalMoves, pieceNames, pieceSymbols, sideName } from './game';
import type { MoveSource } from './game';
import { useState } from 'react';

type Props = {
  position: ImmutablePosition;
  selected: MoveSource | null;
  disabled: boolean;
  onSelect: (square: Square) => void;
  onHand: (source: MoveSource) => void;
};

export function Board({ position, selected, disabled, onSelect, onHand }: Props) {
  const [focusSquare,setFocusSquare]=useState('7g');
  const targets = new Set(selected ? [...legalMoves(position, selected)].map(move => move.to.usi) : []);
  const hand = (color: Color) => (
    <section className="hand" aria-label={`${sideName(color)} captured pieces`}>
      <strong>{color === Color.BLACK ? '▲' : '△'} {sideName(color)} hand</strong>
      <div className="hand-pieces">
        {handPieceTypes.filter(type => position.hand(color).count(type)).map(type => (
          <button key={type} disabled={disabled || position.color !== color}
            aria-pressed={selected === type} title={`Drop ${pieceNames[type]}`}
            aria-label={`Drop ${sideName(color)} ${pieceNames[type]}, ${position.hand(color).count(type)} in hand`}
            onClick={() => onHand(type)}>
            <span className={`piece hand-piece ${color}`} aria-hidden="true"><span lang="ja">{pieceSymbols[type]}</span></span> <small>×{position.hand(color).count(type)}</small>
          </button>
        ))}
        {!handPieceTypes.some(type => position.hand(color).count(type)) && <span className="muted">No captured pieces</span>}
      </div>
    </section>
  );
  return <>
    {hand(Color.WHITE)}
    <div className="files" aria-hidden="true">{[9, 8, 7, 6, 5, 4, 3, 2, 1].map(file => <span key={file}>{fileToMultiByteChar(file)}</span>)}</div>
    <div className="board-with-ranks">
    <div className="board" role="grid" aria-label="Shogi board, 9 by 9" aria-rowcount={9} aria-colcount={9}>
      {Array.from({ length: 9 }, (_, y) => <div className="board-row" role="row" key={y}>
        {Array.from({ length: 9 }, (_, x) => {
          const square = Square.newByXY(x, y);
          const piece = position.board.at(square);
          const isSelected = selected instanceof Square && selected.equals(square);
          const label = `${square.usi}${piece ? ` ${sideName(piece.color)} ${pieceNames[piece.type]}` : ' empty'}`;
          return <button role="gridcell" data-square={square.usi} aria-label={label} title={label}
            aria-selected={isSelected} aria-disabled={disabled} tabIndex={square.usi === focusSquare ? 0 : -1}
            onFocus={()=>setFocusSquare(square.usi)}
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
            {piece && <span className={`piece ${piece.color}${unpromotedPieceType(piece.type) !== piece.type ? ' promoted' : ''}`} aria-hidden="true">
              <span lang="ja">{piece.type === PieceType.KING && piece.color === Color.WHITE ? '王' : pieceSymbols[piece.type]}</span>
            </span>}
            {!piece && targets.has(square.usi) && <span className="target-dot" aria-hidden="true" />}
          </button>;
        })}
      </div>)}
    </div>
    <div className="ranks" aria-hidden="true">{[1,2,3,4,5,6,7,8,9].map(rank => <span key={rank}>{rankToKanji(rank)}</span>)}</div>
    </div>
    {hand(Color.BLACK)}
    <p className="board-help">▲ Black faces up; △ White faces down. Select a piece, then a highlighted square, or a captured piece to drop. Arrow keys move focus; Enter selects.</p>
  </>;
}

export function focusBoardSquare(usi: string) {
  for (const node of document.querySelectorAll<HTMLElement>(`[data-square="${usi}"]`)) {
    if (!node.closest('[hidden]')) { node.focus(); return; }
  }
}
