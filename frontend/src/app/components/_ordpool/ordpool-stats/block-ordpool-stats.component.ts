import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Cat21ParserService, MinimalCat21Mint, OrdpoolStats } from 'ordpool-parser';

import { Price } from '../../../services/price.service';
import {
  BlockIndexingStatus,
  getBlockIndexingStatus,
  getEtaMinutesFor,
  getQueuePositionFor,
  IndexerProgressService,
} from '../../../services/ordinals/indexer-progress.service';
import { SharedModule } from '../../../shared/shared.module';
import { MiniInscriptionViewerComponent } from '../digital-artifact-viewer/inscription-viewer/mini-inscription-viewer.component';

@Component({
  selector: 'app-block-ordpool-stats',
  templateUrl: './block-ordpool-stats.component.html',
  styleUrls: ['./block-ordpool-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    MiniInscriptionViewerComponent
  ],
  host: {
    style: 'display: contents'
  }
})
export class BlockOrdpoolStatsComponent {

  @Input() ordpoolStats: OrdpoolStats | undefined = undefined;
  @Input() blockId: string | undefined = undefined;
  @Input() set blockHeight(value: number | undefined) {
    this.height.set(value);
  }

  @Input() showSkeleton = false;
  @Input() blockConversion: Price;

  private indexerProgress = inject(IndexerProgressService);
  private height = signal<number | undefined>(undefined);
  private progress = toSignal(this.indexerProgress.progress$, { initialValue: null });

  /** Per-block indexing status; only meaningful when `ordpoolStats` is absent
   *  (the template gates on that). When stats are present we don't render
   *  this empty-state at all. */
  readonly status = computed<BlockIndexingStatus>(() => {
    const h = this.height();
    if (h === undefined) {
      return 'unknown';
    }
    return getBlockIndexingStatus(this.progress(), h);
  });

  /** Number of blocks ahead in the queue, including this block.
   *  0 when not queued. */
  readonly queuePosition = computed(() => {
    const h = this.height();
    if (h === undefined) {
      return 0;
    }
    return getQueuePositionFor(this.progress(), h);
  });

  /** ETA range in minutes; null when not queued or rate is unknown. */
  readonly eta = computed(() => {
    const h = this.height();
    if (h === undefined) {
      return null;
    }
    return getEtaMinutesFor(this.progress(), h);
  });

  /** Indexer's current frontier height; null before the first block is processed. */
  readonly frontierHeight = computed(() => this.progress()?.frontierHeight ?? null);

  /** First block height the indexer scans — the first Ordinal inscription
   *  block on this network. Earlier Bitcoin assets (Counterparty etc.)
   *  predate this and are not in scope. */
  readonly firstStatsHeight = computed(() => this.progress()?.firstStatsHeight ?? null);

  /** Rolling indexing rate for display, rounded to one decimal place. */
  readonly blocksPerMinute = computed(() => {
    const rate = this.progress()?.blocksPerMinute;
    return rate === null || rate === undefined ? null : Math.round(rate * 10) / 10;
  });

  mintToParsedCat21(mint: MinimalCat21Mint) {

    const txn = {
      txid: mint.transactionId,
      locktime: 21,
      weight: mint.weight,
      fee: mint.fee,
      status: {
        block_hash: this.blockId
      }
    };

    return Cat21ParserService.parse(txn);
  }
}
