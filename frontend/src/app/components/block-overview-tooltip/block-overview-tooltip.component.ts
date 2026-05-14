import { Component, ElementRef, ViewChild, Input, OnChanges, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { Position } from '@components/block-overview-graph/sprite-types.js';
import { Price } from '@app/services/price.service';
import { TransactionStripped } from '@interfaces/node-api.interface.js';
import { Filter, FilterMode, TransactionFlags, toFilters } from '@app/shared/filters.utils';
import { Block } from '@interfaces/electrs.interface.js';
import { DigitalArtifact, DigitalArtifactAnalyserService, OrdpoolTransactionFlags } from 'ordpool-parser';
import { Observable, catchError, of, startWith } from 'rxjs';
import { DigitalArtifactsFetcherService } from '@app/services/ordinals/digital-artifacts-fetcher.service';
import { computeTooltipPosition } from './block-overview-tooltip.position';

@Component({
  selector: 'app-block-overview-tooltip',
  templateUrl: './block-overview-tooltip.component.html',
  styleUrls: ['./block-overview-tooltip.component.scss'],
  standalone: false,
})
export class BlockOverviewTooltipComponent implements OnChanges {
  @Input() tx: TransactionStripped | void;
  @Input() relativeTime?: number;
  @Input() cursorPosition: Position;
  @Input() clickable: boolean;
  @Input() auditEnabled: boolean = false;
  @Input() blockConversion: Price;
  @Input() filterFlags: bigint | null = null;
  @Input() filterMode: FilterMode = 'and';

  private digitalArtifactsFetcher = inject(DigitalArtifactsFetcherService);
  digitalArtifacts$: Observable<DigitalArtifact[]> = of(null);

  txid = '';
  time: number = 0;
  fee = 0;
  value = 0;
  vsize = 1;
  feeRate = 0;
  effectiveRate;
  acceleration;
  hasEffectiveRate: boolean = false;
  timeMode: 'mempool' | 'mined' | 'missed' | 'after' = 'mempool';
  filters: Filter[] = [];
  activeFilters: { [key: string]: boolean } = {};
  // HACK -- Ordpool: surfaced separately so the Digital Artifacts cell
  // can render an OTS line and suppress the misleading "None" message
  // (OTS isn't parser-derivable; the parser-based fetcher returns []).
  isOtsCommit: boolean = false;

  tooltipPosition: Position = { x: 0, y: 0 };
  /** Output of `computeTooltipPosition`'s size middleware: the viewport
   *  room available on the chosen side, so the tooltip can shrink in
   *  cramped layouts instead of flipping far from the cursor. */
  tooltipMaxWidth: number | null = null;
  tooltipMaxHeight: number | null = null;

  @ViewChild('tooltip') tooltipElement: ElementRef<HTMLCanvasElement>;

  constructor(
    private cd: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes): void {
    if (changes.cursorPosition && changes.cursorPosition.currentValue) {
      const cursorX = changes.cursorPosition.currentValue.x;
      const cursorY = changes.cursorPosition.currentValue.y;
      let x = cursorX + 10;
      let y = cursorY + 10;
      if (this.tooltipElement) {
        const elementBounds = this.tooltipElement.nativeElement.getBoundingClientRect();
        // HACK -- Ordpool: cursor x/y are viewport-relative (set by the
        // canvas parent via canvas.getBoundingClientRect()), the tooltip
        // is `position: fixed`, so the algorithm operates purely in
        // viewport space. No offsetParent reads (which return null for
        // fixed-positioned elements).
        const placed = computeTooltipPosition({
          cursor: { x: cursorX, y: cursorY },
          tooltip: { width: elementBounds.width, height: elementBounds.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
        });
        x = placed.x;
        y = placed.y;
        this.tooltipMaxWidth = placed.maxWidth;
        this.tooltipMaxHeight = placed.maxHeight;
      }
      this.tooltipPosition = { x, y };
    }

    if (this.tx && (changes.tx || changes.filterFlags || changes.filterMode)) {
      this.txid = this.tx.txid || '';
      this.time = this.tx.time || 0;
      this.fee = this.tx.fee || 0;
      this.value = this.tx.value || 0;
      this.vsize = this.tx.vsize || 1;
      this.feeRate = this.fee / this.vsize;
      this.effectiveRate = this.tx.rate;
      const txFlags = BigInt(this.tx.flags) || 0n;
      // HACK -- Ordpool: bit 81 is preserved across the JSON Number
      // round-trip even though the lower bits get quantized to ~2^29.
      this.isOtsCommit = (txFlags & OrdpoolTransactionFlags.ordpool_ots) !== 0n;
      this.acceleration = this.tx.acc || (txFlags & TransactionFlags.acceleration);
      this.hasEffectiveRate = this.tx.acc || !(Math.abs((this.fee / this.vsize) - this.effectiveRate) <= 0.1 && Math.abs((this.fee / Math.ceil(this.vsize)) - this.effectiveRate) <= 0.1)
        || (txFlags && (txFlags & (TransactionFlags.cpfp_child | TransactionFlags.cpfp_parent)) > 0n);
      this.filters = this.tx.flags ? toFilters(txFlags).filter(f => f.tooltip) : [];
      this.activeFilters = {};
      for (const filter of this.filters) {
        if (this.filterFlags && (this.filterFlags & BigInt(filter.flag))) {
          this.activeFilters[filter.key] = true;
        }
      }

      if (!this.relativeTime) {
        this.timeMode = 'mempool';
      } else {
        if (this.tx?.context === 'actual' || this.tx?.status === 'found') {
          this.timeMode = 'mined';
        } else {
          const time = this.relativeTime || Date.now();
          if (this.time <= time) {
            this.timeMode = 'missed';
          } else {
            this.timeMode = 'after';
          }
        }
      }

      this.cd.markForCheck();

      // HACK -- fetch artifacts for tooltip
      if (this.tx && DigitalArtifactAnalyserService.hasAnyOrdpoolFlag(this.tx)) {
        this.digitalArtifacts$ = this.digitalArtifactsFetcher.fetchArtifacts(this.txid).pipe(
          startWith(undefined),
          catchError(err => of(null))
        );
      }
      else {
        this.digitalArtifacts$ = of([]);
      }
    }
  }

  getTooltipLeftPosition(): string {
    return window.innerWidth < 392 ? '-50px' : this.tooltipPosition.x + 'px';
  }
}
