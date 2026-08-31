// Local "cloudflared" for the central regtest stack (workspace-root regtest/).
//
// This dev-server proxy replays the PROD edge routing so `ng serve -c regtest`
// behaves like ordpool.space does in production, but against the local
// regtest Docker backends. In prod two layers cooperate:
//
//   1. Cloudflare Pages _redirects (frontend/src/_redirects): the SPA's
//      same-origin paths (/content, /preview, /api, /r, ...) are 301'd to
//      api.ordpool.space / ordinals.com.
//   2. Cloudflared tunnel (deploy-happyserver/cloudflared/config.yml):
//      api.ordpool.space -> 127.0.0.1:8999 (ordpool-backend, which itself
//      proxies /api/* to electrs).
//
// Here both collapse into ONE proxy: the browser only ever talks same-origin
// to ng-serve, and ng-serve fans out to the Docker services. The frontend
// keeps environment.ts unchanged (apiBaseUrl='' relative, websocketBaseUrl=''
// relative, cat21BaseUrl='http://localhost:3333' -> the cat21-indexer backend,
// which the regtest stack binds at :3333 to match the tunnel target).
//
// /content, /preview and /r MUST stay relative (workspace CLAUDE.md HARD RULE:
// inscriptions reference each other via same-origin paths), which is exactly
// why they are resolved here at the proxy instead of made absolute.

const BACKEND = 'http://127.0.0.1:8999'; // ordpool-backend (= api.ordpool.space)

console.log('** USING PROXY_CONFIG FROM proxy.conf.regtest.js (regtest stack) ***');

module.exports = [
  {
    // mempool REST + the WebSocket at /api/v1/ws. ws:true carries the upgrade.
    context: ['/api/v1/**'],
    target: BACKEND,
    ws: true,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    // electrs / esplora, served through the backend's own /api/* middleware
    // (its "cheap nginx replacement"), exactly like prod api.ordpool.space.
    context: ['/api/**'],
    target: BACKEND,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    // inscription content + previews, rendered by the backend SSR handler.
    context: ['/content/**', '/preview/**', '/stamp-content/**', '/atomical-content/**'],
    target: BACKEND,
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
  {
    // recursive inscriptions + plain-text block recursion endpoints: external,
    // same as the prod _redirects (regtest ord indexes cats only, not these).
    context: ['/r/**', '/blockheight', '/blockhash', '/blockhash/**', '/blocktime'],
    target: 'https://ordinals.com',
    secure: false,
    changeOrigin: true,
    proxyTimeout: 30000,
  },
];
