import { expect, test } from 'vitest';
import {
  ratingEvidenceReadiness,
  uncalibratedLocalStrength,
} from '../src/shared/contracts/rating';
import type {
  MatchResult,
  OnlineMatchResult,
} from '../src/shared/contracts/rating';
const event = (i: number): OnlineMatchResult => ({
  source: 'authoritative-online',
  eventId: 'event-' + i,
  roomId: 'room-' + i,
  poolId: '10min',
  players: ['alice', 'opponent-' + (i % 5)],
  winner: 'alice',
  reason: 'resignation',
  finishedAt: 1000 + i,
  ratedConsent: [true, true],
});
test('evidence thresholds never become an uncalibrated official rating or kyu/dan claim', () => {
  const games = Array.from({ length: 20 }, (_, i) => event(i));
  expect(ratingEvidenceReadiness(games, 'alice', '10min')).toEqual({
    games: 20,
    uniqueOpponents: 5,
    provisional: false,
    status: 'requires-server-calibration',
    rating: null,
    kyuDan: null,
  });
  expect(
    ratingEvidenceReadiness(games.slice(0, 19), 'alice', '10min').provisional,
  ).toBe(true);
  expect(uncalibratedLocalStrength(['practice'])).toMatchObject({
    source: 'local-ai-performance',
    status: 'uncalibrated',
    estimate: null,
    kyuDanRange: null,
    confidence: { level: null, lower: null, upper: null },
  });
});
test('duplicates, wrong pools, self-play, missing consent and local AI never qualify as online evidence', () => {
  const local: MatchResult = {
    source: 'local-ai',
    id: 'practice',
    finishedAt: 1000,
    result: 'win',
    assisted: false,
    engine: {
      package: 'engine',
      version: '1',
      hash: 'abc',
      searchMs: 200,
      threads: 1,
      evaluation: 'classical',
    },
  };
  const games: MatchResult[] = [
    event(0),
    event(0),
    { ...event(1), roomId: 'room-0' },
    { ...event(2), ratedConsent: [false, true] },
    { ...event(3), players: ['alice', 'alice'] },
    { ...event(4), poolId: 'other' },
    local,
  ];
  expect(ratingEvidenceReadiness(games, 'alice', '10min').games).toBe(1);
  expect(ratingEvidenceReadiness([local], 'alice', '10min').games).toBe(0);
});
