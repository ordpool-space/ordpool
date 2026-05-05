import { Application, Request, Response } from 'express';
import { InscriptionPreviewService, ParsedInscription, PreviewInstructions } from 'ordpool-parser';

import config from '../../../config';
import OrdpoolMissingStats from '../../ordpool-missing-stats';
import ordpoolSkippedBlocksRepository from '../../../repositories/OrdpoolSkippedBlocksRepository';
import ordpoolInscriptionsApi from './ordpool-inscriptions.api';
import { Aggregation, ChartType, Interval } from './ordpool-statistics-interface';
import ordpoolStatisticsApi from './ordpool-statistics.api';

/** If the indexer hasn't recorded a per-block success in this many minutes,
 *  the /internal/indexer-progress endpoint returns 503 and the heartbeat
 *  script (deploy-happyserver/scripts/healthcheck-ping.sh) skips its OK ping,
 *  triggering a Healthchecks.io grace-expiry alert. */
const MAX_LAG_MINUTES = 30;

class GeneralOrdpoolRoutes {

  public initRoutes(app: Application): void {
    app
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/statistics/:type/:interval/:aggregation', this.$getOrdpoolStatistics)
      .get(config.MEMPOOL.API_URL_PREFIX + 'internal/indexer-progress', this.$getIndexerProgress)
      .get('/content/:inscriptionId', this.getInscriptionContent)
      .get('/preview/:inscriptionId', this.getInscriptionPreview);
  }

  /**
   * Internal liveness endpoint. Returns 200 with the indexer's last-success
   * timestamp + skipped-block count when the indexer is making progress
   * (lag < MAX_LAG_MINUTES). Returns 503 when stale. Localhost-only — the
   * cloudflared tunnel forwards /api/v1/* but production access from the
   * outside is rejected here, since this endpoint exposes internal state.
   */
  private async $getIndexerProgress(req: Request, res: Response): Promise<void> {
    const remote = req.ip || req.socket.remoteAddress || '';
    const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLocal) {
      res.status(403).send('Forbidden');
      return;
    }

