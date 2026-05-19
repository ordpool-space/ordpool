import * as fs from 'fs';
import * as path from 'path';
import logger from '../../../logger';

/**
 * Failover list of public Alkanes JSON-RPC endpoints. Read by
 * AlkanesMetadataService; the first endpoint that responds with valid
 * JSON-RPC wins, the rest are tried in order on failure. Empty array
 * disables outbound RPC entirely (cached rows still served).
 */
export interface AlkanesRpcConfig {
  urls: string[];
  timeoutMs: number;            // per-RPC-call timeout
  negativeCacheMs: number;      // how long to keep retrying after a failed lookup
}

interface AlkanesRpcConfigFile {
  urls?: string[];
  timeoutMs?: number;
  negativeCacheMs?: number;
}

// Both endpoints are anonymous, free, JSON-RPC 2.0. They appear to share
// upstream infra (same block-tip responses), but failing over to the second
// costs nothing and protects against per-host outages.
const FALLBACK: AlkanesRpcConfig = Object.freeze({
  urls: Object.freeze([
    'https://mainnet.subfrost.io/v4/jsonrpc',
    'https://mainnet.sandshrew.io/v2/lasereyes',
  ]) as unknown as string[],
  timeoutMs: 8_000,
  negativeCacheMs: 60 * 60 * 1000, // 1h
});

let cached: AlkanesRpcConfig | null = null;

function load(): AlkanesRpcConfig {
  if (cached) return cached;
  const filePath = path.join(__dirname, 'alkanes-rpc.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as AlkanesRpcConfigFile;
    const urls = Array.isArray(parsed.urls)
      ? parsed.urls.map(u => String(u).replace(/\/+$/, '')).filter(u => /^https?:\/\//.test(u))
      : [...FALLBACK.urls];
    cached = Object.freeze({
      urls,
      timeoutMs: typeof parsed.timeoutMs === 'number' && parsed.timeoutMs > 0
        ? parsed.timeoutMs : FALLBACK.timeoutMs,
      negativeCacheMs: typeof parsed.negativeCacheMs === 'number' && parsed.negativeCacheMs >= 0
        ? parsed.negativeCacheMs : FALLBACK.negativeCacheMs,
    });
    return cached;
  } catch (e) {
    logger.warn(`Alkanes RPC config: ${e instanceof Error ? e.message : e}; using fallback`);
    cached = FALLBACK;
    return cached;
  }
}

export function getAlkanesRpcConfig(): AlkanesRpcConfig {
  return load();
}
