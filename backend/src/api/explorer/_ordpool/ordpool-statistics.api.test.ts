import OrdpoolStatisticsApi from './ordpool-statistics.api';
import DB from '../../../database';

jest.mock('../../../database', () => ({
  query: jest.fn(),
}));

jest.mock('../../../logger', () => ({
  err: jest.fn(),
}));

describe('OrdpoolStatisticsApi', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('getOrdpoolStatistics', () => {
    it('should call the correct query for mints', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ cat21Mints: 5, inscriptionMints: 10 }]]);

      const result = await OrdpoolStatisticsApi.getOrdpoolStatistics('mints', '1h', 'block');

      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_cat21_mint)'));
      expect(result).toEqual([{ cat21Mints: 5, inscriptionMints: 10 }]);
    });

    it('should call the correct query for new tokens', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ runeEtchings: 3, brc20Deploys: 7 }]]);

      const result = await OrdpoolStatisticsApi.getOrdpoolStatistics('new-tokens', '1d', 'hour');

      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_rune_etch)'));
      expect(result).toEqual([{ runeEtchings: 3, brc20Deploys: 7 }]);
    });

    it('should call the correct query for fees', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ feesRuneMints: 1000, feesBrc20Mints: 2000 }]]);

      const result = await OrdpoolStatisticsApi.getOrdpoolStatistics('fees', '1m', 'day');

      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.fees_rune_mints)'));
      expect(result).toEqual([{ feesRuneMints: 1000, feesBrc20Mints: 2000 }]);
    });

    it('should call the correct query for inscription sizes', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ totalEnvelopeSize: 5000 }]]);

      const result = await OrdpoolStatisticsApi.getOrdpoolStatistics('inscription-sizes', '6m', 'day');

      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.inscriptions_total_envelope_size)'));
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('MAX(bos.inscriptions_largest_envelope_size)'));

      expect(result).toEqual([{ totalEnvelopeSize: 5000 }]);
    });

    it('should apply interval filtering', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ cat21Mints: 5, inscriptionMints: 10 }]]);

      const result = await OrdpoolStatisticsApi.getOrdpoolStatistics('mints', '1w', 'day');

      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL 1 WEEK)'));
      expect(result).toEqual([{ cat21Mints: 5, inscriptionMints: 10 }]);
    });

    it('should throw an error if the query fails', async () => {
      (DB.query as jest.Mock).mockRejectedValueOnce(new Error('Query error'));

      await expect(
        OrdpoolStatisticsApi.getOrdpoolStatistics('mints', '1h', 'block')
      ).rejects.toThrow('Query error');
    });

    it('should generate a valid full SQL query', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ cat21Mints: 5, inscriptionMints: 10 }]]);

      await OrdpoolStatisticsApi.getOrdpoolStatistics('mints', '1y', 'day');

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('AS cat21Mints')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('AS inscriptionMints')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM blocks b')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN blocks_ordpool_stats bos ON b.hash = bos.hash')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE b.height >=')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('AND b.blockTimestamp >= DATE_SUB(NOW(), INTERVAL 1 YEAR)')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('GROUP BY YEAR(b.blockTimestamp), MONTH(b.blockTimestamp), DAY(b.blockTimestamp)')
      );

      expect(DB.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY b.blockTimestamp DESC')
      );
    });
  });
});
