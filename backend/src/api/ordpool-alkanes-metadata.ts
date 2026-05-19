import logger from '../logger';
import AlkaneMetadataRepository, { AlkaneMetadataRow } from '../repositories/AlkaneMetadataRepository';
import { getAlkanesRpcConfig } from './explorer/_ordpool/alkanes-rpc-config';

// Standard fungible-token selectors per alkanes-std-fungible. Non-fungibles
// won't respond meaningfully; we degrade to NULL name/symbol/supply.
const SELECTOR_NAME = 99;
const SELECTOR_SYMBOL = 100;
const SELECTOR_TOTAL_SUPPLY = 101;

const U32_MAX = 4294967295;

interface SimulateResult {
  execution?: {
    data?: string;       // 0x-prefixed hex, LE bytes
    error?: string | null;
  };
}

class AlkanesMetadataService {

  /**
   * Returns the metadata row for an alkane, fetching from RPC on first access
   * (or after the negative-cache window has expired) and caching to the DB.
   * Returns null when alkaneId is invalid.
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

    const { urls } = getAlkanesRpcConfig();
    if (urls.length === 0) {
      return existing ?? null;
    }

    const fetched = await this.$fetchFromRpcs(block, tx);

    const row: Omit<AlkaneMetadataRow, 'fetchedAt'> = {
      alkaneId,
      name: fetched.name,
      symbol: fetched.symbol,
      totalSupply: fetched.totalSupply,
      lastError: fetched.error ?? null,
      fetchAttempts: (existing?.fetchAttempts ?? 0) + 1,
    };
    await AlkaneMetadataRepository.$upsert(row);
    return await AlkaneMetadataRepository.$getByAlkaneId(alkaneId);
  }

  private isRowFresh(row: AlkaneMetadataRow): boolean {
    // Resolved (got at least a name) is cached forever; immutable for
    // the contract's lifetime.
    if (row.name !== null) {
      return true;
    }
    // Negative cache: retry after the configured window.
    const { negativeCacheMs } = getAlkanesRpcConfig();
    const age = Date.now() - row.fetchedAt.getTime();
    return age < negativeCacheMs;
  }

  /**
   * Try each configured RPC URL in order. First URL that returns a name
   * (even if symbol/totalSupply fail) wins. Returns aggregated metadata
   * or an `error` when every URL failed.
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
          this.$callSimulate(url, block, tx, SELECTOR_NAME),
          this.$callSimulate(url, block, tx, SELECTOR_SYMBOL),
          this.$callSimulate(url, block, tx, SELECTOR_TOTAL_SUPPLY),
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
   * Single JSON-RPC alkanes_simulate call. Returns a string (for name /
   * symbol) or bigint (for total_supply / decimals). Throws on network /
   * timeout / non-2xx / parse error.
   */
  private async $callSimulate(
    url: string, block: bigint, tx: bigint, selector: number,
  ): Promise<string | bigint | null> {
    const { timeoutMs } = getAlkanesRpcConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
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
      });
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
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Decode the `data` field from an alkanes_simulate response. String
 * getters (name, symbol) return ASCII bytes; integer getters return
 * little-endian u128.
 */
export function decodeSimulateData(hex: string, selector: number): string | bigint | null {
  if (hex === '0x' || hex.length < 4) {
    return null;
  }
  const body = hex.slice(2);
  if (selector === SELECTOR_NAME || selector === SELECTOR_SYMBOL) {
    // ASCII bytes; strip trailing nulls (padding artefact)
    let chars = '';
    for (let i = 0; i < body.length; i += 2) {
      const byte = parseInt(body.substr(i, 2), 16);
      if (byte === 0) break;
      if (byte < 0x20 || byte > 0x7e) return null;
      chars += String.fromCharCode(byte);
    }
    return chars.length > 0 ? chars : null;
  }
  // Numeric: little-endian bigint (up to 16 bytes for u128)
  let value = 0n;
  for (let i = body.length - 2; i >= 0; i -= 2) {
    value = (value << 8n) | BigInt(parseInt(body.substr(i, 2), 16));
  }
  return value;
}

export default new AlkanesMetadataService();
