// Not needed anymore, we simply use
// the private key 0101010101010101010101010101010101010101010101010101010101010101
// /**
//  * Creates a random SECP256k1 keypair via the ECC library
//  */
// export function createRandomPrivateKey(isMainnet: boolean): ECPairInterface {
//   const network = isMainnet ? networks.bitcoin : networks.testnet;
//   const ecPair = ECPairFactory(ecc);
//   return ecPair.makeRandom({ network });
// }

// /**
//  * Returns a hardcoded keypair
//  * This keypair should ne NEVER user for real transactions
//  */
// export function getHardcodedPrivateKey(isMainnet: boolean) {
//   const network = isMainnet ? networks.bitcoin : networks.testnet;
//   const mainnetDummyWIF = 'KwFAoPZk4c11vu8xyuBCpCrvHDATU4UofiTY9rARdkoXtZaDcb5k';
//   const testnetDummyWIF = 'cVqWgJgeWP4Bbeso3UtEcocbJ2RcqayQ1RQ9nf2QtQx43kLyz7ac';

//   const ecPair = ECPairFactory(ecc);
//   return ecPair.fromWIF(isMainnet ? mainnetDummyWIF : testnetDummyWIF, network);
// }


// Warning: this key derivation library does not work in the browser!
// npm install ecpair bip32 tiny-secp256k1
// describe('createRandomPrivateKey', () => {

//   it('creates 2 random keys for me that I can hardcode', () => {

//     const pairMainnet = (createRandomPrivateKey(true));
//     const pairTestnet = (createRandomPrivateKey(false));

//     console.log('*** Mainnet WIF ***' , pairMainnet.toWIF());
//     console.log('*** Testnet WIF ***' , pairTestnet.toWIF());
//   });
// });
