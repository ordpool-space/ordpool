#!/usr/bin/env node
/**
 * OpenTimestamps calendar polling prototype.
 *
 * Polls every known public OTS calendar's `/` endpoint with
 * `Accept: application/json` and harvests observed Bitcoin transactions
 * (confirmed and mempool/pending). Writes a single JSON state file so
 * subsequent runs can dedupe and detect newly-seen txs.
 *
 * Zero deps. Pure Node 18+ built-ins (fetch, fs, setInterval).
 *
 * Run:
 *   node backend/scripts/ots-poll.mjs                     (poll every 30s)
 *   node backend/scripts/ots-poll.mjs --once              (single poll, exit)
 *   node backend/scripts/ots-poll.mjs --interval 60       (poll every 60s)
 *   node backend/scripts/ots-poll.mjs --state /tmp/x.json (custom state path)
 *
 * State path defaults to /tmp/ots-poll-state.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Calendars known from python-opentimestamps/opentimestamps/calendar.py.
// Using non-aggregator hostnames so we hit each calendar directly.
const CALENDARS = [
  { name: 'alice',     url: 'https://alice.btc.calendar.opentimestamps.org/',  operator: 'Peter Todd' },
  { name: 'bob',       url: 'https://bob.btc.calendar.opentimestamps.org/',    operator: 'Peter Todd' },
  { name: 'finney',    url: 'https://finney.calendar.eternitywall.com/',       operator: 'Eternity Wall' },
  { name: 'catallaxy', url: 'https://btc.calendar.catallaxy.com/',             operator: 'Bull Bitcoin' },
];

const args = parseArgs(process.argv.slice(2));
const STATE_PATH = args.state ?? '/tmp/ots-poll-state.json';
const INTERVAL_MS = (args.interval ?? 30) * 1000;
const ONCE = args.once === true;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') out.once = true;
    else if (a === '--interval') out.interval = Number(argv[++i]);
    else if (a === '--state') out.state = argv[++i];
  }
  return out;
}

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { calendars: {}, txs: {}, polls: 0 };
  }
  return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function fetchCalendar(cal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(cal.url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function pollCalendar(cal, body, state, now) {
  // Snapshot calendar-level liveness only. Anything else (address, balance,
  // tip, pending_commitments) we read fresh from the next poll if we ever
  // need it -- not worth persisting.
  state.calendars[cal.name] = {
    url: cal.url,
    operator: cal.operator,
    version: body.version,
    last_poll_at: now,
    last_poll_ok: true,
    last_error: null,
  };

  // Walk the transactions array. Each item may be confirmed (has blockheight)
  // or mempool (no blockheight, confirmations=0).
  const txList = Array.isArray(body.transactions) ? body.transactions : [];
  let newCount = 0;
  let newlyConfirmed = 0;
  let pendingNow = 0;

  for (const tx of txList) {
    const txid = tx.txid;
    if (!txid) continue;
    const isPending = !tx.blockheight || tx.confirmations === 0;
    if (isPending) pendingNow++;

    const existing = state.txs[txid];
    if (!existing) {
      newCount++;
      state.txs[txid] = {
        calendar: cal.name,
        first_seen_at: now,
        confirmed_at: !isPending ? now : null,
        blockhash: tx.blockhash ?? null,
        blockheight: tx.blockheight ?? null,
        blocktime: tx.blocktime ?? null,
        fee: tx.fee ?? null,
        feerate: tx.feerate ?? null,
      };
    } else if (!existing.confirmed_at && !isPending) {
      newlyConfirmed++;
      existing.confirmed_at = now;
      existing.blockhash = tx.blockhash ?? null;
      existing.blockheight = tx.blockheight ?? null;
      existing.blocktime = tx.blocktime ?? null;
    }
  }

  return { newCount, newlyConfirmed, pendingNow, total: txList.length };
}

function summary(state) {
  const txEntries = Object.entries(state.txs);
  const confirmed = txEntries.filter(([, t]) => t.confirmed_at !== null).length;
  const pending = txEntries.length - confirmed;
  return { total_txs: txEntries.length, confirmed, pending };
}

async function poll(state) {
  const now = new Date().toISOString();
  state.polls = (state.polls ?? 0) + 1;

  const lines = [];
  for (const cal of CALENDARS) {
    const r = await fetchCalendar(cal);
    if (!r.ok) {
      const prev = state.calendars[cal.name] ?? {};
      state.calendars[cal.name] = {
        ...prev,
        url: cal.url,
        operator: cal.operator,
        last_poll_at: now,
        last_poll_ok: false,
        last_error: r.error,
      };
      lines.push(`[${now}] ${cal.name.padEnd(9)}: FAIL ${r.error}`);
      continue;
    }
    const stats = pollCalendar(cal, r.body, state, now);
    lines.push(
      `[${now}] ${cal.name.padEnd(9)}: total=${String(stats.total).padStart(3)} new=${stats.newCount} ` +
      `confirmed+=${stats.newlyConfirmed} mempool=${stats.pendingNow}`
    );
  }

  saveState(state);
  console.log(lines.join('\n'));
  if (state.polls === 1 || state.polls % 10 === 0) {
    const s = summary(state);
    console.log(
      `[${now}] === poll #${state.polls}  unique_txs=${s.total_txs} (confirmed=${s.confirmed} pending=${s.pending}) ===`
    );
  }
}

async function main() {
  const state = loadState();

  console.log(`OTS calendar poller — ${CALENDARS.length} calendars, every ${INTERVAL_MS / 1000}s, state=${STATE_PATH}`);
  console.log(`Initial state: ${JSON.stringify(summary(state))}`);

  await poll(state);
  if (ONCE) return;

  setInterval(() => { poll(state).catch(e => console.error('poll failed:', e)); }, INTERVAL_MS);
}

main().catch(e => { console.error(e); process.exit(1); });
