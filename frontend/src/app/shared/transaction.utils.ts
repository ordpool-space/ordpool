import { TransactionFlags } from './filters.utils';
import { getVarIntLength, opcodes, parseMultisigScript, isPoint } from './script.utils';
import { Transaction } from '../interfaces/electrs.interface';
import { CpfpInfo, RbfInfo } from '../interfaces/node-api.interface';
import { AtomicalParserService, Cat21ParserService, InscriptionParserService, RuneParserService, Src20ParserService } from 'ordpool-parser';

// Bitcoin Core default policy settings
const TX_MAX_STANDARD_VERSION = 2;
const MAX_STANDARD_TX_WEIGHT = 400_000;
const MAX_BLOCK_SIGOPS_COST = 80_000;
const MAX_STANDARD_TX_SIGOPS_COST = (MAX_BLOCK_SIGOPS_COST / 5);
const MIN_STANDARD_TX_NONWITNESS_SIZE = 65;
const MAX_P2SH_SIGOPS = 15;
const MAX_STANDARD_P2WSH_STACK_ITEMS = 100;
const MAX_STANDARD_P2WSH_STACK_ITEM_SIZE = 80;
const MAX_STANDARD_TAPSCRIPT_STACK_ITEM_SIZE = 80;
const MAX_STANDARD_P2WSH_SCRIPT_SIZE = 3600;
const MAX_STANDARD_SCRIPTSIG_SIZE = 1650;
const DUST_RELAY_TX_FEE = 3;
const MAX_OP_RETURN_RELAY = 83;
const DEFAULT_PERMIT_BAREMULTISIG = true;

export function countScriptSigops(script: string, isRawScript: boolean = false, witness: boolean = false): number {
  if (!script?.length) {
    return 0;
  }

  let sigops = 0;
  // count OP_CHECKSIG and OP_CHECKSIGVERIFY
  sigops += (script.match(/OP_CHECKSIG/g)?.length || 0);

  // count OP_CHECKMULTISIG and OP_CHECKMULTISIGVERIFY
  if (isRawScript) {
    // in scriptPubKey or scriptSig, always worth 20
    sigops += 20 * (script.match(/OP_CHECKMULTISIG/g)?.length || 0);
  } else {
    // in redeem scripts and witnesses, worth N if preceded by OP_N, 20 otherwise
    const matches = script.matchAll(/(?:OP_(?:PUSHNUM_)?(\d+))? OP_CHECKMULTISIG/g);
    for (const match of matches) {
      const n = parseInt(match[1]);
      if (Number.isInteger(n)) {
        sigops += n;
      } else {
        sigops += 20;
      }
    }
  }

  return witness ? sigops : (sigops * 4);
}

export function setSchnorrSighashFlags(flags: bigint, witness: string[]): bigint {
  // no witness items
  if (!witness?.length) {
    return flags;
  }
  const hasAnnex = witness.length > 1 && witness[witness.length - 1].startsWith('50');
  if (witness?.length === (hasAnnex ? 2 : 1)) {
    // keypath spend, signature is the only witness item
    if (witness[0].length === 130) {
      flags |= setSighashFlags(flags, witness[0]);
    } else {
      flags |= TransactionFlags.sighash_default;
    }
  } else {
    // scriptpath spend, all items except for the script, control block and annex could be signatures
    for (let i = 0; i < witness.length - (hasAnnex ? 3 : 2); i++) {
      // handle probable signatures
      if (witness[i].length === 130) {
        flags |= setSighashFlags(flags, witness[i]);
      } else if (witness[i].length === 128) {
        flags |= TransactionFlags.sighash_default;
      }
    }
  }
  return flags;
}

export function isDERSig(w: string): boolean {
  // heuristic to detect probable DER signatures
  return (w.length >= 18
    && w.startsWith('30') // minimum DER signature length is 8 bytes + sighash flag (see https://mempool.space/testnet/tx/c6c232a36395fa338da458b86ff1327395a9afc28c5d2daa4273e410089fd433)
    && ['01', '02', '03', '81', '82', '83'].includes(w.slice(-2)) // signature must end with a valid sighash flag
    && (w.length === (2 * parseInt(w.slice(2, 4), 16)) + 6) // second byte encodes the combined length of the R and S components
  );
}

/**
 * Validates most standardness rules
 *
 * returns true early if any standardness rule is violated, otherwise false
 * (except for non-mandatory-script-verify-flag and p2sh script evaluation rules which are *not* enforced)
 */
