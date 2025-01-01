import { BlockExtended } from '../mempool.interfaces';
import { mapCat21MintsToMinimal } from './OrdpoolBlocksRepository.helper';

describe('mapCat21MintsToMinimal', () => {
  it('should map Cat21Mint[] to MinimalCat21Mint[] and set cat21MintActivity to undefined', () => {
    const blocks = [
      {
        id: 1,
        height: 123,
        extras: {
          ordpoolStats: {
            cat21: {
              cat21MintActivity: [
                { transactionId: 'tx1', fee: 1000, weight: 400 },
                { transactionId: 'tx2', fee: 2000, weight: 600 },
              ],
              minimalCat21MintActivity: undefined,
            },
          },
        },
      },
    ] as any as BlockExtended[];

    const result = mapCat21MintsToMinimal(blocks);

    expect(result).toEqual([
      {
        id: 1,
        height: 123,
        extras: {
          ordpoolStats: {
            cat21: {
              cat21MintActivity: undefined,
              minimalCat21MintActivity: [
                { transactionId: 'tx1', fee: 1000, weight: 400 },
                { transactionId: 'tx2', fee: 2000, weight: 600 },
              ],
            },
          },
        },
      },
    ]);
  });

  it('should handle blocks with undefined cat21MintActivity gracefully', () => {
    const blocks = [
      {
        id: 1,
        height: 123,
        extras: {
          ordpoolStats: {
            cat21: {
              cat21MintActivity: undefined,
              minimalCat21MintActivity: undefined,
            },
          },
        },
      },
    ]as any as BlockExtended[];

    const result = mapCat21MintsToMinimal(blocks);

    expect(result).toEqual([
      {
        id: 1,
        height: 123,
        extras: {
          ordpoolStats: {
            cat21: {
              cat21MintActivity: undefined,
              minimalCat21MintActivity: [],
            },
          },
        },
      },
    ]);
  });
});
