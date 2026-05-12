const baseModule = Cypress.env('BASE_MODULE');

/*
End-to-end check for the OTS badge on the tx-detail page.

Wire contract: the backend's `GET /api/v1/tx/:txId` attaches
`isOtsCommit: true | false | null` (see ORDPOOL-FLAGS-ARCHITECTURE.md §4).
The frontend's `OtsKnowledgeService.isOtsCommit(tx)` trusts the field;
`getTransactionFlags` OR's `ordpool_ots` into `tx.flags`; the filter
chip with label "OpenTimestamps" renders.

This spec stubs the upstream `/api/tx/:txid` response with
`isOtsCommit: true` and asserts the badge appears on cold load. (We
intentionally don't depend on the live OTS poller or a real on-chain
OTS-commit txid -- the contract under test is the wire-fill -> badge
chain, not the poller's correctness.)
*/

// A made-up but well-shaped txid; the intercept doesn't care if it
// exists on chain.
const FAKE_OTS_TXID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Minimal-but-valid tx body. The frontend's tx-detail page consumes
// every field listed here in some branch; missing fields cause
// secondary rendering failures that mask the OTS-badge assertion.
function makeOtsTxFixture(isOtsCommit: boolean): object {
  return {
    txid: FAKE_OTS_TXID,
    version: 2,
    locktime: 0,
    size: 200,
    weight: 800,
    fee: 1000,
    vin: [
      {
        txid: 'a'.repeat(64),
        vout: 0,
        prevout: {
          scriptpubkey: '00' + '11'.repeat(20),
          scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20 ' + '11'.repeat(20),
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q' + 'a'.repeat(38),
          value: 100000,
        },
        scriptsig: '',
        scriptsig_asm: '',
        witness: [],
        is_coinbase: false,
        sequence: 0xfffffffd,
      },
    ],
    vout: [
      {
        // The OP_RETURN that makes a tx OTS-eligible by structure
        // (calendars publish their Merkle root here).
        scriptpubkey: '6a20' + 'cc'.repeat(32),
        scriptpubkey_asm: 'OP_RETURN OP_PUSHBYTES_32 ' + 'cc'.repeat(32),
        scriptpubkey_type: 'op_return',
        value: 0,
      },
      {
        scriptpubkey: '00' + '22'.repeat(20),
        scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20 ' + '22'.repeat(20),
        scriptpubkey_type: 'v0_p2wpkh',
        scriptpubkey_address: 'bc1q' + 'b'.repeat(38),
        value: 99000,
      },
    ],
    status: {
      confirmed: true,
      block_height: 900000,
      block_hash: 'b'.repeat(64),
      block_time: 1735000000,
    },
    // The load-bearing field for this spec.
    isOtsCommit,
  };
}

describe('Tx detail page — OpenTimestamps badge from isOtsCommit', () => {

  if (baseModule !== 'mempool') {
    it.skip(`Tests cannot be run on the selected BASE_MODULE ${baseModule}`, () => undefined);
    return;
  }

  it('shows the OpenTimestamps badge when the API returns isOtsCommit=true', () => {
    cy.intercept('GET', `**/api/tx/${FAKE_OTS_TXID}`, makeOtsTxFixture(true)).as('getTx');

    cy.visit(`/tx/${FAKE_OTS_TXID}`);
    cy.waitForSkeletonGone();
    cy.wait('@getTx');

    // The filter chip renders the localized label "OpenTimestamps" from
    // frontend/src/app/shared/filters.utils.ts:132. The chip is the
    // observable proof that ordpool_ots is set on tx.flags.
    cy.contains('OpenTimestamps').should('be.visible');
  });

  it('does NOT show the OpenTimestamps badge when the API returns isOtsCommit=false', () => {
    cy.intercept('GET', `**/api/tx/${FAKE_OTS_TXID}`, makeOtsTxFixture(false)).as('getTx');

    cy.visit(`/tx/${FAKE_OTS_TXID}`);
    cy.waitForSkeletonGone();
    cy.wait('@getTx');

    // Negative case: the chip MUST be absent. (cy.contains times out
    // and fails if anything matches.)
    cy.contains('OpenTimestamps').should('not.exist');
  });
});
