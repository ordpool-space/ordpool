import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { OrdpoolApiService, OrdpoolOtsRow } from '../../../../services/ordinals/ordpool-api.service';
import { OtsViewerComponent } from './ots-viewer.component';

describe('OtsViewerComponent', () => {
  let api: jest.Mocked<OrdpoolApiService>;

  beforeEach(() => {
    api = {
      getOtsTx$: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      declarations: [OtsViewerComponent],
      providers: [{ provide: OrdpoolApiService, useValue: api }],
      schemas: [/* no template render needed for these tests */],
    }).overrideComponent(OtsViewerComponent, { set: { template: '' } });
  });

  function makeRow(over: Partial<OrdpoolOtsRow> = {}): OrdpoolOtsRow {
    return {
      txid: '8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f',
      calendar: 'alice',
      merkleRoot: '64a604fcdfa6b5bb2f3245a283da4cad7d2d33064904fe0d2a689e4fbbb123ef',
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

  it('sets row=null + loaded=true when txid is undefined', () => {
    const fixture = TestBed.createComponent(OtsViewerComponent);
    fixture.componentInstance.txid = undefined;
    expect(fixture.componentInstance.row).toBeNull();
    expect(fixture.componentInstance.loaded).toBe(true);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  it('renders the row when the API returns one', () => {
    api.getOtsTx$.mockReturnValueOnce(of(makeRow()));
    const fixture = TestBed.createComponent(OtsViewerComponent);
    fixture.componentInstance.txid = '8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f';
    expect(api.getOtsTx$).toHaveBeenCalledWith('8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f');
    expect(fixture.componentInstance.row?.calendar).toBe('alice');
    expect(fixture.componentInstance.loaded).toBe(true);
  });

  it('silently no-ops on 404 (non-OTS tx) -- row stays null, no error surfaces', () => {
    api.getOtsTx$.mockReturnValueOnce(throwError(() => ({ status: 404 })));
    const fixture = TestBed.createComponent(OtsViewerComponent);
    fixture.componentInstance.txid = '2bb85f4b004be6da54f766c17c1e855187327112c231ef2ff35ebad0ea67c69e';
    expect(fixture.componentInstance.row).toBeNull();
    expect(fixture.componentInstance.loaded).toBe(true);
  });

  it('handles 5xx the same as 404 -- row stays null', () => {
    api.getOtsTx$.mockReturnValueOnce(throwError(() => ({ status: 503 })));
    const fixture = TestBed.createComponent(OtsViewerComponent);
    fixture.componentInstance.txid = 'some-txid';
    expect(fixture.componentInstance.row).toBeNull();
    expect(fixture.componentInstance.loaded).toBe(true);
  });

  it('exposes pending vs confirmed state via the row.confirmedAt field', () => {
    api.getOtsTx$.mockReturnValueOnce(of(makeRow({ confirmedAt: null, blockheight: null, blockhash: null })));
    const fixture = TestBed.createComponent(OtsViewerComponent);
    fixture.componentInstance.txid = '8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f';
    expect(fixture.componentInstance.row?.confirmedAt).toBeNull();
  });
});
