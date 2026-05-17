import * as fs from 'fs';
import * as path from 'path';
import logger from '../../../logger';

/**
 * Single source of truth for the OTS calendar set. Read by:
 *   - the indexer poller (./ordpool-ots-poller.ts)
 *   - the wallet-graph backfill (./ordpool-ots-backfill.ts)
 *   - the proxy whitelist + the frontend stamp endpoint (./ordpool.routes.ts)
 *
 * Adding a calendar = one-line PR to ots-calendars.json. The 'nickname'
 * field is the display name AND the stable DB key (the
 * ordpool_stats_ots.calendar column stores it as-is) -- DO NOT rename
 * an existing calendar's nickname or you'll orphan its stats rows.
 *
 * On boot we load + freeze; if the file is missing or corrupt we fall back
 * to the historical defaults so we never ship a fully-broken stamp UI.
 */

export interface OtsCalendar {
  nickname: string;     // 'alice' | 'bob' | 'finney' | 'catallaxy' | future entries
  url: string;          // base URL without trailing slash
}

interface OtsCalendarsConfigFile {
  calendars: OtsCalendar[];
}

const FALLBACK_CALENDARS: ReadonlyArray<OtsCalendar> = Object.freeze([
  Object.freeze({ nickname: 'alice',     url: 'https://alice.btc.calendar.opentimestamps.org' }),
  Object.freeze({ nickname: 'bob',       url: 'https://bob.btc.calendar.opentimestamps.org' }),
  Object.freeze({ nickname: 'finney',    url: 'https://finney.calendar.eternitywall.com' }),
  Object.freeze({ nickname: 'catallaxy', url: 'https://btc.calendar.catallaxy.com' }),
]);

let cached: ReadonlyArray<OtsCalendar> | null = null;
let cachedHosts: ReadonlySet<string> | null = null;

function load(): ReadonlyArray<OtsCalendar> {
  if (cached) return cached;
  const filePath = path.join(__dirname, 'ots-calendars.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as OtsCalendarsConfigFile;
    if (!parsed?.calendars || !Array.isArray(parsed.calendars) || parsed.calendars.length === 0) {
      throw new Error('ots-calendars.json: empty or malformed calendars[]');
    }
    const out: OtsCalendar[] = [];
    for (const entry of parsed.calendars) {
      const nickname = String((entry as OtsCalendar)?.nickname || '').trim();
      const url = String((entry as OtsCalendar)?.url || '').replace(/\/+$/, '');
      if (nickname && /^https?:\/\//.test(url)) out.push({ nickname, url });
    }
    if (out.length === 0) throw new Error('ots-calendars.json: no usable entries');
    cached = Object.freeze(out);
    return cached;
  } catch (e) {
    logger.warn(`OTS calendars config: ${e instanceof Error ? e.message : e}; using hardcoded fallback`);
    cached = FALLBACK_CALENDARS;
    return cached;
  }
}

/** All calendars, in declaration order (poller, backfill, frontend picker). */
export function getOtsCalendars(): ReadonlyArray<OtsCalendar> {
  return load();
}

/** Hostname allowlist for the upgrade proxy. */
export function getOtsCalendarHosts(): ReadonlySet<string> {
  if (cachedHosts) return cachedHosts;
  const hosts = new Set<string>();
  for (const c of load()) {
    try { hosts.add(new URL(c.url).hostname.toLowerCase()); } catch { /* skip bad URI */ }
  }
  cachedHosts = hosts;
  return cachedHosts;
}
