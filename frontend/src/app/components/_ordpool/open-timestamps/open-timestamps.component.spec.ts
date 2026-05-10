import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  OrdpoolApiService,
  OrdpoolOtsCalendarStats,
  OrdpoolOtsRow,
} from '../../../services/ordinals/ordpool-api.service';
import { OpenTimestampsComponent } from './open-timestamps.component';
import { SeoService } from '../../../services/seo.service';
import { OtsStoreService } from '../ots-stamp-verify/ots-store.service';

describe('OpenTimestampsComponent', () => {
  let api: jest.Mocked<OrdpoolApiService>;

  function makeStats(over: Partial<OrdpoolOtsCalendarStats> = {}): OrdpoolOtsCalendarStats {
    return {
      calendar: 'alice', totalCommits: 1234, lastBlockheight: 948192,
      lastBlocktime: 1778100000, pendingCount: 2, ...over,
    };
  }

  function makeRow(over: Partial<OrdpoolOtsRow> = {}): OrdpoolOtsRow {
    return {
      txid: 'a'.repeat(64),
      calendar: 'alice',
      merkleRoot: 'b'.repeat(64),
      firstSeenAt: new Date(),
      confirmedAt: new Date(),
      blockhash: '0'.repeat(64),
      blockheight: 948192,
      blocktime: 1778100000,
      fee: 159,
      feerate: '0.68',
      ...over,
    };
  }

  function setup(): void {
    const seoStub = {
      setTitle: jest.fn(), resetTitle: jest.fn(),
      setDescription: jest.fn(), resetDescription: jest.fn(),
    };
    const storeStub = { localStorageAvailable: true };
    TestBed.configureTestingModule({
      declarations: [OpenTimestampsComponent],
      providers: [
        { provide: OrdpoolApiService, useValue: api },
        { provide: SeoService, useValue: seoStub },
        { provide: OtsStoreService, useValue: storeStub },
      ],
    }).overrideComponent(OpenTimestampsComponent, { set: { template: '' } });
  }

  it('happy path: both feeds populate component state', () => {
    api = {
      getOtsCalendars$: jest.fn().mockReturnValue(of([makeStats({ calendar: 'alice' }), makeStats({ calendar: 'bob' })])),
      getOtsRecent$: jest.fn().mockReturnValue(of([makeRow()])),
    } as any;
    setup();

    const fixture = TestBed.createComponent(OpenTimestampsComponent);
    expect(api.getOtsCalendars$).toHaveBeenCalled();
    expect(api.getOtsRecent$).toHaveBeenCalledWith(50);
    expect(fixture.componentInstance.calendars.length).toBe(2);
    expect(fixture.componentInstance.recent.length).toBe(1);
    expect(fixture.componentInstance.calendarsLoaded).toBe(true);
    expect(fixture.componentInstance.recentLoaded).toBe(true);
  });

  it('graceful degradation: calendars feed errors → empty list, recent still works', () => {
    api = {
      getOtsCalendars$: jest.fn().mockReturnValue(throwError(() => ({ status: 503 }))),
      getOtsRecent$: jest.fn().mockReturnValue(of([makeRow()])),
    } as any;
    setup();

    const fixture = TestBed.createComponent(OpenTimestampsComponent);
    expect(fixture.componentInstance.calendars).toEqual([]);
    expect(fixture.componentInstance.calendarsLoaded).toBe(true);
    expect(fixture.componentInstance.recent.length).toBe(1);
  });

  it('graceful degradation: recent feed errors → empty list, calendars still works', () => {
    api = {
      getOtsCalendars$: jest.fn().mockReturnValue(of([makeStats()])),
      getOtsRecent$: jest.fn().mockReturnValue(throwError(() => ({ status: 503 }))),
    } as any;
    setup();

    const fixture = TestBed.createComponent(OpenTimestampsComponent);
    expect(fixture.componentInstance.calendars.length).toBe(1);
    expect(fixture.componentInstance.recent).toEqual([]);
    expect(fixture.componentInstance.recentLoaded).toBe(true);
  });
});
