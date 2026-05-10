import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@environments/environment';

import { OrdpoolOtsCalendarStats } from '../../../services/ordinals/ordpool-api.service';
import { OTS_FALLBACK_CALENDARS, OtsKnownCalendar } from './ots-store.service';

/*
Test cases:
- Backend serves 4 configured calendars + indexer stats: pick the 3 with the
  most recent lastBlocktime.
- Backend has fewer than 3 with stats: pad up to 3 with the remaining
  configured calendars in their declared order.
- /ots/calendars endpoint down but /ots/stamp-calendars works: take the
  first 3 of the configured list.
- /ots/stamp-calendars down: fall through to hardcoded fallback.
*/

const TARGET_CALENDARS = 3;

interface StampCalendarsResponse {
  calendars: OtsKnownCalendar[];
}

@Injectable({ providedIn: 'root' })
export class OtsCalendarPickerService {

  private http = inject(HttpClient);
  private cache: ReadonlyArray<OtsKnownCalendar> | null = null;

  /**
   * Resolves to the calendars the frontend should fan out to at stamp time.
   * We fan out to a fixed N (currently 3) for redundancy without overdoing
   * it. Selection is "healthiest 3": configured calendars are joined with
   * the live indexer's per-calendar stats and sorted by `lastBlocktime`
   * descending; the freshest 3 win. If indexer stats aren't available we
   * fall back to the configured order. If the whole config endpoint fails
   * we fall back to the hardcoded list so the drop-zone still works.
   */
  async pick(): Promise<ReadonlyArray<OtsKnownCalendar>> {
    if (this.cache) return this.cache;
    try {
      const apiBase = environment.apiBaseUrl || '';
      const [config, stats] = await Promise.all([
        firstValueFrom(
          this.http.get<StampCalendarsResponse>(`${apiBase}/api/v1/ordpool/ots/stamp-calendars`),
        ),
        firstValueFrom(
          this.http.get<OrdpoolOtsCalendarStats[]>(`${apiBase}/api/v1/ordpool/ots/calendars`),
        ).catch(() => [] as OrdpoolOtsCalendarStats[]),
      ]);
      const configured = (config?.calendars ?? []).filter(
        c => c && typeof c.nickname === 'string' && /^https?:\/\//.test(c.url),
      );
      if (configured.length === 0) throw new Error('empty list');

      // Build a freshness lookup from the indexer stats. Calendars that
      // never published (or that the indexer hasn't seen) get freshness 0,
      // which sinks them in the sort but doesn't drop them outright.
      const freshness = new Map<string, number>();
      for (const s of stats || []) {
        if (s?.calendar && typeof s.lastBlocktime === 'number') {
          freshness.set(s.calendar, s.lastBlocktime);
        }
      }
      const ranked = [...configured].sort((a, b) =>
        (freshness.get(b.nickname) ?? 0) - (freshness.get(a.nickname) ?? 0),
      );
      const picked = ranked.slice(0, TARGET_CALENDARS);

      this.cache = Object.freeze(picked);
      return this.cache;
    } catch {
      return OTS_FALLBACK_CALENDARS.slice(0, TARGET_CALENDARS);
    }
  }
}
