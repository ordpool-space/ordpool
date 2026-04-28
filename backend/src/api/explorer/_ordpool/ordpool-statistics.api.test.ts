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

    it('should call the correct query for protocols', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ counterparty: 60, stamp: 70, src721: 80, src101: 90 }]]);

      const result = await OrdpoolStatisticsApi.getOrdpoolStatistics('protocols', '1y', 'day');

      // All four protocol-family columns SUMed under their JS names
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_counterparty) AS counterparty'));
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_stamp) AS stamp'));
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_src721) AS src721'));
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_src101) AS src101'));

      expect(result).toEqual([{ counterparty: 60, stamp: 70, src721: 80, src101: 90 }]);
    });

    it('should call the correct query for inscription types', async () => {
      (DB.query as jest.Mock).mockResolvedValueOnce([[{ inscriptionImages: 100, inscriptionTexts: 200, inscriptionJsons: 300 }]]);

      const result = await OrdpoolStatisticsApi.getOrdpoolStatistics('inscription-types', '1m', 'day');

      // The three content-type bucket columns
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_inscription_image) AS inscriptionImages'));
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_inscription_text) AS inscriptionTexts'));
      expect(DB.query).toHaveBeenCalledWith(expect.stringContaining('SUM(bos.amounts_inscription_json) AS inscriptionJsons'));

      expect(result).toEqual([{ inscriptionImages: 100, inscriptionTexts: 200, inscriptionJsons: 300 }]);
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
        expect.stringContaining('LEFT JOIN ordpool_stats bos ON b.hash = bos.hash')
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