export function isNonStandard(tx: Transaction): boolean {
  // version
  if (tx.version > TX_MAX_STANDARD_VERSION) {
    return true;
  }

  // tx-size
  if (tx.weight > MAX_STANDARD_TX_WEIGHT) {
    return true;
  }

  // tx-size-small
  if (getNonWitnessSize(tx) < MIN_STANDARD_TX_NONWITNESS_SIZE) {
    return true;
  }

  // bad-txns-too-many-sigops
  if (tx.sigops && tx.sigops > MAX_STANDARD_TX_SIGOPS_COST) {
    return true;
  }

  // input validation
  for (const vin of tx.vin) {
    if (vin.is_coinbase) {
      // standardness rules don't apply to coinbase transactions
      return false;
    }
    // scriptsig-size
    if ((vin.scriptsig.length / 2) > MAX_STANDARD_SCRIPTSIG_SIZE) {
      return true;
    }
    // scriptsig-not-pushonly
    if (vin.scriptsig_asm) {
      for (const op of vin.scriptsig_asm.split(' ')) {
        if (opcodes[op] && opcodes[op] > opcodes['OP_16']) {
          return true;
        }
      }
    }
    // bad-txns-nonstandard-inputs
    if (vin.prevout?.scriptpubkey_type === 'p2sh') {
      // TODO: evaluate script (https://github.com/bitcoin/bitcoin/blob/1ac627c485a43e50a9a49baddce186ee3ad4daad/src/policy/policy.cpp#L177)
      // countScriptSigops returns the witness-scaled sigops, so divide by 4 before comparison with MAX_P2SH_SIGOPS
      const sigops = (countScriptSigops(vin.inner_redeemscript_asm || '') / 4);
      if (sigops > MAX_P2SH_SIGOPS) {
        return true;
      }
    } else if (['unknown', 'provably_unspendable', 'empty'].includes(vin.prevout?.scriptpubkey_type || '')) {
      return true;
    }
    // TODO: bad-witness-nonstandard
  }

  // output validation
  let opreturnCount = 0;
  for (const vout of tx.vout) {
    // scriptpubkey
    if (['unknown', 'provably_unspendable', 'empty'].includes(vout.scriptpubkey_type)) {
      // (non-standard output type)
      return true;
    } else if (vout.scriptpubkey_type === 'multisig') {
      if (!DEFAULT_PERMIT_BAREMULTISIG) {
        // bare-multisig
        return true;
      }
      const mOfN = parseMultisigScript(vout.scriptpubkey_asm);
      if (!mOfN || mOfN.n < 1 || mOfN.n > 3 || mOfN.m < 1 || mOfN.m > mOfN.n) {
        // (non-standard bare multisig threshold)
        return true;
      }
    } else if (vout.scriptpubkey_type === 'op_return') {
      opreturnCount++;
      if ((vout.scriptpubkey.length / 2) > MAX_OP_RETURN_RELAY) {
        // over default datacarrier limit
        return true;
      }
    }
    // dust
    // (we could probably hardcode this for the different output types...)
    if (vout.scriptpubkey_type !== 'op_return') {
      let dustSize = (vout.scriptpubkey.length / 2);
      // add varint length overhead
      dustSize += getVarIntLength(dustSize);
      // add value size
      dustSize += 8;
      if (['v0_p2wpkh', 'v0_p2wsh', 'v1_p2tr'].includes(vout.scriptpubkey_type)) {
        dustSize += 67;
      } else {
        dustSize += 148;
      }
      if (vout.value < (dustSize * DUST_RELAY_TX_FEE)) {
        // under minimum output size
        return true;
      }
    }
  }

  // multi-op-return
  if (opreturnCount > 1) {
    return true;
  }

  // TODO: non-mandatory-script-verify-flag

  return false;
}

export function getNonWitnessSize(tx: Transaction): number {
  let weight = tx.weight;
  let hasWitness = false;
  for (const vin of tx.vin) {
    if (vin.witness?.length) {
      hasWitness = true;
      // witness count
      weight -= getVarIntLength(vin.witness.length);
      for (const witness of vin.witness) {
        // witness item size + content
        weight -= getVarIntLength(witness.length / 2) + (witness.length / 2);
      }
    }
  }
  if (hasWitness) {
    // marker & segwit flag
    weight -= 2;
  }
  return Math.ceil(weight / 4);
}

export function setSegwitSighashFlags(flags: bigint, witness: string[]): bigint {
  for (const w of witness) {
    if (isDERSig(w)) {
      flags |= setSighashFlags(flags, w);
    }
  }
  return flags;
}

export function setLegacySighashFlags(flags: bigint, scriptsig_asm: string): bigint {
  for (const item of scriptsig_asm.split(' ')) {
    // skip op_codes
    if (item.startsWith('OP_')) {
      continue;
    }
    // check pushed data
    if (isDERSig(item)) {
      flags |= setSighashFlags(flags, item);
    }
  }
  return flags;
}

