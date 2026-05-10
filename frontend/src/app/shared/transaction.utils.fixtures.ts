/* eslint-disable */
// Real-mainnet Counterparty tx (mpma -- multi-party multi-asset send).
// Block 948,817, txid 4a412b0a71439ad5eaf5f8a91878f8cf7c895037bc6b59ba93fd3d954eb4788e.
// Three 1-of-3 bare-multisig outputs encoding the encrypted CNTRPRTY message,
// plus a p2pkh change output. The parser must classify this as a Counterparty
// artifact and OR the ordpool_counterparty flag (bit 55) into the result.
//
// This fixture is the regression-trigger for "frontend getTransactionFlags
// doesn't run the parser". The bug surfaced when the
// digital-artifact-viewer was missing a Counterparty case AND the chip was
// missing because the analyser was never invoked on the tx-detail page.
// See https://ordpool.space/tx/4a412b0a...4788e for the live render.
export const COUNTERPARTY_MPMA_TX: any = {
  txid: '4a412b0a71439ad5eaf5f8a91878f8cf7c895037bc6b59ba93fd3d954eb4788e',
  version: 1,
  locktime: 0,
  vin: [{
    txid: '8b9c8f1b6fcbdb103255314957f3744f9ff3ebc759fc3d4139beb278c35c9f1c',
    vout: 1,
    prevout: {
      scriptpubkey: '76a91483b6241a78354ae6ad241a9695e3888191347c3f88ac',
      scriptpubkey_asm: 'OP_DUP OP_HASH160 OP_PUSHBYTES_20 83b6241a78354ae6ad241a9695e3888191347c3f OP_EQUALVERIFY OP_CHECKSIG',
      scriptpubkey_type: 'p2pkh',
      scriptpubkey_address: '1D1RiWbmikELv1P2hfWKguWuQMZ1Siws5g',
      value: 20486,
    },
    scriptsig: '4830450221009f03b2512d65922dad70ea38b0ecf4b9795d86731c9593fbef094c49d9ab894902200e2eed1d4065c304d838b09ebd6d3f1979db1509f824f5b2a87d351a46737e3901210378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb',
    scriptsig_asm: 'OP_PUSHBYTES_72 30450221009f03b2512d65922dad70ea38b0ecf4b9795d86731c9593fbef094c49d9ab894902200e2eed1d4065c304d838b09ebd6d3f1979db1509f824f5b2a87d351a46737e3901 OP_PUSHBYTES_33 0378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb',
    is_coinbase: false,
    sequence: 4294967295,
  }],
  vout: [
    {
      scriptpubkey: '512102aeae1912b08f011a062af2a1b5246aa8cd22ed2c5c04ac5c5f61d2714f354eb52103ef95c3bca32b96ba26776fba1a184ef26c9709ddbea15e044a03e4abe4dbcae1210378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb53ae',
      scriptpubkey_asm: 'OP_PUSHNUM_1 OP_PUSHBYTES_33 02aeae1912b08f011a062af2a1b5246aa8cd22ed2c5c04ac5c5f61d2714f354eb5 OP_PUSHBYTES_33 03ef95c3bca32b96ba26776fba1a184ef26c9709ddbea15e044a03e4abe4dbcae1 OP_PUSHBYTES_33 0378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb OP_PUSHNUM_3 OP_CHECKMULTISIG',
      scriptpubkey_type: 'multisig',
      value: 1000,
    },
    {
      scriptpubkey: '512102aeae1912b08f011a0629f2a0a1784c4b6813a6585e1cbe12ef22d496a37c03d42103cf27e2ddbc089a80f2abefba1a190ef26c9d360946e63f3861e094abe4db9a4d210378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb53ae',
      scriptpubkey_asm: 'OP_PUSHNUM_1 OP_PUSHBYTES_33 02aeae1912b08f011a0629f2a0a1784c4b6813a6585e1cbe12ef22d496a37c03d4 OP_PUSHBYTES_33 03cf27e2ddbc089a80f2abefba1a190ef26c9d360946e63f3861e094abe4db9a4d OP_PUSHBYTES_33 0378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb OP_PUSHNUM_3 OP_CHECKMULTISIG',
      scriptpubkey_type: 'multisig',
      value: 1000,
    },
    {
      scriptpubkey: '5121028bae1912b08f011a0629f2e368ab7f1e8ca10a768a1cbe12ff22d496a67c03c72103cf3b83bba8789a80f2abefba1a184ef26c9759ddc766bf3861e094abe4dbca62210378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb53ae',
      scriptpubkey_asm: 'OP_PUSHNUM_1 OP_PUSHBYTES_33 028bae1912b08f011a0629f2e368ab7f1e8ca10a768a1cbe12ff22d496a67c03c7 OP_PUSHBYTES_33 03cf3b83bba8789a80f2abefba1a184ef26c9759ddc766bf3861e094abe4dbca62 OP_PUSHBYTES_33 0378b853908eb411fb14c8374a38bbfffd81643d63b12f284ad4a04c7c0f3db0fb OP_PUSHNUM_3 OP_CHECKMULTISIG',
      scriptpubkey_type: 'multisig',
      value: 1000,
    },
    {
      scriptpubkey: '76a91483b6241a78354ae6ad241a9695e3888191347c3f88ac',
      scriptpubkey_asm: 'OP_DUP OP_HASH160 OP_PUSHBYTES_20 83b6241a78354ae6ad241a9695e3888191347c3f OP_EQUALVERIFY OP_CHECKSIG',
      scriptpubkey_type: 'p2pkh',
      scriptpubkey_address: '1D1RiWbmikELv1P2hfWKguWuQMZ1Siws5g',
      value: 16286,
    },
  ],
  size: 534,
  weight: 2136,
  sigops: 244,
  fee: 1200,
  status: {
    confirmed: true,
    block_height: 948817,
    block_hash: '000000000000000000015161015df87a22f9240e9ab392b2e2dce9b0acb05556',
    block_time: 1778438338,
  },
};