    try {
      const lastSuccessAt = OrdpoolMissingStats.getLastSuccessAt();
      const skippedCount = await ordpoolSkippedBlocksRepository.getSkippedCount();

      const lagMs = lastSuccessAt === null ? null : Date.now() - lastSuccessAt.getTime();
      const lagMinutes = lagMs === null ? null : Math.round(lagMs / 60000);
      const fresh = lagMs !== null && lagMs <= MAX_LAG_MINUTES * 60 * 1000;

      res.setHeader('Cache-Control', 'no-store');
      res.status(fresh ? 200 : 503).json({
        ok: fresh,
        lastSuccessAt: lastSuccessAt === null ? null : lastSuccessAt.toISOString(),
        lagMinutes,
        maxLagMinutes: MAX_LAG_MINUTES,
        skippedCount,
      });
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : String(e));
    }
  }

  // '1h' | 2h | '24h | '3d' | '1w' | '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '4y'
  // 'block' | 'hour' | 'day'

  // HACK -- Ordpool Stats
  // https://ordpool.space/api/v1/ordpool/statistics/mints/24h/block
  // https://ordpool.space/api/v1/ordpool/statistics/mints/3d/block
  // https://ordpool.space/api/v1/ordpool/statistics/mints/1y/block
  //
  // https://ordpool.space/api/v1/ordpool/statistics/mints/24h/hour
  // https://ordpool.space/api/v1/ordpool/statistics/mints/3d/hour
  // https://ordpool.space/api/v1/ordpool/statistics/mints/1y/hour
  //
  // https://ordpool.space/api/v1/ordpool/statistics/mints/24h/day
  // https://ordpool.space/api/v1/ordpool/statistics/mints/3d/day
  // https://ordpool.space/api/v1/ordpool/statistics/mints/1y/day
  private async $getOrdpoolStatistics(req: Request, res: Response): Promise<void> {
    try {

      const type = req.params.type as ChartType;
      const interval = req.params.interval as Interval;
      const aggregation = req.params.aggregation as Aggregation;

      const statistics = await ordpoolStatisticsApi.getOrdpoolStatistics(type, interval, aggregation);

      res.header('Pragma', 'public');
      res.header('Cache-control', 'public');
      res.setHeader('Expires', new Date(Date.now() + 1000 * 60).toUTCString());
      res.json(statistics);
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : e);
    }
  }

  // Test cases
  // SVG with gzip: https://ordpool.space/content/4c83f2e1d12d6f71e9f69159aff48f7946ce04c5ffcc3a3feee4080bac343722i0
  // Delegate: https://ordpool.space/content/6b6f65ba4bc2cbb8cec1e1ca5e1d426e442a05729cdbac6009cca185f7d95babi0
  // Complex SVG with JavaScript (only works when rendered server-side): https://ordpool.space/content/77709919918d38c8a89761e3cd300d22ef312948044217327f54e62cc01b47a0i0
  private async getInscriptionContent(req: Request, res: Response): Promise<void> {
    const inscriptionId = req.params.inscriptionId;

    if (!inscriptionId) {
      res.status(400).send('Inscription ID is required.');
      return;
    }

    try {

      const inscription = await ordpoolInscriptionsApi.$getInscriptionOrDelegeate(inscriptionId);

      if (!inscription) {
        res.status(404).send('Transaction or inscription not found.');
        return;
      }

      sendInscription(res, inscription);

    } catch (error) {
      res.status(500).send('Internal server error: ' + error);
    }
  }

  // Test cases
  // Direct Render (Iframe mode): https://ordpool.space/preview/751007cf3090703f241894af5c057fc8850d650a577a800447d4f21f5d2cecdei0
  // Audio: https://ordpool.space/preview/ad99172fce60028406f62725b91b5c508edd95bf21310de5afeb0966ddd89be3i0
  // Image: https://ordpool.space/preview/6fb976ab49dcec017f1e201e84395983204ae1a7c2abf7ced0a85d692e442799i0
  // Markdown: https://ordpool.space/preview/c133c03e2ed44bb8ada79b1640b6649129de75a8f31d8e6ad573ede442f91cdbi0
  // Model: https://ordpool.space/preview/25013a3ab212e0ca5b3ccbd858ff988f506b77080c51963c948c055028af2051i0
  // Pdf: https://ordpool.space/preview/85b10531435304cbe47d268106b58b57a4416c76573d4b50fa544432597ad670i0i0
  // Pure Text: https://ordpool.space/preview/430901147831e41111aced3895ee4b9742cf72ac3cffa132624bd38c551ef379i0
  // Text, but JSON: https://ordpool.space/preview/b84deb50dcee499351e62bbbdcc9b306f8ac36aefc3fc1f1c5ede2bfa7164501i0
  // Text, but CODE: https://ordpool.space/preview/6dc2c16a74dedcae46300b2058ebadc7ca78aea78236459662375c8d7d9804dbi0
  // Unknown: https://ordpool.space/preview/06158001c0be9d375c10a56266d8028b80ebe1ef5e2a9c9a4904dbe31b72e01ci0
  // Video: https://ordpool.space/preview/700f348e1acef6021cdee8bf09e4183d6a3f4d573b4dc5585defd54009a0148ci0
  private async getInscriptionPreview(req: Request, res: Response): Promise<void> {
    const inscriptionId = req.params.inscriptionId;

    if (!inscriptionId) {
      res.status(400).send('Inscription ID is required.');
      return;
    }

    try {

      const inscription = await ordpoolInscriptionsApi.$getInscriptionOrDelegeate(inscriptionId);

      if (!inscription) {
        res.status(404).send('Transaction or inscription not found.');
        return;
      }

      const previewInstructions = await InscriptionPreviewService.getPreview(inscription);
      if (previewInstructions.renderDirectly) {
        sendInscription(res, inscription);
      } else {
        sendPreview(res, previewInstructions);
      }

    } catch (error) {
      res.status(500).send('Internal server error: ' + error);
    }
  }
}


function sendInscription(res: Response, inscription: ParsedInscription): void {

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
}

function sendPreview(res: Response, previewInstructions: PreviewInstructions): void {

  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  res.setHeader('Content-Length', previewInstructions.previewContent.length);

  // Send the preview HTML
  res.status(200).send(previewInstructions.previewContent);
}

export default new GeneralOrdpoolRoutes();
