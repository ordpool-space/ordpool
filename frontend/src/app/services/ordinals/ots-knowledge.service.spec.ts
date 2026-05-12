import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { OrdpoolApiService } from './ordpool-api.service';
import { OtsKnowledgeService } from './ots-knowledge.service';
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

  beforeEach(() => {
    api = {
      isOtsCommit$: jest.fn(),
    } as unknown as jest.Mocked<OrdpoolApiService>;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OtsKnowledgeService,
        { provide: OrdpoolApiService, useValue: api },
      ],
    });
    service = TestBed.inject(OtsKnowledgeService);
  });

  // ---- (1) server-attached tristate ----

  it('trusts tx.isOtsCommit === true and does NOT call the backend', async () => {
    const tx = makeTx({ isOtsCommit: true, vout: [{ scriptpubkey_type: 'op_return' }] as any });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(true);
    expect(api.isOtsCommit$).not.toHaveBeenCalled();
  });

  it('trusts tx.isOtsCommit === false and does NOT call the backend', async () => {
    const tx = makeTx({ isOtsCommit: false, vout: [{ scriptpubkey_type: 'op_return' }] as any });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
    expect(api.isOtsCommit$).not.toHaveBeenCalled();
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
    expect(api.isOtsCommit$).not.toHaveBeenCalled();
  });

  it('returns false synchronously even when vout is missing/empty', async () => {
    const tx = makeTx({ isOtsCommit: undefined, vout: [] });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
    expect(api.isOtsCommit$).not.toHaveBeenCalled();
  });

  // ---- (3) lazy backend probe ----

  it('calls the backend when tx HAS OP_RETURN and isOtsCommit is undefined', async () => {
    api.isOtsCommit$.mockReturnValue(of({ result: true }));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [
        { scriptpubkey_type: 'v0_p2wpkh' },
        { scriptpubkey_type: 'op_return' },
      ] as any,
    });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(true);
    expect(api.isOtsCommit$).toHaveBeenCalledWith(tx.txid);
  });

  it('passes through false results from the backend', async () => {
    api.isOtsCommit$.mockReturnValue(of({ result: false }));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [{ scriptpubkey_type: 'op_return' }] as any,
    });
    const result = await service.isOtsCommit(tx);
    expect(result).toBe(false);
  });

  // ---- (4) caching ----

  it('caches a true answer forever (monotonic): two calls -> one HTTP call', async () => {
    api.isOtsCommit$.mockReturnValue(of({ result: true }));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [{ scriptpubkey_type: 'op_return' }] as any,
    });
    expect(await service.isOtsCommit(tx)).toBe(true);
    expect(await service.isOtsCommit(tx)).toBe(true);
    expect(api.isOtsCommit$).toHaveBeenCalledTimes(1);
  });

  it('caches a false answer for 60s; refetches after the TTL', async () => {
    jest.useFakeTimers();
    try {
      api.isOtsCommit$.mockReturnValue(of({ result: false }));
      const tx = makeTx({
        isOtsCommit: undefined,
        vout: [{ scriptpubkey_type: 'op_return' }] as any,
      });
      expect(await service.isOtsCommit(tx)).toBe(false);
      expect(await service.isOtsCommit(tx)).toBe(false);
      expect(api.isOtsCommit$).toHaveBeenCalledTimes(1);

      // Advance past the 60s TTL.
      jest.advanceTimersByTime(60_001);
      expect(await service.isOtsCommit(tx)).toBe(false);
      expect(api.isOtsCommit$).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  // ---- (5) graceful degradation on probe failure ----

  it('returns false (without caching) when the backend probe errors', async () => {
    api.isOtsCommit$.mockReturnValue(throwError(() => new Error('network down')));
    const tx = makeTx({
      isOtsCommit: undefined,
      vout: [{ scriptpubkey_type: 'op_return' }] as any,
    });
    const first = await service.isOtsCommit(tx);
    expect(first).toBe(false);

    // The failure was NOT cached, so a second call retries.
    api.isOtsCommit$.mockReturnValue(of({ result: true }));
    const second = await service.isOtsCommit(tx);
    expect(second).toBe(true);
    expect(api.isOtsCommit$).toHaveBeenCalledTimes(2);
  });

  // ---- (6) explicit txid-only entry point ----

  it('isOtsCommitByTxid hits the backend directly, no OP_RETURN check', async () => {
    api.isOtsCommit$.mockReturnValue(of({ result: true }));
    const result = await service.isOtsCommitByTxid('c'.repeat(64));
    expect(result).toBe(true);
    expect(api.isOtsCommit$).toHaveBeenCalledWith('c'.repeat(64));
  });

  it('clearCache wipes both true and false entries', async () => {
    api.isOtsCommit$.mockReturnValue(of({ result: true }));
    await service.isOtsCommitByTxid('d'.repeat(64));
    expect(api.isOtsCommit$).toHaveBeenCalledTimes(1);

    service.clearCache();
    await service.isOtsCommitByTxid('d'.repeat(64));
    expect(api.isOtsCommit$).toHaveBeenCalledTimes(2);
  });
});
