import config from '../../config';
import { Application, Request, Response } from 'express';
import ordpoolStatisticsApi from './ordpool-statistics.api';

class GeneralOrdpoolRoutes {

  public initRoutes(app: Application): void {
    app
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/statistics/:interval', this.$getOrdpoolStatistics)
    ;
  }

  // HACK -- Ordpool Stats
  // http://localhost:4200/api/v1/ordpool/statistics/24h
  // http://localhost:4200/api/v1/ordpool/statistics/6m
  // mimics the API of
  // https://mempool.space/api/v1/lightning/statistics/6m
  private async $getOrdpoolStatistics(req: Request, res: Response): Promise<void> {
    try {
      const statistics = await ordpoolStatisticsApi.$getOrdpoolStatistics(req.params.interval);
      const statisticsCount = await ordpoolStatisticsApi.$getOrdpoolStatisticsCount();
      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.header('X-total-count', statisticsCount.toString());
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(statistics);
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : e);
    }
  }
}

export default new GeneralOrdpoolRoutes();