export function setSighashFlags(flags: bigint, signature: string): bigint {
  switch(signature.slice(-2)) {
    case '01': return flags | TransactionFlags.sighash_all;
    case '02': return flags | TransactionFlags.sighash_none;
    case '03': return flags | TransactionFlags.sighash_single;
    case '81': return flags | TransactionFlags.sighash_all | TransactionFlags.sighash_acp;
    case '82': return flags | TransactionFlags.sighash_none | TransactionFlags.sighash_acp;
    case '83': return flags | TransactionFlags.sighash_single | TransactionFlags.sighash_acp;
    default: return flags | TransactionFlags.sighash_default; // taproot only
  }
}

export function isBurnKey(pubkey: string): boolean {
  return [
    '022222222222222222222222222222222222222222222222222222222222222222',
    '033333333333333333333333333333333333333333333333333333333333333333',
    '020202020202020202020202020202020202020202020202020202020202020202',
    '030303030303030303030303030303030303030303030303030303030303030303',
  ].includes(pubkey);
}

  // HACK - WARNING
  // THIS METHOD was just duplicated between frontend/backend and is super redundant!
  // nearly the same code exists in backend/src/api/common.ts
export function getTransactionFlags(tx: Transaction, cpfpInfo?: CpfpInfo, replacement?: boolean): bigint {
  let flags = tx.flags ? BigInt(tx.flags) : 0n;

  // Update variable flags (CPFP, RBF)
  if (cpfpInfo) {
    if (cpfpInfo.ancestors.length) {
      flags |= TransactionFlags.cpfp_child;
    }
    if (cpfpInfo.descendants?.length) {
      flags |= TransactionFlags.cpfp_parent;
    }
  }
  if (replacement) {
    flags |= TransactionFlags.replacement;
  }

  // Already processed static flags, no need to do it again
  if (tx.flags) {
    return flags;
  }

  // Process static flags
  if (tx.version === 1) {
    flags |= TransactionFlags.v1;
  } else if (tx.version === 2) {
    flags |= TransactionFlags.v2;
  } else if (tx.version === 3) {
    flags |= TransactionFlags.v3;
  }
  const reusedInputAddresses: { [address: string ]: number } = {};
  const reusedOutputAddresses: { [address: string ]: number } = {};
  const inValues = {};
  const outValues = {};
  let rbf = false;
  for (const vin of tx.vin) {
    if (vin.sequence < 0xfffffffe) {
      rbf = true;
    }
    switch (vin.prevout?.scriptpubkey_type) {
      case 'p2pk': flags |= TransactionFlags.p2pk; break;
      case 'multisig': flags |= TransactionFlags.p2ms; break;
      case 'p2pkh': flags |= TransactionFlags.p2pkh; break;
      case 'p2sh': flags |= TransactionFlags.p2sh; break;
      case 'v0_p2wpkh': flags |= TransactionFlags.p2wpkh; break;
      case 'v0_p2wsh': flags |= TransactionFlags.p2wsh; break;
      case 'v1_p2tr': {
        if (!vin.witness?.length) {
          throw new Error('Taproot input missing witness data');
        }
        flags |= TransactionFlags.p2tr;
        // in taproot, if the last witness item begins with 0x50, it's an annex
        const hasAnnex = vin.witness?.[vin.witness.length - 1].startsWith('50');
        // script spends have more than one witness item, not counting the annex (if present)
        if (vin.witness.length > (hasAnnex ? 2 : 1)) {
          // the script itself is the second-to-last witness item, not counting the annex
          const asm = vin.inner_witnessscript_asm;
          // inscriptions smuggle data within an 'OP_0 OP_IF ... OP_ENDIF' envelope
          if (asm?.includes('OP_0 OP_IF')) {
            flags |= TransactionFlags.inscription;
          }
        }
      } break;
    }

    // sighash flags
    if (vin.prevout?.scriptpubkey_type === 'v1_p2tr') {
      flags |= setSchnorrSighashFlags(flags, vin.witness);
    } else if (vin.witness) {
      flags |= setSegwitSighashFlags(flags, vin.witness);
    } else if (vin.scriptsig?.length) {
      flags |= setLegacySighashFlags(flags, vin.scriptsig_asm);
    }

    if (vin.prevout?.scriptpubkey_address) {
      reusedInputAddresses[vin.prevout?.scriptpubkey_address] = (reusedInputAddresses[vin.prevout?.scriptpubkey_address] || 0) + 1;
    }
    inValues[vin.prevout?.value || Math.random()] = (inValues[vin.prevout?.value || Math.random()] || 0) + 1;
  }
  if (rbf) {
    flags |= TransactionFlags.rbf;
  } else {
    flags |= TransactionFlags.no_rbf;
  }
  let hasFakePubkey = false;
  let P2WSHCount = 0;
  let olgaSize = 0;
  for (const vout of tx.vout) {
    switch (vout.scriptpubkey_type) {
      case 'p2pk': {
        flags |= TransactionFlags.p2pk;
        // detect fake pubkey (i.e. not a valid DER point on the secp256k1 curve)
        hasFakePubkey = hasFakePubkey || !isPoint(vout.scriptpubkey?.slice(2, -2));
      } break;
      case 'multisig': {
        flags |= TransactionFlags.p2ms;
        // detect fake pubkeys (i.e. not valid DER points on the secp256k1 curve)
        const asm = vout.scriptpubkey_asm;
        for (const key of (asm?.split(' ') || [])) {
          if (!hasFakePubkey && !key.startsWith('OP_')) {
            hasFakePubkey = hasFakePubkey || isBurnKey(key) || !isPoint(key);
          }
        }
      } break;
      case 'p2pkh': flags |= TransactionFlags.p2pkh; break;
      case 'p2sh': flags |= TransactionFlags.p2sh; break;
      case 'v0_p2wpkh': flags |= TransactionFlags.p2wpkh; break;
      case 'v0_p2wsh': flags |= TransactionFlags.p2wsh; break;
      case 'v1_p2tr': flags |= TransactionFlags.p2tr; break;
      case 'op_return': flags |= TransactionFlags.op_return; break;
    }
    if (vout.scriptpubkey_address) {
      reusedOutputAddresses[vout.scriptpubkey_address] = (reusedOutputAddresses[vout.scriptpubkey_address] || 0) + 1;
    }
    if (vout.scriptpubkey_type === 'v0_p2wsh') {
      if (!P2WSHCount) {
        olgaSize = parseInt(vout.scriptpubkey.slice(4, 8), 16);
      }
      P2WSHCount++;
      if (P2WSHCount === Math.ceil((olgaSize + 2) / 32)) {
        const nullBytes = (P2WSHCount * 32) - olgaSize - 2;
        if (vout.scriptpubkey.endsWith(''.padEnd(nullBytes * 2, '0'))) {
          flags |= TransactionFlags.fake_scripthash;
        }
      }
    } else {
      P2WSHCount = 0;
    }
    outValues[vout.value || Math.random()] = (outValues[vout.value || Math.random()] || 0) + 1;
  }
  if (hasFakePubkey) {
    flags |= TransactionFlags.fake_pubkey;
  }

  // fast but bad heuristic to detect possible coinjoins
  // (at least 5 inputs and 5 outputs, less than half of which are unique amounts, with no address reuse)
  const addressReuse = Object.keys(reusedOutputAddresses).reduce((acc, key) => Math.max(acc, (reusedInputAddresses[key] || 0) + (reusedOutputAddresses[key] || 0)), 0) > 1;
  if (!addressReuse && tx.vin.length >= 5 && tx.vout.length >= 5 && (Object.keys(inValues).length + Object.keys(outValues).length) <= (tx.vin.length + tx.vout.length) / 2 ) {
    flags |= TransactionFlags.coinjoin;
  }
  // more than 5:1 input:output ratio
  if (tx.vin.length / tx.vout.length >= 5) {
    flags |= TransactionFlags.consolidation;
  }
  // less than 1:5 input:output ratio
  if (tx.vin.length / tx.vout.length <= 0.2) {
    flags |= TransactionFlags.batch_payout;
  }

  if (isNonStandard(tx)) {
    flags |= TransactionFlags.nonstandard;
  }

  const debug = false;

  // HACK -- add Ordpool flags
  // keep this in sync with backend/src/api/common.ts
  if (AtomicalParserService.hasAtomical(tx)) {
    flags |= TransactionFlags.ordpool_atomical;
    if (debug) { console.log(tx.txid, 'flagged as atomical'); }
  }

  if (Cat21ParserService.hasCat21(tx)) {
    flags |= TransactionFlags.ordpool_cat21;
    if (debug) { console.log(tx.txid, 'flagged as CAT-21'); }
  }

  if (InscriptionParserService.hasInscription(tx)) {
    flags |= TransactionFlags.ordpool_inscription;
    if (debug) { console.log(tx.txid, 'flagged as inscription'); }
  }

  if (RuneParserService.hasRunestone(tx)) {
    flags |= TransactionFlags.ordpool_rune;
    if (debug) { console.log(tx.txid, 'flagged as runestone'); }
  }

  if (Src20ParserService.hasSrc20(tx)) {
    flags |= TransactionFlags.ordpool_src20;
    if (debug) { console.log(tx.txid, 'flagged as SRC-20'); }
  }


  return flags;
}