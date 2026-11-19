/** Foundation only: no ranked queue, rating mutation, rank badge or calibrated estimate. */
export type FinishReason =
  'checkmate' | 'resignation' | 'timeout' | 'repetition' | 'draw';
export type OnlineMatchResult = {
  source: 'authoritative-online';
  eventId: string;
  roomId: string;
  poolId: string;
  players: readonly [string, string];
  winner: string | null;
  reason: FinishReason;
  finishedAt: number;
  ratedConsent: readonly [boolean, boolean];
};
export type LocalAIResult = {
  source: 'local-ai';
  id: string;
  finishedAt: number;
  result: 'win' | 'loss' | 'draw';
  engine: {
    package: string;
    version: string;
    hash: string;
    searchMs: number;
    threads: number;
    evaluation: 'classical' | 'nnue';
  };
  assisted: boolean;
};
export type MatchResult = OnlineMatchResult | LocalAIResult;
export type Calibration = {
  id: string;
  modelVersion: string;
  poolId: string;
  cohort: string;
  sampleSize: number;
  evaluatedAt: number;
  errorMetric: string;
  errorValue: number;
  rankMappingVersion: string | null;
  approvedForDisplay: boolean;
};
export type OnlineRating = {
  source: 'online-rated';
  playerId: string;
  poolId: string;
  modelVersion: string;
  mean: number | null;
  deviation: number | null;
  games: number;
  uniqueOpponents: number;
  provisional: boolean;
  calibrationId: string | null;
  lastEventId: string | null;
};
export type EstimatedStrength = {
  source: 'local-ai-performance';
  calibrationId: string | null;
  evidenceIds: readonly string[];
  status: 'uncalibrated' | 'calibrated';
  estimate: number | null;
  confidence: {
    level: number | null;
    lower: number | null;
    upper: number | null;
  };
  kyuDanRange: {
    weakest: string;
    strongest: string;
    mappingVersion: string;
  } | null;
};
// Proposed product defaults, not a claim that these counts alone establish calibration.
export const provisionalPolicy = {
  minimumGames: 20,
  minimumUniqueOpponents: 5,
} as const;
export function uncalibratedLocalStrength(
  ids: readonly string[] = [],
): EstimatedStrength {
  return {
    source: 'local-ai-performance',
    calibrationId: null,
    evidenceIds: [...ids],
    status: 'uncalibrated',
    estimate: null,
    confidence: { level: null, lower: null, upper: null },
    kyuDanRange: null,
  };
}
/** For planning/display of evidence counts, never authentication or a client-side rating grant.
 * The future server must verify consent, ownership and exactly-once event provenance first. */
export function ratingEvidenceReadiness(
  history: readonly MatchResult[],
  playerId: string,
  poolId: string,
) {
  const events = new Set<string>(),
    rooms = new Set<string>(),
    opponents = new Set<string>();
  for (const match of history) {
    if (
      match.source !== 'authoritative-online' ||
      match.poolId !== poolId ||
      !match.players.includes(playerId) ||
      match.players[0] === match.players[1] ||
      !match.ratedConsent.every(Boolean) ||
      !match.eventId ||
      !match.roomId ||
      events.has(match.eventId) ||
      rooms.has(match.roomId) ||
      !Number.isSafeInteger(match.finishedAt) ||
      match.finishedAt < 0 ||
      (match.winner !== null && !match.players.includes(match.winner))
    )
      continue;
    events.add(match.eventId);
    rooms.add(match.roomId);
    opponents.add(
      match.players[0] === playerId ? match.players[1] : match.players[0],
    );
  }
  const provisional =
    events.size < provisionalPolicy.minimumGames ||
    opponents.size < provisionalPolicy.minimumUniqueOpponents;
  return {
    games: events.size,
    uniqueOpponents: opponents.size,
    provisional,
    status: provisional
      ? ('provisional-evidence' as const)
      : ('requires-server-calibration' as const),
    rating: null,
    kyuDan: null,
  };
}
