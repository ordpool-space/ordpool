const fs = require('fs');

const FRONTEND_CONFIG_FILE_NAME = 'mempool-frontend-config.json';

let configContent;

// Read frontend config
try {
    const rawConfig = fs.readFileSync(FRONTEND_CONFIG_FILE_NAME);
    configContent = JSON.parse(rawConfig);
    console.log(`${FRONTEND_CONFIG_FILE_NAME} file found, using provided config`);
} catch (e) {
    console.log(e);
    if (e.code !== 'ENOENT') {
      throw new Error(e);
  } else {
      console.log(`${FRONTEND_CONFIG_FILE_NAME} file not found, using default config`);
  }
}

console.log('** USING PROXY_CONFIG FROM proxy.conf.local-esplora.js ***');

// HACK -- Ordpool absolute URL: dev mirrors prod's edge routing.
//
// In prod, ordpool.space (Cloudflare Pages) handles same-origin paths via _redirects:
//   /content/*    → api.ordpool.space/content/* 301   (our backend's SSR handler)
//   /preview/*    → api.ordpool.space/preview/* 301   (our backend's SSR handler)
//   /r/*          → ordinals.com/r/*            301   (recursive inscriptions, external)
//   /blockheight  → ordinals.com/blockheight    301   ┐
//   /blockhash    → ordinals.com/blockhash      301   │ backwards-compat plain-text
//   /blockhash/*  → ordinals.com/blockhash/*    301   │ recursion endpoints (see
//   /blocktime    → ordinals.com/blocktime      301   ┘ docs.ordinals.com/inscriptions/recursion.html)
// while the frontend hits api.ordpool.space directly via absolute URLs (environment.apiBaseUrl)
// for everything else (/api/v1/*, WebSocket, etc.).
//
// Explicit paths for the block recursion endpoints, NOT /block* — the SPA owns /block/<height>.
//
// In dev we don't run Pages locally, so this proxy reproduces ONLY the same-origin redirects.
// The /api/v1/* + /api/* + /api/v1/services/* rules from upstream mempool are intentionally
// dropped: the frontend's services use environment.apiBaseUrl='http://localhost:8999' (and
// equivalents) and hit the local backend / electrs directly, the same way prod hits the tunnel.
//
// Inscription protocol constraint (see workspace CLAUDE.md "HARD RULE: /content/, /preview/, /r/
// MUST stay relative"): inscriptions reference each other via same-origin paths, so we cannot
// rewrite these into absolute URLs in the frontend. They must stay relative and be resolved at
// the edge (or here in dev) into whoever actually serves them.
let PROXY_CONFIG = [
  {
    context: ['/content/**'],
    target: 'http://127.0.0.1:8999',
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000
  },
  {
    context: ['/preview/**'],
    target: 'http://127.0.0.1:8999',
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000
  },
  {
    context: ['/r/**', '/blockheight', '/blockhash', '/blockhash/**', '/blocktime'],
    target: 'https://ordinals.com',
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000
  }
];

console.log(PROXY_CONFIG);

module.exports = PROXY_CONFIG;
