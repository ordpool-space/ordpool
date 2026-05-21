import {
  ALKANE_SELECTOR_NAME,
  ALKANE_SELECTOR_SYMBOL,
  ALKANE_SELECTOR_TOTAL_SUPPLY,
  hexToBytes,
  littleEndianBytesToBigInt,
} from 'ordpool-parser';
import AlkaneMetadataRepository, { AlkaneMetadataRow } from '../repositories/AlkaneMetadataRepository';
import { getAlkanesRpcConfig } from './explorer/_ordpool/alkanes-rpc-config';
import { fetchWithTimeout } from './ordpool-fetch';

interface SimulateResult {
  execution?: {
    data?: string;       // 0x-prefixed hex, LE bytes
    error?: string | null;
  };
}

class AlkanesMetadataService {

  // In-flight dedupe: a thundering herd on the same uncached alkaneId fires
  // one RPC fanout, not N. Resolved promises are removed in the .finally().
  private pending = new Map<string, Promise<AlkaneMetadataRow | null>>();

  /**
   * Returns the metadata row for an alkane, fetching from RPC on first access
   * (or after the negative-cache window has expired) and caching to the DB.
   * Returns null when the alkaneId is invalid.
   */
  async $getAlkaneMetadata(block: bigint, tx: bigint): Promise<AlkaneMetadataRow | null> {
    if (block < 0n || tx < 0n) {
      return null;
    }
    const alkaneId = `${block}:${tx}`;

    const existing = await AlkaneMetadataRepository.$getByAlkaneId(alkaneId);
    if (existing && this.isRowFresh(existing)) {
      return existing;
    }

    const inflight = this.pending.get(alkaneId);
    if (inflight) {
      return inflight;
    }

    const promise = this.$resolveAlkane(alkaneId, block, tx, existing)
      .finally(() => this.pending.delete(alkaneId));
    this.pending.set(alkaneId, promise);
    return promise;
  }

  private async $resolveAlkane(
    alkaneId: string, block: bigint, tx: bigint, existing: AlkaneMetadataRow | null,
  ): Promise<AlkaneMetadataRow | null> {
    const { urls } = getAlkanesRpcConfig();
    if (urls.length === 0) {
      return existing ?? null;
    }

    const fetched = await this.$fetchFromRpcs(block, tx);
    const fetchedAt = new Date();

    const row: AlkaneMetadataRow = {
      alkaneId,
      name: fetched.name,
      symbol: fetched.symbol,
      totalSupply: fetched.totalSupply,
      lastError: fetched.error ?? null,
      fetchAttempts: (existing?.fetchAttempts ?? 0) + 1,
      fetchedAt,
    };
    await AlkaneMetadataRepository.$upsert(row);
    return row;
  }

  private isRowFresh(row: AlkaneMetadataRow): boolean {
    // Resolved rows are immutable: name/symbol never change on-chain.
    if (row.name !== null) {
      return true;
    }
    // Negative cache: retry after the configured window has elapsed.
    const { negativeCacheMs } = getAlkanesRpcConfig();
    return Date.now() - row.fetchedAt.getTime() < negativeCacheMs;
  }

  /**
   * Try each configured RPC URL in order. The first URL that returns a
   * name (even if symbol/totalSupply fail) wins. Returns aggregated
   * metadata, or `{ error }` when every URL failed.
   */
  private async $fetchFromRpcs(block: bigint, tx: bigint): Promise<{
    name: string | null;
    symbol: string | null;
    totalSupply: string | null;
    error?: string;
  }> {
    const { urls } = getAlkanesRpcConfig();
    const errors: string[] = [];

    for (const url of urls) {
      try {
        // Three selectors in parallel against the same URL. If `name`
        // succeeds, we accept this URL's result even if symbol/supply
        // fail (many non-fungibles still expose `name`).
        const [name, symbol, totalSupply] = await Promise.all([
          this.$callSimulate(url, block, tx, ALKANE_SELECTOR_NAME),
          this.$callSimulate(url, block, tx, ALKANE_SELECTOR_SYMBOL),
          this.$callSimulate(url, block, tx, ALKANE_SELECTOR_TOTAL_SUPPLY),
        ]);
        if (typeof name === 'string' && name.length > 0) {
          return {
            name,
            symbol: typeof symbol === 'string' && symbol.length > 0 ? symbol : null,
            totalSupply: typeof totalSupply === 'bigint' ? totalSupply.toString() : null,
          };
        }
        errors.push(`${url}: no name returned`);
      } catch (e) {
        errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      name: null,
      symbol: null,
      totalSupply: null,
      error: errors.join(' | ').slice(0, 250),
    };
  }

  /**
   * Single JSON-RPC `alkanes_simulate` call. Returns a string (for name /
   * symbol) or bigint (for total_supply). Throws on network / timeout /
   * non-2xx / parse error.
   */
  private async $callSimulate(
    url: string, block: bigint, tx: bigint, selector: number,
  ): Promise<string | bigint | null> {
    const { timeoutMs } = getAlkanesRpcConfig();
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: selector,
        method: 'alkanes_simulate',
        params: [{
          target: { block: block.toString(), tx: tx.toString() },
          alkanes: [],
          transaction: '0x',
          block: '0x',
          height: '20000',
          txindex: 0,
          inputs: [selector.toString()],
          pointer: 0,
          refundPointer: 0,
          vout: 0,
        }],
      }),
    }, timeoutMs);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const json: { result?: SimulateResult; error?: { message?: string } } = await resp.json();
    if (json.error) {
      throw new Error(`rpc: ${json.error.message ?? 'unknown'}`);
    }
    const data = json.result?.execution?.data;
    if (typeof data !== 'string' || !data.startsWith('0x')) {
      return null;
    }
    return decodeSimulateData(data, selector);
  }
}

/**
 * Decode the `data` field from an `alkanes_simulate` response. String
 * getters (name, symbol) return ASCII bytes; integer getters return
 * little-endian u128 as a bigint.
 */
export function decodeSimulateData(hex: string, selector: number): string | bigint | null {
  if (hex === '0x' || hex.length < 4) {
    return null;
  }
  const bytes = hexToBytes(hex.slice(2));
  if (selector === ALKANE_SELECTOR_NAME || selector === ALKANE_SELECTOR_SYMBOL) {
    // ASCII bytes; stop at the first NUL (the contract pads with zeros).
    let chars = '';
    for (const byte of bytes) {
      if (byte === 0) break;
      if (byte < 0x20 || byte > 0x7e) return null;
      chars += String.fromCharCode(byte);
    }
    return chars.length > 0 ? chars : null;
  }
  // Numeric: little-endian bigint (up to 16 bytes for u128).
  return littleEndianBytesToBigInt(bytes);
}

export default new AlkanesMetadataService();
