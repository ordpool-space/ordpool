import config from '../../config';
import { Application, Request, Response } from 'express';
import ordpoolStatisticsApi, { Aggregation, Interval } from './ordpool-statistics.api';

class GeneralOrdpoolRoutes {

  public initRoutes(app: Application): void {
    app
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/statistics/:interval/:aggregation', this.$getOrdpoolStatistics)
    ;
  }

  // '1h' | 2h | '24h | '3d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '4y'
  // 'block' | 'hour' | 'day'

  // HACK -- Ordpool Stats
  // http://localhost:4200/api/v1/ordpool/statistics/24h/block
  // http://localhost:4200/api/v1/ordpool/statistics/3d/block
  // http://localhost:4200/api/v1/ordpool/statistics/1y/block
  //
  // http://localhost:4200/api/v1/ordpool/statistics/24h/hour
  // http://localhost:4200/api/v1/ordpool/statistics/3d/hour
  // http://localhost:4200/api/v1/ordpool/statistics/1y/hour
  //
  // http://localhost:4200/api/v1/ordpool/statistics/24h/day
  // http://localhost:4200/api/v1/ordpool/statistics/3d/day
  // http://localhost:4200/api/v1/ordpool/statistics/1y/day
  private async $getOrdpoolStatistics(req: Request, res: Response): Promise<void> {
    try {

      const interval = req.params.interval as Interval;
      const aggregation = req.params.aggregation as Aggregation;

      const statistics = await ordpoolStatisticsApi.$getOrdpoolStatistics(interval, aggregation);

      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(statistics);
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : e);
    }
  }
}

export default new GeneralOrdpoolRoutes();
