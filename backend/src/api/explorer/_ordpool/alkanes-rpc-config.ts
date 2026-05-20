import * as fs from 'fs';
import * as path from 'path';
import logger from '../../../logger';

export interface AlkanesRpcConfig {
  readonly urls: readonly string[];
  readonly timeoutMs: number;
  readonly negativeCacheMs: number;
}

interface AlkanesRpcConfigFile {
  urls?: string[];
  timeoutMs?: number;
  negativeCacheMs?: number;
}

const FALLBACK: AlkanesRpcConfig = Object.freeze({
  urls: Object.freeze([
    'https://mainnet.subfrost.io/v4/jsonrpc',
    'https://mainnet.sandshrew.io/v2/lasereyes',
  ]),
  timeoutMs: 8_000,
  negativeCacheMs: 60 * 60 * 1000,
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
      urls: Object.freeze(urls),
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
