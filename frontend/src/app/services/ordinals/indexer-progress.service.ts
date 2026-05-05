import { inject, Injectable } from '@angular/core';
import { interval, Observable, of, ReplaySubject, startWith, switchMap } from 'rxjs';
import { catchError, distinctUntilChanged, shareReplay, tap } from 'rxjs/operators';

import { IndexerProgress } from '../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';
import { StateService } from '../state.service';
import { OrdpoolApiService } from './ordpool-api.service';

const POLL_INTERVAL_MS = 60_000;

/**
 * Shared poller for `/api/v1/health/indexer-progress`.
 *
 * The block-detail page (per-block queue/ETA empty-state) and the Ordpool
 * Stats page (lag/skip banner) both consume this. We poll once per minute
 * for the whole app via `shareReplay({ bufferSize: 1, refCount: true })`,
 * so any number of subscribers share a single in-flight HTTP request.
 *
 * Errors swallow to `null` so a transient backend hiccup doesn't blow up
 * any consumer's render. Consumers MUST treat `null` as "unknown" and fall
 * back to whatever made sense before this service existed.
 */
@Injectable({ providedIn: 'root' })
export class IndexerProgressService {

  private apiService = inject(OrdpoolApiService);
  private stateService = inject(StateService);

  /**
   * Most recent successful payload, mirrored into a ReplaySubject so the
   * helper functions below can answer synchronously without re-subscribing.
   */
  private lastSnapshot$ = new ReplaySubject<IndexerProgress | null>(1);
  private lastSnapshot: IndexerProgress | null = null;

  readonly progress$: Observable<IndexerProgress | null> = this.stateService.isBrowser
    ? interval(POLL_INTERVAL_MS).pipe(
        startWith(0),
        switchMap(() =>
          this.apiService.getIndexerProgress$().pipe(
            catchError(() => of(null as IndexerProgress | null)),
          ),
        ),
        distinctUntilChanged((a, b) => snapshotEqual(a, b)),
        tap((snapshot) => {
          this.lastSnapshot = snapshot;
          this.lastSnapshot$.next(snapshot);
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      )
    : of(null as IndexerProgress | null);

  /** Synchronous accessor for components that need the latest known snapshot
   *  without subscribing (e.g. inside change-detection-driven getters). */
  getLatest(): IndexerProgress | null {
    return this.lastSnapshot;
  }
}

/**
 * Per-block status derived from a progress snapshot. Pure function — kept
 * outside the service so it's trivially testable and components can call it
 * with whatever snapshot they have to hand.
 *
 * - `pre-ordinals`: block is below the first inscription height for this network.
 * - `skipped`: block was poisoned by a corrupt artifact and excluded from indexing.
 * - `queued`: block is past the indexer's frontier and waiting to be processed.
 * - `indexed`: block is at or below the frontier (stats either exist already or
 *    will be populated as soon as the row lands; an empty stats row is normal).
 * - `unknown`: snapshot is null (transient backend error or pre-init).
 */
export type BlockIndexingStatus = 'pre-ordinals' | 'skipped' | 'queued' | 'indexed' | 'unknown';

export function getBlockIndexingStatus(
  progress: IndexerProgress | null,
  height: number,
): BlockIndexingStatus {
  if (!progress) {
    return 'unknown';
  }
  if (height < progress.firstStatsHeight) {
    return 'pre-ordinals';
  }
  if (progress.skippedHeights.includes(height)) {
    return 'skipped';
  }
  if (progress.frontierHeight !== null && height <= progress.frontierHeight) {
    return 'indexed';
  }
  return 'queued';
}

/**
 * Number of pending blocks that sit between the indexer's frontier and this
 * block, inclusive of this block. Returns `0` for non-queued statuses so
 * callers don't accidentally render "0 blocks ahead" for already-indexed
 * blocks (check status first).
 */
export function getQueuePositionFor(
  progress: IndexerProgress | null,
  height: number,
): number {
  if (!progress || progress.frontierHeight === null || height <= progress.frontierHeight) {
    return 0;
  }
  return height - progress.frontierHeight;
}

/**
 * ETA range (in minutes) for a queued block, computed from the current
 * blocks-per-minute rate. Returns `null` when:
 *  - the block isn't queued (already indexed, skipped, or pre-Ordinals),
 *  - or the rate is unknown (too few samples since last process start).
 *
 * The range is intentionally fuzzy because per-block analyse times vary by
 * an order of magnitude (50 ms on an empty block, tens of seconds on a
 * heavy inscription block, plus Esplora-fallback windows that slow things
 * down further). We show a conservative ±50 % spread around the central
 * estimate so the UI doesn't over-promise.
 */
export function getEtaMinutesFor(
  progress: IndexerProgress | null,
  height: number,
): { lo: number; hi: number } | null {
  if (!progress || progress.blocksPerMinute === null || progress.blocksPerMinute <= 0) {
    return null;
  }
  if (progress.frontierHeight === null || height <= progress.frontierHeight) {
    return null;
  }
  const blocksAhead = height - progress.frontierHeight;
  const central = blocksAhead / progress.blocksPerMinute;
  return {
    lo: Math.max(1, Math.floor(central * 0.5)),
    hi: Math.max(1, Math.ceil(central * 1.5)),
  };
}

/**
 * Cheap structural compare for the poll's `distinctUntilChanged`. Compares
 * the fields a consumer would notice; ignores `lastSuccessAt` jitter that
 * doesn't affect derived UI (we already render the lag rounded to minutes).
 */
function snapshotEqual(a: IndexerProgress | null, b: IndexerProgress | null): boolean {
  if (a === null || b === null) return a === b;
  return a.ok === b.ok
    && a.lagMinutes === b.lagMinutes
    && a.skippedCount === b.skippedCount
    && a.frontierHeight === b.frontierHeight
    && a.tipHeight === b.tipHeight
    && a.pendingCount === b.pendingCount
    && a.blocksPerMinute === b.blocksPerMinute
    && sameNumbers(a.skippedHeights, b.skippedHeights);
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