// Minimal plain p2pkh tx with no ordpool data. Used as the negative case --
// after getTransactionFlags returns, none of the ordpool_* bits (range 48-81)
// should be set.
export const PLAIN_P2PKH_TX: any = {
  txid: '0000000000000000000000000000000000000000000000000000000000000001',
  version: 2,
  locktime: 0,
  vin: [{
    txid: '0000000000000000000000000000000000000000000000000000000000000000',
    vout: 0,
    prevout: {
      scriptpubkey: '76a91400112233445566778899aabbccddeeff0011223388ac',
      scriptpubkey_asm: 'OP_DUP OP_HASH160 OP_PUSHBYTES_20 00112233445566778899aabbccddeeff00112233 OP_EQUALVERIFY OP_CHECKSIG',
      scriptpubkey_type: 'p2pkh',
      scriptpubkey_address: '1111111111111111111114oLvT2',
      value: 100000,
    },
    scriptsig: '',
    scriptsig_asm: '',
    is_coinbase: false,
    sequence: 4294967295,
  }],
  vout: [{
    scriptpubkey: '76a91400112233445566778899aabbccddeeff0011223388ac',
    scriptpubkey_asm: 'OP_DUP OP_HASH160 OP_PUSHBYTES_20 00112233445566778899aabbccddeeff00112233 OP_EQUALVERIFY OP_CHECKSIG',
    scriptpubkey_type: 'p2pkh',
    scriptpubkey_address: '1111111111111111111114oLvT2',
    value: 99000,
  }],
  size: 200,
  weight: 800,
  sigops: 4,
  fee: 1000,
  status: { confirmed: true, block_height: 948000, block_hash: 'aa'.repeat(32), block_time: 1778000000 },
};
