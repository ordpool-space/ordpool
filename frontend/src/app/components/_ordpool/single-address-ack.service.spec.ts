import { TestBed } from '@angular/core/testing';

import { SingleAddressAckService } from './single-address-ack.service';

describe('SingleAddressAckService (wallet-ux-round3 §7.6)', () => {
  let service: SingleAddressAckService;

  beforeEach(() => {
    try { localStorage.clear(); } catch { /* jsdom */ }
    TestBed.configureTestingModule({});
    service = TestBed.inject(SingleAddressAckService);
  });

  it('is not acknowledged before anyone acknowledges', () => {
    expect(service.isAcknowledged('unisat')).toBe(false);
  });

  it('acknowledges a wallet type and reports it acknowledged', () => {
    service.acknowledge('unisat');
    expect(service.isAcknowledged('unisat')).toBe(true);
  });

  it('is PER wallet type: acknowledging one does not acknowledge another', () => {
    service.acknowledge('unisat');
    expect(service.isAcknowledged('unisat')).toBe(true);
    expect(service.isAcknowledged('wizz')).toBe(false);
  });

  it('treats null / undefined wallet types as not acknowledged and ignores acknowledging them', () => {
    expect(service.isAcknowledged(null)).toBe(false);
    expect(service.isAcknowledged(undefined)).toBe(false);
    service.acknowledge(null);
    service.acknowledge(undefined);
    expect(service.isAcknowledged(null)).toBe(false);
  });

  it('persists to localStorage so a fresh instance (a reload) sees the acknowledgement', () => {
    service.acknowledge('okx');
    // A new instance reads the persisted set on construction — the reload case.
    const reloaded = new SingleAddressAckService();
    expect(reloaded.isAcknowledged('okx')).toBe(true);
  });

  it('emits the acknowledged set on the observable', (done) => {
    service.acknowledge('alby');
    service.acknowledged$.subscribe((set) => {
      expect(set.has('alby')).toBe(true);
      done();
    });
  });
});
