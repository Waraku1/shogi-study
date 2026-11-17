import type { CandidateMove, SearchPosition } from '../../shared/contracts/engine';

export const isUSIMove = (value: string) => /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/.test(value);

export function parseInfo(line: string): CandidateMove | null {
  if (!line.startsWith('info ') || line.startsWith('info string ')) return null;
  const tokens = line.trim().split(/\s+/);
  const at = (name: string) => tokens.indexOf(name);
  const integer = (name: string, fallback?: number) => {
    const i = at(name);
    return i < 0 ? fallback : /^-?\d+$/.test(tokens[i + 1] ?? '') ? Number(tokens[i + 1]) : undefined;
  };
  const depth = integer('depth');
  const multiPv = integer('multipv', 1);
  const pvIndex = at('pv');
  if (depth === undefined || depth < 0 || multiPv === undefined || multiPv < 1 || pvIndex < 0) return null;
  const pvUSI = tokens.slice(pvIndex + 1);
  if (!pvUSI.length || !pvUSI.every(isUSIMove)) return null;
  let score: CandidateMove['score'] = null;
  const scoreIndex = at('score');
  if (scoreIndex >= 0) {
    const kind = tokens[scoreIndex + 1];
    const value = tokens[scoreIndex + 2];
    if ((kind === 'cp' || kind === 'mate') && /^-?\d+$/.test(value ?? '')) {
      const bound = tokens[scoreIndex + 3];
      score = { kind, value: Number(value), perspective: 'side-to-move',
        ...((bound === 'lowerbound' || bound === 'upperbound') ? { bound } : {}) };
    }
  }
  return { multiPv, firstMoveUSI: pvUSI[0], pvUSI, depth, score };
}

export type USIOption = { name: string; type: string; max: number | null; line: string };
export function parseOption(line: string): USIOption | null {
  const match = /^option name (.+?) type (\w+)(?: |$)/.exec(line);
  if (!match) return null;
  const max = /\bmax (\d+)/.exec(line);
  return { name: match[1], type: match[2], max: max ? Number(max[1]) : null, line };
}

export function positionCommand(position: SearchPosition): string {
  const moves = position.moves ?? [];
  if (!moves.every(isUSIMove)) throw new Error('Invalid USI move in search position');
  if (position.kind === 'sfen' && (!position.sfen.trim() || /[\r\n]/.test(position.sfen))) {
    throw new Error('Invalid SFEN search position');
  }
  return `position ${position.kind === 'startpos' ? 'startpos' : `sfen ${position.sfen}`}` +
    (moves.length ? ` moves ${moves.join(' ')}` : '');
}

export function formatScore(score: CandidateMove['score']): string {
  if (!score) return 'Score unavailable';
  const bound = score.bound ? `${score.bound === 'lowerbound' ? '≥' : '≤'} ` : '';
  if (score.kind === 'cp') return `${bound}${score.value > 0 ? '+' : ''}${score.value} cp`;
  if (score.value === 0) return 'Checkmated (mate 0)';
  return `${bound}${score.value > 0 ? 'Mating' : 'Being mated'} in ${Math.abs(score.value)} plies`;
}
