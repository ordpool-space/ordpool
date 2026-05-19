# alkanes testdata

Raw JSON-RPC responses captured from the two public alkanes endpoints
the backend talks to (`mainnet.subfrost.io` and `mainnet.sandshrew.io`).
Same convention as `ordpool-parser/testdata/`: real on-chain bytes only,
no synthetic fixtures, refetchable via a single script.

## Refresh

```bash
cd ordpool/backend
npm run fetch-alkanes-testdata
```

Hits both endpoints for every (alkane, selector) combination listed in
`fetch-alkanes-testdata.js` and pretty-prints the response into
`testdata/alkanes/<alkane>/<selector>_<endpoint>.json`. Existing files
are overwritten. The two endpoints must return identical
`result.execution.data` for the same on-chain query — the test suite
asserts this.

## Adding a new fixture

1. Pick a real alkane that exercises behaviour the existing fixtures
   don't cover (e.g. a contract that responds to `name()` but not
   `symbol()`, a contract with a very long name, an alkane in a
   different block than `2`).
2. Add an entry to the `FIXTURES` array in `fetch-alkanes-testdata.js`.
3. Run `npm run fetch-alkanes-testdata`.
4. Add real-data assertions in
   `src/api/ordpool-alkanes-metadata.test.ts` — one block per alkane,
   one `it()` per selector, exact byte and decoded-value match.
5. Visually inspect the new JSON files before committing.

## Why both endpoints

`backend/src/api/explorer/_ordpool/alkanes-rpc-config.ts` lists subfrost
first and sandshrew as fallback. The fixtures pin that both gateways
expose the same JSON-RPC 2.0 envelope and the same per-alkane bytes —
if either drifts, the test suite catches it before production does.
