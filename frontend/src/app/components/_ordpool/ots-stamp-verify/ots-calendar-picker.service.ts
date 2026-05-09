import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@environments/environment';

import { OTS_FALLBACK_CALENDARS, OtsKnownCalendar } from './ots-store.service';

/*
Test cases:
- Backend returns 4 calendars: pick all 4.
- Backend serves an empty list: fall through to the hardcoded fallback.
- Backend down: fall through to the hardcoded fallback.
*/

interface StampCalendarsResponse {
  calendars: OtsKnownCalendar[];
}

@Injectable({ providedIn: 'root' })
export class OtsCalendarPickerService {

  private http = inject(HttpClient);
  private cache: ReadonlyArray<OtsKnownCalendar> | null = null;

  /**
   * Resolves to the live calendar set the frontend should fan out to at
   * stamp time. Source of truth is the backend's editable
   * ots-calendars.json (served at /api/v1/ordpool/ots/stamp-calendars). On
   * any failure we fall back to the hardcoded list so the dropzone still
   * works.
   */
  async pick(): Promise<ReadonlyArray<OtsKnownCalendar>> {
    if (this.cache) return this.cache;
    try {
      const apiBase = environment.apiBaseUrl || '';
      const resp = await firstValueFrom(
        this.http.get<StampCalendarsResponse>(`${apiBase}/api/v1/ordpool/ots/stamp-calendars`),
      );
      const list = (resp?.calendars ?? []).filter(
        c => c && typeof c.nickname === 'string' && /^https?:\/\//.test(c.url),
      );
      if (list.length === 0) throw new Error('empty list');
      this.cache = Object.freeze(list);
      return this.cache;
    } catch {
      return OTS_FALLBACK_CALENDARS;
    }
  }
}
