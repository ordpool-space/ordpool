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
4. Add the new alkane to the `FIXTURES` constant in
   `src/api/ordpool-alkanes-metadata.test.ts` with the expected name
   and symbol (both immutable contract state).
5. Cross-check name + symbol against an independent explorer (e.g.
   open the `cross_check_url` in a browser). Don't trust your own
   ASCII-from-hex conversion — that's the whole reason we hit a second
   source.

## Why both endpoints

`backend/src/api/explorer/_ordpool/alkanes-rpc-config.ts` lists subfrost
first and sandshrew as fallback. The fixtures pin that both gateways
expose the same JSON-RPC 2.0 envelope and the same per-alkane bytes —
if either drifts, the test suite catches it before production does.

## How `totalSupply` is verified

Names and symbols are immutable per-contract state — they're asserted
as exact string literals against a human-verified expected value.

`totalSupply()`, on the other hand, **changes on every mint**. Hardcoding
its decoded integer into the test would mean every refetch breaks the
suite once mints land on-chain. So the test asserts a weaker invariant:

  our hand-rolled BigInt-loop decoder must match `Buffer.readBigUInt64LE`
  (Node's stdlib, separately implemented from ours) split into low + high
  u64s and recombined.

If both decoders agree on the same 16-byte LE payload, the value is
verified by an independent implementation — no hand-computed number sits
in the test. The reference decoder itself has a small `reference decoder
sanity` block pinning it against known fixed-width values
(`0x01...` → 1, `0x...01000000000000` → 2^64, etc.).
