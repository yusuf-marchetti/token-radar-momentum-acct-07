// Momentum Breakout Radar — lib/model.ts
//
// A token launch radar that ranks pre-token protocols by breakout, not by bulk.
// The thesis: a token launch follows attention, and attention shows up first as
// TVL momentum. A protocol whose locked value is surging week over week is being
// discovered now; a giant that is flat or shrinking is already priced in by its
// users, even if no token exists yet. So the model lets 7-day momentum bend the
// value hard (a convex response), damps raw size (a sub-linear size term, so a
// 100x bigger protocol is not 100x more valuable), and seasons the result by how
// long the protocol has run with no token recorded (ripeness) and by how many
// chains it spans (breadth: a breakout on several chains at once is wider).
//
// Every input comes from the sealed snapshot alone. No protocol name is ever
// special-cased: the same four factors score every row, and the dashboard shows
// each row's four factors so a reader can check the arithmetic.
//
//   size      = tvl_usd ^ 0.65                       (dampened size)
//   growth    = clamp(change_7d, -60, 200)           (per cent; null reads as 0)
//   momentum  = (1 + growth / 100) ^ 2.0             (convex: breakouts compound)
//   ripeness  = f(age_days)                          (prime window 1y..3y, see below)
//   breadth   = 1 + 0.04 * min(chains, 6)            (1.00 .. 1.24)
//   implied   = max(1, round(size * 0.35 * momentum * ripeness * breadth))
//
// Ripeness by age (days since DefiLlama first tracked the protocol):
//   unknown     -> 0.85   (no track record to season on)
//   under 90    -> 0.70 .. 0.85, rising with age (too young to trust the surge)
//   90 .. 365   -> 0.85 .. 1.00, rising with age (finding its feet)
//   365 .. 1095 -> 1.00  (prime: seasoned, still pre-token, breakout is news)
//   1095 ..1460 -> 0.97  (late: launch window may be passing)
//   over 1460   -> 0.90  (four years with no token recorded tempers the claim)
//
// Momentum bands, from the same clamped 7-day change, are the board's first
// filter: BREAKOUT (+15% or more), RISING (+5% to +15%), STEADY (-5% to +5%),
// COOLING (below -5%), UNKNOWN (no 7-day figure recorded).

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  size_exponent: number;
  size_scale: number;
  momentum_exponent: number;
  growth_floor: number;
  growth_cap: number;
  unknown_age_ripeness: number;
  young_age_days: number;
  young_ripeness_low: number;
  prime_start_days: number;
  prime_end_days: number;
  late_ripeness: number;
  old_ripeness: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  breakout_pct: number;
  rising_pct: number;
  cooling_pct: number;
}

export const MODEL: ModelConstants = {
  size_exponent: 0.65,
  size_scale: 0.35,
  momentum_exponent: 2.0,
  growth_floor: -60,
  growth_cap: 200,
  unknown_age_ripeness: 0.85,
  young_age_days: 90,
  young_ripeness_low: 0.7,
  prime_start_days: 365,
  prime_end_days: 1095,
  late_ripeness: 0.97,
  old_ripeness: 0.9,
  breadth_per_chain: 0.04,
  breadth_max_chains: 6,
  breakout_pct: 15,
  rising_pct: 5,
  cooling_pct: -5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'breakout-7';

/** How many early pre-token protocols below the watchlist floor the board carries. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the Already trading strip carries, by market cap. */
export const LIVE_ROWS = 16;

/** A momentum band: the board's first filter and the farm plan's clock. */
export type MomentumBand = 'BREAKOUT' | 'RISING' | 'STEADY' | 'COOLING' | 'UNKNOWN';

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  momentum_band: MomentumBand;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_factor: number;
    growth_pct: number;
    momentum_multiplier: number;
    ripeness_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  momentum_band: MomentumBand;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  size_factor: number;
  momentum_multiplier: number;
  ripeness_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  band_counts: Record<MomentumBand, number>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The ripeness multiplier for an age in days (null: no track record to season on). */
export function ripenessFor(age: number | null, model: ModelConstants = MODEL): number {
  if (age === null) return model.unknown_age_ripeness;
  if (age < model.young_age_days) {
    const t = age / model.young_age_days;
    return model.young_ripeness_low + t * (model.unknown_age_ripeness - model.young_ripeness_low);
  }
  if (age < model.prime_start_days) {
    const t = (age - model.young_age_days) / (model.prime_start_days - model.young_age_days);
    return model.unknown_age_ripeness + t * (1 - model.unknown_age_ripeness);
  }
  if (age <= model.prime_end_days) return 1;
  if (age <= 1460) return model.late_ripeness;
  return model.old_ripeness;
}

/** The momentum band for a 7-day change (null: no figure recorded). */
export function bandFor(change7d: number | null, model: ModelConstants = MODEL): MomentumBand {
  if (change7d === null || !Number.isFinite(change7d)) return 'UNKNOWN';
  if (change7d >= model.breakout_pct) return 'BREAKOUT';
  if (change7d >= model.rising_pct) return 'RISING';
  if (change7d <= model.cooling_pct) return 'COOLING';
  return 'STEADY';
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): {
  implied: number;
  sizeFactor: number;
  growthPct: number;
  momentumMult: number;
  ripenessMult: number;
  breadthMult: number;
  age: number | null;
  band: MomentumBand;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const sizeFactor = Math.pow(Math.max(protocol.tvl_usd, 1), model.size_exponent);
  const momentumMult = Math.pow(1 + growthPct / 100, model.momentum_exponent);
  const ripenessMult = ripenessFor(age, model);
  const breadthMult = 1 + model.breadth_per_chain * Math.min(protocol.chains.length, model.breadth_max_chains);
  const implied = Math.max(
    1,
    Math.round(sizeFactor * model.size_scale * momentumMult * ripenessMult * breadthMult),
  );
  return { implied, sizeFactor, growthPct, momentumMult, ripenessMult, breadthMult, age, band: bandFor(protocol.change_7d, model) };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  plan: (p: SnapshotProtocol, age: number | null, band: MomentumBand) => string[],
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its momentum.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by breakout
  // value, capped. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, score: impliedValue(p, snapshot.as_of, model).implied }))
    .sort((a, b) => b.score - a.score || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    momentum_band: s.v.band,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      size_factor: round2(s.v.sizeFactor),
      growth_pct: round2(s.v.growthPct),
      momentum_multiplier: round4(s.v.momentumMult),
      ripeness_multiplier: round4(s.v.ripenessMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: plan(s.p, s.v.age, s.v.band),
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Already trading strip. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    momentum_band: row.momentum_band,
    age_days: row.age_days,
    on_watchlist: onWatchlist,
    implied_value_usd: row.implied_value_usd,
    size_factor: row.model.size_factor,
    momentum_multiplier: row.model.momentum_multiplier,
    ripeness_multiplier: row.model.ripeness_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  plan: (p: SnapshotProtocol, age: number | null, band: MomentumBand) => string[],
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model, plan);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const bandCounts: Record<MomentumBand, number> = { BREAKOUT: 0, RISING: 0, STEADY: 0, COOLING: 0, UNKNOWN: 0 };
  for (const r of board) bandCounts[r.momentum_band] += 1;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    band_counts: bandCounts,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
