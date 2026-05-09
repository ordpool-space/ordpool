import * as fs from 'fs';
import * as path from 'path';
import logger from '../../../logger';

/**
 * Single source of truth for "which OTS calendars does ordpool stamp through".
 *
 * The JSON file is intentionally hand-editable -- adding a new calendar is a
 * single-line PR (no rebuild logic). Each entry is just the calendar's base
 * URI; the host is derived for the proxy whitelist and the shortname (for
 * the dashboard) is derived from the host's first label.
 *
 * On boot we load + freeze; if the file is missing or corrupt we fall back
 * to the historical defaults so we never ship a fully-broken stamp UI.
 */

interface OtsCalendarsConfigFile {
  calendars: string[];
}

const FALLBACK_URIS: ReadonlyArray<string> = Object.freeze([
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com',
  'https://ots.btc.catallaxy.com',
]);

let cachedUris: ReadonlyArray<string> | null = null;
let cachedHosts: ReadonlySet<string> | null = null;

function load(): ReadonlyArray<string> {
  if (cachedUris) return cachedUris;
  const filePath = path.join(__dirname, 'ots-calendars.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as OtsCalendarsConfigFile;
    if (!parsed?.calendars || !Array.isArray(parsed.calendars) || parsed.calendars.length === 0) {
      throw new Error('ots-calendars.json: empty or malformed calendars[]');
    }
    const uris = parsed.calendars
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
      .map(u => u.replace(/\/+$/, ''));   // strip trailing slash
    if (uris.length === 0) throw new Error('ots-calendars.json: no usable URIs');
    cachedUris = Object.freeze(uris);
    return cachedUris;
  } catch (e) {
    logger.warn(`OTS calendars config: ${e instanceof Error ? e.message : e}; using hardcoded fallback`);
    cachedUris = FALLBACK_URIS;
    return cachedUris;
  }
}

export function getOtsCalendarUris(): ReadonlyArray<string> {
  return load();
}

export function getOtsCalendarHosts(): ReadonlySet<string> {
  if (cachedHosts) return cachedHosts;
  const hosts = new Set<string>();
  for (const uri of load()) {
    try { hosts.add(new URL(uri).hostname.toLowerCase()); } catch { /* skip bad URI */ }
  }
  cachedHosts = hosts;
  return cachedHosts;
}
