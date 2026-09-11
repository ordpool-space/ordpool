// HACK -- Ordpool: OnDestroy, AfterViewInit and NgZone are added for the
// tooltip-re-placement ResizeObserver (see the HACK blocks below).
import { Component, ElementRef, ViewChild, Input, OnChanges, OnDestroy, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, NgZone, inject } from '@angular/core';
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
// HACK -- Ordpool: AfterViewInit + OnDestroy are added for the ResizeObserver
// that re-places the tooltip when its async Digital Artifacts preview grows it.
export class BlockOverviewTooltipComponent implements OnChanges, AfterViewInit, OnDestroy {
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

  // HACK -- Ordpool: START tooltip re-placement on async growth.
  // The Digital Artifacts inscription preview loads asynchronously and grows the
  // tooltip downward after it is first placed. lastCursor + a ResizeObserver let
  // us re-run placement on that growth so the tooltip flips above the cursor
  // instead of running off the bottom of the viewport.
  /** Last cursor position, so the ResizeObserver can re-place the tooltip
   *  against the same cursor when its content grows. */
  private lastCursor: Position | null = null;
  private resizeObserver?: ResizeObserver;
  // HACK -- Ordpool: END

  constructor(
    private cd: ChangeDetectorRef,
    // HACK -- Ordpool: NgZone, so the ResizeObserver callback re-enters Angular.
    private zone: NgZone,
  ) {}

  // HACK -- Ordpool: START ResizeObserver lifecycle for tooltip re-placement.
  ngAfterViewInit(): void {
    // The tooltip reaches its final height AFTER placement: the current tx's
    // rows render after this change-detection pass, and the Digital Artifacts
    // inscription preview loads asynchronously and grows the tooltip downward.
    // Re-run placement whenever the rendered size changes so a tooltip that no
    // longer fits below the cursor flips above it (where there is room) instead
    // of overflowing the viewport bottom.
    if (typeof ResizeObserver === 'undefined' || !this.tooltipElement) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.zone.run(() => this.placeAgainstCursor());
    });
    this.resizeObserver.observe(this.tooltipElement.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }
  // HACK -- Ordpool: END

  ngOnChanges(changes): void {
    if (changes.cursorPosition && changes.cursorPosition.currentValue) {
      // HACK -- Ordpool: remember the cursor and delegate to placeAgainstCursor,
      // which the ResizeObserver also calls when the tooltip grows.
      this.lastCursor = {
        x: changes.cursorPosition.currentValue.x,
        y: changes.cursorPosition.currentValue.y,
      };
      this.placeAgainstCursor();
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

  /**
   * HACK -- Ordpool: place the tooltip against {@link lastCursor} using its
   * CURRENT rendered size. Called both when the cursor moves (ngOnChanges) and
   * when the tooltip grows (ResizeObserver). Uses `scrollHeight` for the height
   * so the flip decision sees the natural content height even while a
   * `max-height` clamp is applied, and only writes when the result changes, so
   * re-clamping the box does not feed a ResizeObserver loop.
   */
  private placeAgainstCursor(): void {
    if (!this.lastCursor) {
      return;
    }
    const { x: cursorX, y: cursorY } = this.lastCursor;

    if (!this.tooltipElement) {
      this.tooltipPosition = { x: cursorX + 10, y: cursorY + 10 };
      return;
    }

    const el = this.tooltipElement.nativeElement;
    // HACK -- Ordpool: cursor x/y are viewport-relative (set by the canvas
    // parent via canvas.getBoundingClientRect()), the tooltip is
    // `position: fixed`, so the algorithm operates purely in viewport space.
    // No offsetParent reads (which return null for fixed-positioned elements).
    const placed = computeTooltipPosition({
      cursor: { x: cursorX, y: cursorY },
      tooltip: { width: el.getBoundingClientRect().width, height: el.scrollHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });

    if (
      placed.x === this.tooltipPosition.x &&
      placed.y === this.tooltipPosition.y &&
      placed.maxWidth === this.tooltipMaxWidth &&
      placed.maxHeight === this.tooltipMaxHeight
    ) {
      return;
    }

    this.tooltipPosition = { x: placed.x, y: placed.y };
    this.tooltipMaxWidth = placed.maxWidth;
    this.tooltipMaxHeight = placed.maxHeight;
    this.cd.markForCheck();
  }

  getTooltipLeftPosition(): string {
    return window.innerWidth < 392 ? '-50px' : this.tooltipPosition.x + 'px';
  }
}
