import { getOtsCalendars, getOtsCalendarHosts } from './ots-calendars-config';

describe('OTS calendar config (regression guards)', () => {

  it('loads the calendar list from ots-calendars.json without falling back to the hardcoded defaults', () => {
    // If the JSON file goes missing or malformed at runtime, the loader
    // logs a warning and returns FALLBACK_CALENDARS. Either path lands
    // in the same shape -- this assertion just makes sure SOMETHING
    // loaded.
    const cals = getOtsCalendars();
    expect(cals.length).toBeGreaterThanOrEqual(1);
    for (const c of cals) {
      expect(c.nickname).toBeTruthy();
      expect(c.url).toMatch(/^https:\/\//);
      expect(c.url).not.toMatch(/\/$/);
    }
  });

  it('catallaxy is configured at its CANONICAL URL (not the ots.btc alias)', () => {
    // Pre-2026-05-17 history: catallaxy was configured as
    // https://ots.btc.catallaxy.com. Both subdomains accept /digest
    // but the receipt always embeds the canonical
    // https://btc.calendar.catallaxy.com as the pending-attestation
    // URI. Frontend does strict equality between cal.url and the
    // embedded URI, so the alias config caused every catallaxy stamp
    // to be marked "error" in the UI even though the calendar
    // happily accepted it. Fixed in commit 115e33a32; this pins it.
    const catallaxy = getOtsCalendars().find(c => c.nickname === 'catallaxy');
    expect(catallaxy).toBeDefined();
    expect(catallaxy!.url).toBe('https://btc.calendar.catallaxy.com');
    expect(catallaxy!.url).not.toBe('https://ots.btc.catallaxy.com');
  });

  it('getOtsCalendarHosts() returns the hostname(s) for every configured calendar', () => {
    const hosts = getOtsCalendarHosts();
    expect(hosts.size).toBeGreaterThanOrEqual(getOtsCalendars().length);
    // Hostname for the canonical catallaxy URL must be in the
    // allowlist -- the proxy's SSRF guard uses this set to gate
    // /digest forwarding.
    expect(hosts.has('btc.calendar.catallaxy.com')).toBe(true);
    expect(hosts.has('ots.btc.catallaxy.com')).toBe(false);
  });
});
