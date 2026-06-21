// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  nativeAssetId: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
  nativeTestAssetId: '144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49',
  // Ord JSON-API upstreams tried in order. On any failure (5xx, network,
  // CORS, etc.) the client walks down the list and tries the next entry.
  // First success wins. Add more entries here as we bring more instances
  // online.
  ordBaseUrls: [
    'https://ord.ordpool.space',
    'https://explorer.ordinalsbot.com',
  ],
  // Testnet has its own list. We don't run a testnet ord instance, so
  // this is single-upstream for now.
  ordBaseUrlsTestnet: [
    'https://testnet-explorer.ordinalsbot.com',
  ],
  cat21BaseUrl: 'http://localhost:3333',
  // HACK -- Ordpool absolute URL: empty in dev so the Angular dev proxy
  // (proxy.conf.local-esplora.js) handles /api/* + /api/v1/ws routing.
  apiBaseUrl: '',
  websocketBaseUrl: '',
  // Gate for routes / debug hooks that exist only to support Playwright
  // E2E. Dev = true (e2e route resolves, window.__bitmap3d is exposed).
  // Prod = false (route + hook are dead code, tree-shaken).
  testHooks: true,
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
