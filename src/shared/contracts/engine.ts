export type SearchPosition = { kind: 'startpos'; moves: string[] } |
  { kind: 'sfen'; sfen: string; moves?: string[] };
export type CandidateMove = {
  multiPv: number;
  firstMoveUSI: string;
  pvUSI: string[];
  depth: number;
  score: { kind: 'cp' | 'mate'; value: number; perspective: 'side-to-move'; bound?: 'lowerbound' | 'upperbound' } | null;
};
export type SearchResult = {
  bestMoveUSI: string | null;
  terminal: 'resign' | 'win' | 'none' | null;
  candidates: CandidateMove[];
  elapsedMs: number;
};
export type EngineDiagnostics = {
  name: string;
  startupMs: number;
  wasmMemoryBytes: number;
  multiPvMax: number;
  options: string[];
};
export interface EngineAdapter {
  init(): Promise<void>;
  search(position: SearchPosition, options: { maxTimeMs: number; multiPv: number }): Promise<SearchResult>;
  stop(): Promise<void>;
  dispose(): void;
}
