import { LocalGame, validatePV } from "../shogi/game";
import { isUSIMove } from "../engine/usi";
export const MAX_GAMES = 50,
  MAX_PLIES = 512,
  MAX_BYTES = 65536;
export type GameArchive = {
  source: "shogi-study";
  version: 1;
  id: string;
  mode: "local" | "ai" | "online";
  moves: string[];
  result: { status: "unfinished" | "finished"; text: string };
  savedAt: number;
  publicNames?: string[];
};
const keys = [
  "source",
  "version",
  "id",
  "mode",
  "moves",
  "result",
  "savedAt",
  "publicNames",
];
const fail = (message: string): never => {
  throw new Error(message);
};
export function replay(record: GameArchive, ply = record.moves.length) {
  if (!Number.isInteger(ply) || ply < 0 || ply > record.moves.length)
    fail("Invalid replay ply");
  const game = new LocalGame();
  for (const usi of record.moves.slice(0, ply))
    if (!game.play(usi)) fail("Illegal move in record");
  return game;
}
export function validateArchive(input: unknown): GameArchive {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Game JSON must be an object");
  const x = input as GameArchive;
  if (Object.keys(x).some((k) => !keys.includes(k)))
    fail(
      "Unsupported fields: only standard-start version 1 game JSON is supported",
    );
  if (x.source !== "shogi-study" || x.version !== 1)
    fail("Unsupported game format/version");
  if (typeof x.id !== "string" || !/^[-a-zA-Z0-9]{8,80}$/.test(x.id))
    fail("Invalid record ID");
  if (!["local", "ai", "online"].includes(x.mode)) fail("Invalid game mode");
  if (
    !Number.isSafeInteger(x.savedAt) ||
    x.savedAt < 0 ||
    x.savedAt > 8640000000000000
  )
    fail("Invalid saved time");
  if (
    !Array.isArray(x.moves) ||
    x.moves.length > MAX_PLIES ||
    x.moves.some((m) => typeof m !== "string" || !isUSIMove(m))
  )
    fail(`Invalid moves or more than ${MAX_PLIES} plies`);
  const text = (s: unknown, n: number) =>
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= n &&
    !/[\x00-\x1f\x7f@]/.test(s);
  if (
    !x.result ||
    Object.keys(x.result).some((k) => !["status", "text"].includes(k)) ||
    !["unfinished", "finished"].includes(x.result.status) ||
    !text(x.result.text, 120)
  )
    fail("Invalid result");
  if (x.mode === "online" && x.result.status !== "finished")
    fail("Only finished online games can be archived");
  if (
    x.publicNames !== undefined &&
    (!Array.isArray(x.publicNames) ||
      x.publicNames.length > 2 ||
      x.publicNames.some((n) => !text(n, 48)))
  )
    fail("Invalid public display names");
  const clean: GameArchive = {
    source: "shogi-study",
    version: 1,
    id: x.id,
    mode: x.mode,
    moves: [...x.moves],
    result: { ...x.result },
    savedAt: x.savedAt,
    ...(x.publicNames ? { publicNames: [...x.publicNames] } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(clean)).length > MAX_BYTES)
    fail("Game JSON is too large");
  replay(clean);
  return clean;
}
export function parseArchive(text: string): GameArchive {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    fail(`Game JSON exceeds ${MAX_BYTES} bytes`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("Malformed JSON");
  }
  return validateArchive(data);
}
export const exportArchive = (game: GameArchive) =>
  JSON.stringify(validateArchive(game), null, 2);
export function variationPosition(
  record: GameArchive,
  ply: number,
  pv: string[],
  length = pv.length,
) {
  const base = replay(record, ply).position;
  if (!validatePV(base, pv)) fail("Engine variation failed legality checks");
  if (!Number.isInteger(length) || length < 0 || length > pv.length)
    fail("Invalid variation ply");
  const p = base.clone();
  for (const usi of pv.slice(0, length)) {
    const move = p.createMoveByUSI(usi);
    if (!move || !p.doMove(move)) fail("Illegal variation");
  }
  return p;
}
