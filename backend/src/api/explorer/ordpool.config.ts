
// see https://github.com/ordinals/ord/blob/b6ac024cc10954742f10da87615442f205fb7f55/src/chain.rs#L36
export function getFirstInscriptionHeight(network: string): number {
  switch (network) {
    case 'mainnet': return 767430;
    case 'signet': return 112402;
    case 'testnet': return 2413343;
    default: return 0;
  }
}
