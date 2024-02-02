import { ECPair } from 'ecpair';

/**
 * Determines the minimum UTXO size based on the Bitcoin address type.
 * Supports both mainnet and testnet address prefixes.

 * Supported address types and their minimum UTXO sizes are as follows:
 * - P2PKH (mainnet '1', testnet 'm' or 'n'): 546 satoshis
 * - P2SH-P2WPKH (mainnet '3', testnet '2'): 540 satoshis
 * - P2WPKH (mainnet 'bc1q', testnet 'tb1q'): 294 satoshis
 * - P2TR (mainnet 'bc1p', testnet 'tb1p'): 330 satoshis
 *
 * see: https://help.magiceden.io/en/articles/8665399-navigating-bitcoin-dust-understanding-limits-and-safeguarding-your-transactions-on-magic-eden
 * see: https://en.bitcoin.it/wiki/List_of_address_prefixes
 *
 * @param address - The Bitcoin address to evaluate.
 * @returns The minimum number of satoshis that must be held by a UTXO of the given address type.
 * @throws Throws an error if the address type is unsupported.
 */
export function getMinimumUtxoSize(address: string): number {
  // Mainnet addresses
  if (address.startsWith('1')) return 546; // P2PKH
  if (address.startsWith('3')) return 540; // P2SH-P2WPKH
  if (address.startsWith('bc1q')) return 294; // P2WPKH
  if (address.startsWith('bc1p')) return 330; // P2TR

  // Testnet addresses
  if (address.startsWith('m') || address.startsWith('n')) return 546; // P2PKH testnet
  if (address.startsWith('2')) return 540; // P2SH-P2WPKH testnet
  if (address.startsWith('tb1q')) return 294; // P2WPKH testnet
  if (address.startsWith('tb1p')) return 330; // P2TR testnet

  throw new Error('Unsupported address type');
}

export const mainnetDummyWIF = 'KxCSQWapwKCk9Fpw5bcrxSPCuyUsfftGC6XNZM5Pj1pYSPg84nTZ';
export const testnetDummyWIF = 'cUC2eyuM58vaFZTnbbSorJdPBYh62Fe5wULjGshZctNU1irRGVns';

/**
 * Gets a hardoced keypair
 */
export function createRandomPrivateKey(isMainnet: boolean): ECPairInterface {

  const keyPair1 = ECPair.fromWIF(isMainnet ?
  );
  return ecPair.makeRandom({ network });
}
