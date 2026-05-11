import { Application, Request, Response } from 'express';
import { AtomicalFile, getFirstInscriptionHeight, InscriptionPreviewService, isValidTxid, ParsedInscription, ParsedStamp, PreviewInstructions } from 'ordpool-parser';

import config from '../../../config';
import blocks from '../../blocks';
import OrdpoolMissingStats from '../../ordpool-missing-stats';
import ordpoolBlocksRepository from '../../../repositories/OrdpoolBlocksRepository';
import ordpoolOtsRepository from '../../../repositories/OrdpoolOtsRepository';
import ordpoolSkippedBlocksRepository from '../../../repositories/OrdpoolSkippedBlocksRepository';
import ordpoolAtomicalsApi from './ordpool-atomicals.api';
import ordpoolInscriptionsApi from './ordpool-inscriptions.api';
import ordpoolStampsApi from './ordpool-stamps.api';
import { Aggregation, ChartType, Interval } from './ordpool-statistics-interface';
import ordpoolStatisticsApi from './ordpool-statistics.api';
import { getOtsCalendarHosts, getOtsCalendars } from './ots-calendars-config';

/** If the indexer hasn't recorded a per-block success in this many minutes,
 *  /api/v1/health/indexer-progress returns 503 and the heartbeat script
 *  (deploy-happyserver/scripts/healthcheck-ping.sh) skips its OK ping,
 *  triggering a Healthchecks.io grace-expiry alert. */
const MAX_LAG_MINUTES = 30;

class GeneralOrdpoolRoutes {

  public initRoutes(app: Application): void {
    app
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/statistics/:type/:interval/:aggregation', this.$getOrdpoolStatistics)
      .get(config.MEMPOOL.API_URL_PREFIX + 'health/indexer-progress', this.$getIndexerProgress)
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/ots/calendars', this.$getOtsCalendars)
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/ots/recent', this.$getOtsRecent)
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/ots/tx/:txid', this.$getOtsTx)
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/ots/block/:height', this.$getOtsBlock)
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/ots/upgrade/:calendar/:hash', this.$proxyOtsUpgrade)
      .get(config.MEMPOOL.API_URL_PREFIX + 'ordpool/ots/stamp-calendars', this.$getOtsStampCalendars)
      .get('/content/:inscriptionId', this.getInscriptionContent)
      .get('/preview/:inscriptionId', this.getInscriptionPreview)
      .get('/stamp-content/:txid', this.getStampContent)
      .get('/atomical-content/:txid', this.getAtomicalContent);
  }

