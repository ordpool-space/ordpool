// HACK -- Ordpool absolute URL: route every API + WebSocket call to our own backend on the
// happysrv.de Cloudflare Tunnel. Mirrors cat21's pattern (cat21.space SPA → backend2.cat21.space).
// Without this, the SPA hits its own domain (`ordpool.space/api/...`) which is Cloudflare Pages
// and serves no API. See workspace CLAUDE.md "How ordpool serves inscription content" + "Hacks
// history" sections for the full rationale.
export const environment = {
  production: true,
  nativeAssetId: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
  nativeTestAssetId: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
  enableInscriptionAccelerator: true,
  enableCat21Mint: true,
  ordBaseUrl: 'https://explorer.ordinalsbot.com',
  ordBaseUrlTestnet: 'https://testnet-explorer.ordinalsbot.com',
  cat21BaseUrl: 'https://backend2.cat21.space',
  // HACK -- Ordpool absolute URL
  apiBaseUrl: 'https://api.ordpool.space',
  websocketBaseUrl: 'wss://api.ordpool.space',
};
