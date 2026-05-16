import { TestBed } from '@angular/core/testing';
import { Observable, of, ReplaySubject, Subject, throwError } from 'rxjs';

import { OrdpoolApiService } from './ordpool-api.service';
import { OtsKnowledgeService } from './ots-knowledge.service';
import { StateService } from '../state.service';
import { Transaction } from '../../interfaces/electrs.interface';

/*
Three-source decision logic for the ordpool_ots bit:
  1. tx.isOtsCommit === true|false        -> trust the server-attached tristate
  2. no OP_RETURN output in the tx        -> fast-path "definitely not"
  3. lazy backend probe (cached)          -> for txs with OP_RETURN

Cache semantics:
  - true answers are monotonic (forever)
  - false answers have a 60s TTL (poller may flip them later)
  - probe failures degrade to false WITHOUT caching the failure

See ORDPOOL-FLAGS-ARCHITECTURE.md §4 for the full design.
*/

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    txid: 'a'.repeat(64),
    version: 2,
    locktime: 0,
    size: 200,
    weight: 800,
    fee: 1000,
    status: { confirmed: false },
    vin: [],
    vout: [],
    ...overrides,
  } as unknown as Transaction;
}

describe('OtsKnowledgeService', () => {

  let service: OtsKnowledgeService;
  let api: jest.Mocked<OrdpoolApiService>;
  let networkChanged$: ReplaySubject<string>;
  let otsCommitFlipped$: Subject<string>;

  beforeEach(() => {
    api = {
      getOtsTx$: jest.fn(),
    } as unknown as jest.Mocked<OrdpoolApiService>;

    networkChanged$ = new ReplaySubject<string>(1);
    otsCommitFlipped$ = new Subject<string>();
    const stateStub = { networkChanged$, otsCommitFlipped$ } as unknown as StateService;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OtsKnowledgeService,
        { provide: OrdpoolApiService, useValue: api },
        { provide: StateService, useValue: stateStub },
      ],
    });
    service = TestBed.inject(OtsKnowledgeService);
  });

  // ---- (1) server-attached tristate ----

  it('trusts tx.isOtsCommit === true and does NOT call the backend', async () => {
    const tx = makeTx({ isOtsCommit: true, vout: [{ scriptpubkey_type: 'op_return' }] as any });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(true);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  it('trusts tx.isOtsCommit === false and does NOT call the backend', async () => {
    const tx = makeTx({ isOtsCommit: false, vout: [{ scriptpubkey_type: 'op_return' }] as any });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  it('tx.isOtsCommit === null falls through to the OP_RETURN fast path (not trusted as false)', async () => {
    // The tristate spec: `null` means "server didn't compute it",
    // distinct from `false` ("server checked, not a commit"). Must
    // fall through to the next decision source, not be trusted.
    // With no OP_RETURN, fast path -> false without a backend call.
    const tx = makeTx({
      isOtsCommit: null,
      vout: [{ scriptpubkey_type: 'v0_p2wpkh' }] as any,
    });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  it('tx.isOtsCommit === null + OP_RETURN -> falls through to the lazy backend probe', async () => {
    // Tristate `null` + OP_RETURN means: server didn't compute,
    // client cannot conclude from witness, must ask backend.
    api.getOtsTx$.mockReturnValue(of({} as any));
    const tx = makeTx({
      isOtsCommit: null,
      vout: [{ scriptpubkey_type: 'op_return' }] as any,
    });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(true);
    expect(api.getOtsTx$).toHaveBeenCalledWith(tx.txid);
  });

  // ---- (2) OP_RETURN fast path ----

  it('returns false synchronously when the tx has no OP_RETURN output (no backend call)', async () => {
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [
        { scriptpubkey_type: 'v0_p2wpkh' },
        { scriptpubkey_type: 'v1_p2tr' },
      ] as any,
    });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  it('returns false synchronously even when vout is missing/empty', async () => {
    const tx = makeTx({ isOtsCommit: undefined, vout: [] });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  // ---- (3) lazy backend probe ----

  it('calls the backend when tx HAS OP_RETURN and isOtsCommit is undefined', async () => {
    api.getOtsTx$.mockReturnValue(of({} as any));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [
        { scriptpubkey_type: 'v0_p2wpkh' },
        { scriptpubkey_type: 'op_return' },
      ] as any,
    });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(true);
    expect(api.getOtsTx$).toHaveBeenCalledWith(tx.txid);
  });

  it('passes through false results from the backend', async () => {
    api.getOtsTx$.mockReturnValue(of(null));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [{ scriptpubkey_type: 'op_return' }] as any,
    });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
  });

  // ---- (4) caching ----

  it('caches a true answer forever (monotonic): two calls -> one HTTP call', async () => {
    api.getOtsTx$.mockReturnValue(of({} as any));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [{ scriptpubkey_type: 'op_return' }] as any,
    });
    expect(await service.isOtsCommit(tx)).toBe(true);
    expect(await service.isOtsCommit(tx)).toBe(true);
    expect(api.getOtsTx$).toHaveBeenCalledTimes(1);
  });

  it('caches a false answer for 60s; refetches after the TTL', async () => {
    jest.useFakeTimers();
    try {
      api.getOtsTx$.mockReturnValue(of(null));
      const tx = makeTx({
        isOtsCommit: undefined,
        vout: [{ scriptpubkey_type: 'op_return' }] as any,
      });
      expect(await service.isOtsCommit(tx)).toBe(false);
      expect(await service.isOtsCommit(tx)).toBe(false);
      expect(api.getOtsTx$).toHaveBeenCalledTimes(1);

      // Advance past the 60s TTL.
      jest.advanceTimersByTime(60_001);
      expect(await service.isOtsCommit(tx)).toBe(false);
      expect(api.getOtsTx$).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // ---- (5) graceful degradation on probe failure ----

  it('returns null (NOT false, NOT cached) when the backend probe errors', async () => {
    // Probe failure is genuinely "we don't know" -- distinct from a
    // confirmed `false` answer. Returning `false` here would be a
    // category error: it would assert "definitely not an OTS commit"
    // when we have no evidence either way.
    api.getOtsTx$.mockReturnValue(throwError(() => new Error('network down')));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [{ scriptpubkey_type: 'op_return' }] as any,
    });
    const first = await service.isOtsCommit(tx);
    expect(first).toBe(null);

    // The failure was NOT cached, so a second call retries.
    api.getOtsTx$.mockReturnValue(of({} as any));
    const second = await service.isOtsCommit(tx);
    expect(second).toBe(true);
    expect(api.getOtsTx$).toHaveBeenCalledTimes(2);
  });

  // ---- (6) explicit txid-only entry point ----

  it('isOtsCommitByTxid hits the backend directly, no OP_RETURN check', async () => {
    api.getOtsTx$.mockReturnValue(of({} as any));
    const result = await service.isOtsCommitByTxid('c'.repeat(64));
    expect(result).toBe(true);
    expect(api.getOtsTx$).toHaveBeenCalledWith('c'.repeat(64));
  });

  it('clearCache wipes both true and false entries', async () => {
    api.getOtsTx$.mockReturnValue(of({} as any));
    await service.isOtsCommitByTxid('d'.repeat(64));
    expect(api.getOtsTx$).toHaveBeenCalledTimes(1);

    service.clearCache();
    await service.isOtsCommitByTxid('d'.repeat(64));
    expect(api.getOtsTx$).toHaveBeenCalledTimes(2);
  });

  // ---- (7) concurrent-probe coalescing ----

  it('coalesces two concurrent in-flight probes onto a single HTTP request', async () => {
    // The backend emits its response asynchronously. We use a Subject
    // we hold open across the two calls, then complete it, ensuring
    // both await the SAME in-flight Promise.
    const response$ = new Subject<any>();
    api.getOtsTx$.mockReturnValue(response$ as unknown as Observable<any>);

    const txid = 'f'.repeat(64);
    const first = service.isOtsCommitByTxid(txid);
    const second = service.isOtsCommitByTxid(txid);

    // Both calls fired before any HTTP response -- the implementation
    // must have deduplicated the request so the API is consulted once.
    expect(api.getOtsTx$).toHaveBeenCalledTimes(1);

    response$.next({});
    response$.complete();

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(api.getOtsTx$).toHaveBeenCalledTimes(1);
  });

  // ---- (8) WS-driven flip: recordFlip + flipped$ ----

  it('recordFlip(txid) caches true forever and emits on flipped$', async () => {
    const observed: string[] = [];
    service.flipped$.subscribe(t => observed.push(t));
    service.recordFlip('a'.repeat(64));
    expect(observed).toEqual(['a'.repeat(64)]);

    // Cached as true with no expiry: a subsequent isOtsCommitByTxid
    // hits the cache, no backend call.
    api.getOtsTx$.mockReturnValue(of(null));
    const result = await service.isOtsCommitByTxid('a'.repeat(64));
    expect(result).toBe(true);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  it('a WS push via stateService.otsCommitFlipped$ records the flip and fans out', async () => {
    const observed: string[] = [];
    service.flipped$.subscribe(t => observed.push(t));

    // Simulate the backend's WS message arriving via WebsocketService.
    otsCommitFlipped$.next('b'.repeat(64));

    expect(observed).toEqual(['b'.repeat(64)]);
    // And the cache is hot now.
    api.getOtsTx$.mockReturnValue(of(null));
    expect(await service.isOtsCommitByTxid('b'.repeat(64))).toBe(true);
    expect(api.getOtsTx$).not.toHaveBeenCalled();
  });

  it('recordFlip clears any in-flight probe for the same txid', async () => {
    // Kick off a probe that hasn't resolved yet.
    const pending = new Subject<any>();
    api.getOtsTx$.mockReturnValue(pending as unknown as Observable<any>);
    const txid = 'c'.repeat(64);
    const probePromise = service.isOtsCommitByTxid(txid);

    // WS push arrives mid-probe with the authoritative answer.
    service.recordFlip(txid);

    // The probe is still in flight (we never completed `pending`). A
    // brand-new lookup must NOT join that probe -- it should hit the
    // cache directly.
    api.getOtsTx$.mockReturnValue(of(null));
    const fresh = await service.isOtsCommitByTxid(txid);
    expect(fresh).toBe(true);

    // Let the dangling probe complete so jest doesn't whine about it.
    pending.next(null);
    pending.complete();
    await probePromise.catch(() => {});
  });

  // ---- (9) network-scoped cache ----

  it('clears the cache when networkChanged$ emits', async () => {
    // Cache an answer for the current network.
    api.getOtsTx$.mockReturnValue(of({} as any));
    await service.isOtsCommitByTxid('e'.repeat(64));
    expect(api.getOtsTx$).toHaveBeenCalledTimes(1);

    // Cache hit on the second call -- still 1 HTTP request.
    await service.isOtsCommitByTxid('e'.repeat(64));
    expect(api.getOtsTx$).toHaveBeenCalledTimes(1);

    // Switch network. The OTS poller runs against a single network on
    // the backend, so cached answers from the previous network are
    // meaningless and must be discarded.
    networkChanged$.next('signet');

    // Subsequent lookup must re-fetch.
    await service.isOtsCommitByTxid('e'.repeat(64));
    expect(api.getOtsTx$).toHaveBeenCalledTimes(2);
  });
});