  /** Per-calendar summary for the /ots/calendars dashboard. */
  // https://ordpool.space/api/v1/ordpool/ots/calendars
  private async $getOtsCalendars(req: Request, res: Response): Promise<void> {
    try {
      const stats = await ordpoolOtsRepository.getCalendarStats();
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json(stats);
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : String(e));
    }
  }

  /** Most-recent confirmed OTS commits across every calendar. */
  // https://ordpool.space/api/v1/ordpool/ots/recent?limit=50
  private async $getOtsRecent(req: Request, res: Response): Promise<void> {
    try {
      const raw = req.query.limit;
      const limit = Math.min(Math.max(parseInt(typeof raw === 'string' ? raw : '50', 10) || 50, 1), 500);
      const rows = await ordpoolOtsRepository.getRecent(limit);
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json(rows);
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Proxy GET /timestamp/<hash> on a public OTS calendar.
   *
   * Why we proxy: the public OTS calendars (alice/bob/finney/...) do not
   * send `Access-Control-Allow-Origin` on their /timestamp/<hash> responses,
   * so the browser cannot read the body when polling for an upgrade. Their
   * /digest POST endpoint DOES allow CORS (when triggered as a "simple"
   * request, see frontend ots-stamp-verify.component.ts), but /timestamp/
   * does not. Server-side proxying side-steps the entire issue.
   *
   * Hostname is whitelisted so we don't accidentally turn into an open
   * proxy. The hash is sanity-checked as a 64-char lower-case hex string.
   *
   * Cache hint: upstream sets max-age=60 for 404s. We mirror that on the
   * 404 path so a tab leaving a long-pending stamp doesn't hammer us.
   */
  // https://ordpool.space/api/v1/ordpool/ots/upgrade/alice.btc.calendar.opentimestamps.org/<hex>
  private async $proxyOtsUpgrade(req: Request, res: Response): Promise<void> {
    const allowed = getOtsCalendarHosts();
    const calendar = String(req.params.calendar || '').toLowerCase();
    const hash = String(req.params.hash || '').toLowerCase();
    if (!allowed.has(calendar)) {
      res.status(400).send('unknown calendar');
      return;
    }
    // Lower-case hex, even length, max 256 hex chars (128 bytes is more than
    // generous for any realistic OTS commitment, which is typically 32-48
    // bytes after the calendar's per-batch suffix bytes).
    if (!/^[0-9a-f]+$/.test(hash) || hash.length % 2 !== 0 || hash.length > 256) {
      res.status(400).send('invalid hash');
      return;
    }
    // 10-second timeout via AbortController -- fetch has no built-in
    // timeout option (the original axios call used `timeout: 10000`).
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10_000);
    try {
      const upstream = await fetch(`https://${calendar}/timestamp/${hash}`, { signal: abort.signal });
      // We always return HTTP 200 from this proxy and distinguish via
      // Content-Type:
      //   200 + application/vnd.opentimestamps.v1 + binary body  -> upgraded
      //   200 + application/json + {"status":"pending"}          -> calendar
      //                                                              hasn't
      //                                                              published
      //                                                              this hash
      //                                                              yet
      // This avoids Chrome's auto-logging "Failed to load resource: 404"
      // every minute for every still-pending stamp -- the response IS
      // expected and successful from our perspective.
      // Upstream 5xx maps to our 502 so genuine errors are visible.
      if (upstream.status === 200) {
        const body = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.setHeader('Content-Type', 'application/vnd.opentimestamps.v1');
        res.status(200).end(body);
      } else if (upstream.status === 404) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('Content-Type', 'application/json');
        res.status(200).end('{"status":"pending"}');
      } else {
        res.setHeader('Cache-Control', 'no-store');
        res.status(502).send(`upstream returned ${upstream.status}`);
      }
    } catch {
      res.status(502).send('upstream error');
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Returns the URI list the frontend Stamp & Verify drop-zone fans out to.
   *
   * Source of truth: backend/src/api/explorer/_ordpool/ots-calendars.json.
   * Edit that file to add or remove a calendar; no code change needed.
   * Cached at the edge for an hour.
   */
  // https://ordpool.space/api/v1/ordpool/ots/stamp-calendars
  private async $getOtsStampCalendars(req: Request, res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ calendars: getOtsCalendars() });
  }

  /** All OTS commits at a given block height. Empty array if none. */
  // https://ordpool.space/api/v1/ordpool/ots/block/948192
  private async $getOtsBlock(req: Request, res: Response): Promise<void> {
    try {
      const heightRaw = req.params.height;
      const height = parseInt(heightRaw, 10);
      if (!Number.isFinite(height) || height < 0 || height > 10_000_000) {
        res.status(400).send('height must be a non-negative integer below 10,000,000');
        return;
      }
      const rows = await ordpoolOtsRepository.getByBlockheight(height);
      // Block-level data is immutable once confirmed, cache hard.
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(rows);
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : String(e));
    }
  }

  /** Single tx lookup. 404 if the txid isn't a known OTS commit. */
  // https://ordpool.space/api/v1/ordpool/ots/tx/8d8ce7ac7b68335a040243f31e7e3a2ba8fb82166ca569e7c8b80361b90e8b9f
  private async $getOtsTx(req: Request, res: Response): Promise<void> {
    try {
      const txid = req.params.txid;
      if (!txid || !/^[0-9a-f]{64}$/i.test(txid)) {
        res.status(400).send('txid must be a 64-char lower-case hex string');
        return;
      }
      const row = await ordpoolOtsRepository.getByTxid(txid.toLowerCase());
      if (!row) {
        res.status(404).send('Not an OpenTimestamps calendar commit (or not yet seen).');
        return;
      }
      // Confirmed rows can cache aggressively (data is immutable once confirmed).
      // Pending rows must not cache because they're about to flip.
      res.setHeader('Cache-Control', row.confirmedAt
        ? 'public, max-age=300'
        : 'no-store');
      res.json(row);
    } catch (e) {
      res.status(500).send(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Public health + progress endpoint. Returns 200 when the missing-stats
   * indexer is making progress (lag <= MAX_LAG_MINUTES), 503 when stale.
   * The body is non-sensitive operational data — safe for the heartbeat
   * script to poll locally, for users to view in the browser, and for the
   * frontend to surface as queue/ETA info on the block detail page and as
   * a lag/skip banner on the Ordpool Stats page.
   *
   * @returns JSON `{ ok, lastSuccessAt, lagMinutes, maxLagMinutes,
   *                  skippedCount, skippedHeights, frontierHeight, tipHeight,
   *                  firstStatsHeight, pendingCount, blocksPerMinute }`.
   */
  private async $getIndexerProgress(req: Request, res: Response): Promise<void> {
    try {
      const firstStatsHeight = getFirstInscriptionHeight(config.MEMPOOL.NETWORK);

      const [skippedCount, skippedHeights, frontierHeight, pendingCount] = await Promise.all([
        ordpoolSkippedBlocksRepository.getSkippedCount(),
        ordpoolSkippedBlocksRepository.getSkippedHeights(),
        ordpoolBlocksRepository.getMaxStatsHeight(),
        ordpoolBlocksRepository.getPendingStatsCount(firstStatsHeight),
      ]);

      const lastSuccessAt = OrdpoolMissingStats.getLastSuccessAt();
      const lagMs = lastSuccessAt === null ? null : Date.now() - lastSuccessAt.getTime();
      const lagMinutes = lagMs === null ? null : Math.round(lagMs / 60000);
      // The indexer is healthy if either it has nothing left to do
      // (pendingCount is 0 — the missing-stats backfill drained), or it
      // recorded a per-block save within MAX_LAG_MINUTES. Without the
      // pendingCount short-circuit we'd start returning 503 ~30 min after
      // backfill completes: lastSuccessAt is set only by the missing-stats
      // batch save, the live-block ingest path doesn't touch it, so a
      // fully-caught-up indexer would look stalled.
      const caughtUp = pendingCount === 0;
      const fresh = caughtUp || (lagMs !== null && lagMs <= MAX_LAG_MINUTES * 60 * 1000);

      res.setHeader('Cache-Control', 'no-store');
      res.status(fresh ? 200 : 503).json({
        ok: fresh,
        lastSuccessAt: lastSuccessAt === null ? null : lastSuccessAt.toISOString(),
        lagMinutes,
        maxLagMinutes: MAX_LAG_MINUTES,
        skippedCount,
        skippedHeights,
        frontierHeight,
        tipHeight: blocks.getCurrentBlockHeight(),
        firstStatsHeight,
        pendingCount,
        blocksPerMinute: OrdpoolMissingStats.getBlocksPerMinute(),
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

      // A bare 64-hex txid (no `iN` suffix) means: return the first image-bearing
      // inscription in this tx. Used by the block-overview atlas, which doesn't know
      // which inscription index in a batch reveal carries the image.
      const inscription = isValidTxid(inscriptionId)
        ? await ordpoolInscriptionsApi.$getFirstImageInscription(inscriptionId)
        : await ordpoolInscriptionsApi.$getInscriptionOrDelegeate(inscriptionId);

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

  // Test cases (live URLs once shipped):
  //   PNG stamp: https://ordpool.space/stamp-content/516e62beeffb26fb37f8e95e809274e5bbde76eb75a28357f6bbcd4eedbfe8ca
  //   SVG stamp: https://ordpool.space/stamp-content/085e0ccbf674dfd5934eb635d392250afb4b6ce41ceb1347335f6f0e64c2f7d6
  //   HTML stamp: https://ordpool.space/stamp-content/3dfc964777a27da2b93eddbe5a5da06923a1e1c7a80a386e884187dfb88877ff
  private async getStampContent(req: Request, res: Response): Promise<void> {
    const txid = req.params.txid;

    if (!txid || !isValidTxid(txid)) {
      res.status(400).send('Valid txid is required.');
      return;
    }

    try {
      const stamp = await ordpoolStampsApi.$getStamp(txid);
      if (!stamp) {
        res.status(404).send('Stamp not found in this transaction.');
        return;
      }
      sendStamp(res, stamp);
    } catch (error) {
      res.status(500).send('Internal server error: ' + error);
    }
  }

  // Test cases (live URLs once shipped):
  //   ATOM DFT (PNG): https://ordpool.space/atomical-content/1d2f39f54320631d0432fa495a45a4f298a2ca1b18adef8e4356e327d003a694
  // No image-bearing file in the atomical → 404, same as a stamp without image.
  private async getAtomicalContent(req: Request, res: Response): Promise<void> {
    const txid = req.params.txid;

    if (!txid || !isValidTxid(txid)) {
      res.status(400).send('Valid txid is required.');
      return;
    }

    try {
      const file = await ordpoolAtomicalsApi.$getFirstAtomicalImage(txid);
      if (!file) {
        res.status(404).send('No image-bearing file in this atomical.');
        return;
      }
      sendAtomicalFile(res, file);
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

  // HACK -- Ordpool: cache-control for inscription content
  // Inscriptions are content-addressed by inscription id, so the bytes never
  // change once committed. `immutable` lets the browser skip revalidation
  // entirely; `public, max-age` lets Cloudflare cache at the edge.
  // `no-transform` is the load-bearing bit for decompression-bomb safety:
  // without it, Cloudflare's edge auto-decompresses brotli/gzip-encoded
  // bodies when a downstream client sends Accept-Encoding: identity, which
  // means a 790-byte bomb inscription expands to ~794 MB at the edge on
  // every uncached hit (cf-cache-status: DYNAMIC). With no-transform,
  // Cloudflare passes through whatever Content-Encoding we set and the
  // client decompresses if it can -- which we never do server-side, see
  // `inscription.getDataRaw()` below.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable, no-transform');

  // Send the raw data
  res.status(200).send(Buffer.from(inscription.getDataRaw()));
}

function sendPreview(res: Response, previewInstructions: PreviewInstructions): void {

  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  res.setHeader('Content-Length', previewInstructions.previewContent.length);

  // HACK -- Ordpool: cache the preview HTML at the edge too. Preview content
  // is also content-addressed (we deterministically wrap inscription bytes
  // in a fixed HTML template), so it's safe to mark immutable. no-transform
  // is still useful here so Cloudflare doesn't HTML-minify our preview.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable, no-transform');

  // Send the preview HTML
  res.status(200).send(previewInstructions.previewContent);
}

function sendStamp(res: Response, stamp: ParsedStamp): void {
  res.setHeader('Content-Type', stamp.contentType);
  const bytes = stamp.getDataRaw();
  res.setHeader('Content-Length', bytes.length);
  res.status(200).send(Buffer.from(bytes));
}

function sendAtomicalFile(res: Response, file: AtomicalFile): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Length', file.data.length);
  res.status(200).send(Buffer.from(file.data));
}

export default new GeneralOrdpoolRoutes();
