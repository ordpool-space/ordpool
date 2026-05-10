import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { OtsCalendarPickerService } from './ots-calendar-picker.service';
import { OTS_FALLBACK_CALENDARS } from './ots-store.service';

describe('OtsCalendarPickerService', () => {
  let http: jest.Mocked<HttpClient>;
  let picker: OtsCalendarPickerService;

  function setup() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OtsCalendarPickerService,
        { provide: HttpClient, useValue: http },
      ],
    });
    picker = TestBed.inject(OtsCalendarPickerService);
  }

  it('picks the freshest 3 by lastBlocktime when stats are available', async () => {
    http = {
      get: jest.fn((url: string) => {
        if (url.endsWith('/stamp-calendars')) {
          return of({ calendars: [
            { nickname: 'alice',     url: 'https://alice.example.org' },
            { nickname: 'bob',       url: 'https://bob.example.org' },
            { nickname: 'finney',    url: 'https://finney.example.org' },
            { nickname: 'catallaxy', url: 'https://cat.example.org' },
          ] });
        }
        // /ots/calendars stats endpoint -- finney is freshest, then bob, then catallaxy.
        // alice has the oldest data; should drop out of top-3.
        return of([
          { calendar: 'alice',     totalCommits: 0, lastBlockheight: 0, lastBlocktime: 1700000000, pendingCount: 0 },
          { calendar: 'bob',       totalCommits: 0, lastBlockheight: 0, lastBlocktime: 1700001000, pendingCount: 0 },
          { calendar: 'finney',    totalCommits: 0, lastBlockheight: 0, lastBlocktime: 1700002000, pendingCount: 0 },
          { calendar: 'catallaxy', totalCommits: 0, lastBlockheight: 0, lastBlocktime: 1700000500, pendingCount: 0 },
        ]);
      }) as any,
    } as any;
    setup();
    const picked = await picker.pick();
    expect(picked.length).toBe(3);
    expect(picked.map(c => c.nickname)).toEqual(['finney', 'bob', 'catallaxy']);
  });

  it('falls through to configured order when stats endpoint fails', async () => {
    http = {
      get: jest.fn((url: string) => {
        if (url.endsWith('/stamp-calendars')) {
          return of({ calendars: [
            { nickname: 'alice',  url: 'https://alice.example.org' },
            { nickname: 'bob',    url: 'https://bob.example.org' },
            { nickname: 'finney', url: 'https://finney.example.org' },
          ] });
        }
        return throwError(() => new Error('stats unreachable'));
      }) as any,
    } as any;
    setup();
    const picked = await picker.pick();
    expect(picked.map(c => c.nickname)).toEqual(['alice', 'bob', 'finney']);
  });

  it('falls back to hardcoded list when /stamp-calendars is empty', async () => {
    http = {
      get: jest.fn(() => of({ calendars: [] })) as any,
    } as any;
    setup();
    const picked = await picker.pick();
    expect(picked.length).toBe(Math.min(3, OTS_FALLBACK_CALENDARS.length));
  });

  it('falls back to hardcoded list when /stamp-calendars throws', async () => {
    http = {
      get: jest.fn(() => throwError(() => new Error('config endpoint dead'))) as any,
    } as any;
    setup();
    const picked = await picker.pick();
    expect(picked.length).toBe(Math.min(3, OTS_FALLBACK_CALENDARS.length));
    expect(picked[0].nickname).toBe('alice');
  });

  it('caches the result -- second call does not refetch', async () => {
    http = {
      get: jest.fn((url: string) => {
        if (url.endsWith('/stamp-calendars')) {
          return of({ calendars: [{ nickname: 'alice', url: 'https://alice.example.org' }] });
        }
        return of([]);
      }) as any,
    } as any;
    setup();
    await picker.pick();
    await picker.pick();
    await picker.pick();
    // Two calls per pick (config + stats), but only on the FIRST pick.
    expect(http.get).toHaveBeenCalledTimes(2);
  });
});
