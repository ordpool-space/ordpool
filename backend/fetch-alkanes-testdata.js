// Refetches the alkanes RPC fixtures used by
// src/api/ordpool-alkanes-metadata.test.ts. Same procedure as the
// ordpool-parser fetch-tx-testdata.js script: hit a public endpoint,
// pretty-print the JSON, save under testdata/ next to the test.
//
// Run: `node fetch-alkanes-testdata.js`
// Output: testdata/alkanes/<alkane>/<selector>_<endpoint>.json

const fs   = require('fs');
const path = require('path');

const ENDPOINTS = {
  subfrost:  'https://mainnet.subfrost.io/v4/jsonrpc',
  sandshrew: 'https://mainnet.sandshrew.io/v2/lasereyes',
};

// Each fixture pins one real alkane against the three standard
// fungible-token selectors. Pick alkanes that exercise different
// shapes: a canonical fungible (DIESEL), a name with a different
// symbol (FARTUNE100 -> F100), and an NFT-style 1-supply token
// (Alkane Pandas #342).
const FIXTURES = [
  { dir: '2_0_diesel',               target: { block: '2', tx: '0'    } },
  { dir: '2_100_fartune100',         target: { block: '2', tx: '100'  } },
  { dir: '2_1000_alkane_pandas_342', target: { block: '2', tx: '1000' } },
  { dir: '999999_999999_unknown',    target: { block: '999999', tx: '999999' } },
];

const SELECTORS = [
  { id: 99,  label: 'name' },
  { id: 100, label: 'symbol' },
  { id: 101, label: 'total_supply' },
];

const ROOT = path.join(__dirname, 'testdata', 'alkanes');

function post(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then((res) => res.text())
    .then((text) => JSON.parse(text))
    .finally(() => clearTimeout(timer));
}

async function fetchOne(target, selector, endpointUrl, attempts = 3) {
  const body = {
    jsonrpc: '2.0',
    method: 'alkanes_simulate',
    params: [{ target, inputs: [String(selector)] }],
    id: 1,
  };
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await post(endpointUrl, body, 25_000);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function main() {
  for (const fixture of FIXTURES) {
    const fixtureDir = path.join(ROOT, fixture.dir);
    fs.mkdirSync(fixtureDir, { recursive: true });

    for (const selector of SELECTORS) {
      for (const [endpointName, endpointUrl] of Object.entries(ENDPOINTS)) {
        const filename = `${selector.id}_${selector.label}_${endpointName}.json`;
        const filepath = path.join(fixtureDir, filename);
        try {
          const resp = await fetchOne(fixture.target, selector.id, endpointUrl);
          fs.writeFileSync(filepath, JSON.stringify(resp, null, 2) + '\n');
          const data = resp?.result?.execution?.data ?? '<no-data>';
          console.log(`OK   ${fixture.dir}/${filename}  data=${data}`);
        } catch (err) {
          console.error(`FAIL ${fixture.dir}/${filename}  ${err.message}`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
