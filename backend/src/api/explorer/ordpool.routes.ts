import { Application, Request, Response } from 'express';

import config from '../../config';
import ordpoolStatisticsApi, { Aggregation, Interval } from './ordpool-statistics.api';
import ordpoolInscriptionsApi from './ordpool-inscriptions.api';

class GeneralOrdpoolRoutes {

  public initRoutes(app: Application): void {
    app
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/statistics/:interval/:aggregation', this.$getOrdpoolStatistics)
      .get('/content/:inscriptionId', this.$getInscription)
      ;
  }

  // '1h' | 2h | '24h | '3d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '4y'
  // 'block' | 'hour' | 'day'

  // HACK -- Ordpool Stats
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/24h/block
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/3d/block
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/1y/block
  //
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/24h/hour
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/3d/hour
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/1y/hour
  //
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/24h/day
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/3d/day
  // http://127.0.0.1:8999/api/v1/ordpool/statistics/1y/day
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


  // Test cases
  // SVG with gzip: http://127.0.0.1:8999/content/4c83f2e1d12d6f71e9f69159aff48f7946ce04c5ffcc3a3feee4080bac343722i0
  // Delegate: http://127.0.0.1:8999/content/6b6f65ba4bc2cbb8cec1e1ca5e1d426e442a05729cdbac6009cca185f7d95babi0
  // Complex SVG with JavaScript (only works when rendered server-side): http://127.0.0.1:8999/content/77709919918d38c8a89761e3cd300d22ef312948044217327f54e62cc01b47a0i0
  private async $getInscription(req: Request, res: Response): Promise<void> {
    const inscriptionId = req.params.inscriptionId;
    return $getInscriptionRecursive(res, inscriptionId);
  }
}

async function $getInscriptionRecursive(res: Response, inscriptionId: string | undefined, recursiveLevel = 0): Promise<void> {

  // prevent endless loops via circular delegates
  if (recursiveLevel > 4) {
    res.status(400).send('Too many delegate levels. Stopping.');
    return;
  }

  if (!inscriptionId) {
    res.status(400).send('Inscription ID is required.');
    return;
  }

  try {

    const inscription = await ordpoolInscriptionsApi.$getInscriptionById(inscriptionId);

    if (!inscription) {
      res.status(404).send('Transaction or inscription not found.');
      return;
    }

    const delegates = inscription.getDelegates();
    if (delegates.length) {
      return $getInscriptionRecursive(res, delegates[0], recursiveLevel + 1);
    }

    const contentType = inscription.contentType;
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    } else {
      res.status(400).send('No content type available. Can\'t display inscription.');
      return;
    }

    const contentEncoding = inscription.getContentEncoding();
    if (contentEncoding) {
      res.setHeader('Content-Encoding', contentEncoding);
    }

    res.setHeader('Content-Length', inscription.contentSize);

    // Send the raw data
    res.status(200).send(Buffer.from(inscription.getDataRaw()));

  } catch (error) {
    res.status(500).send('Internal server error: ' + error);
  }
}

export default new GeneralOrdpoolRoutes();
