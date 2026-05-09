import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { OrdpoolApiService, OrdpoolOtsRow } from '../../../services/ordinals/ordpool-api.service';
import { BlockOtsSummaryComponent } from './block-ots-summary.component';

describe('BlockOtsSummaryComponent', () => {
  let api: jest.Mocked<OrdpoolApiService>;

  beforeEach(() => {
    api = { getOtsBlock$: jest.fn() } as any;
    TestBed.configureTestingModule({
      declarations: [BlockOtsSummaryComponent],
      providers: [{ provide: OrdpoolApiService, useValue: api }],
    }).overrideComponent(BlockOtsSummaryComponent, { set: { template: '' } });
  });

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

  it('null/undefined blockHeight → empty rows + loaded=true (no API call)', () => {
    const fixture = TestBed.createComponent(BlockOtsSummaryComponent);
    fixture.componentInstance.blockHeight = null;
    expect(fixture.componentInstance.rows).toEqual([]);
    expect(fixture.componentInstance.loaded).toBe(true);
    expect(api.getOtsBlock$).not.toHaveBeenCalled();
  });

  it('happy path: rows from API populate component state', () => {
    const a = makeRow({ calendar: 'alice', txid: 'a'.repeat(64) });
    const b = makeRow({ calendar: 'bob',   txid: 'b'.repeat(64) });
    api.getOtsBlock$.mockReturnValueOnce(of([a, b]));
    const fixture = TestBed.createComponent(BlockOtsSummaryComponent);
    fixture.componentInstance.blockHeight = 948192;
    expect(api.getOtsBlock$).toHaveBeenCalledWith(948192);
    expect(fixture.componentInstance.rows.length).toBe(2);
    expect(fixture.componentInstance.loaded).toBe(true);
  });

  it('API error → empty rows, loaded=true (panel self-hides)', () => {
    api.getOtsBlock$.mockReturnValueOnce(throwError(() => ({ status: 503 })));
    const fixture = TestBed.createComponent(BlockOtsSummaryComponent);
    fixture.componentInstance.blockHeight = 948192;
    expect(fixture.componentInstance.rows).toEqual([]);
    expect(fixture.componentInstance.loaded).toBe(true);
  });

  it('toggle() flips expanded', () => {
    const fixture = TestBed.createComponent(BlockOtsSummaryComponent);
    expect(fixture.componentInstance.expanded).toBe(false);
    fixture.componentInstance.toggle();
    expect(fixture.componentInstance.expanded).toBe(true);
    fixture.componentInstance.toggle();
    expect(fixture.componentInstance.expanded).toBe(false);
  });
});
