import { BlockExtended } from '../mempool.interfaces';

/**
 * Maps an array of BlockExtended and converts OrdpoolStats.cat21.cat21MintActivity
 * (Cat21Mint[]) to OrdpoolStats.cat21.minimalCat21MintActivity (MinimalCat21Mint[]),
 * setting cat21MintActivity to undefined.
 *
 * @param blocks - Array of BlockExtended to process.
 * @returns A new array of BlockExtended with updated OrdpoolStats.
 */
export function mapCat21MintsToMinimal(blocks: BlockExtended[]): BlockExtended[] {

  return blocks.map(block => {

    if (!block.extras.ordpoolStats) {
      return block;
    }

    const cat21MintActivity = block.extras.ordpoolStats.cat21.cat21MintActivity;

    // Map Cat21Mint[] to MinimalCat21Mint[]
    const minimalCat21MintActivity = cat21MintActivity
      ? cat21MintActivity.map(mint => ({
          transactionId: mint.transactionId,
          fee: mint.fee,
          weight: mint.weight,
        }))
      : [];

    // Return the updated block
    return {
      ...block,
      extras: {
        ...block.extras,
        ordpoolStats: {
          ...block.extras.ordpoolStats,
          cat21: {
            ...block.extras.ordpoolStats.cat21,
            minimalCat21MintActivity,
            cat21MintActivity: undefined
          },
        },
      },
    };
  });
}
