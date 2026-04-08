import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, Input, HostListener } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, merge, of } from 'rxjs';
import { filter, scan, startWith, switchMap } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import { WebsocketService } from '@app/services/websocket.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { TransactionStripped } from '@interfaces/node-api.interface';
import { seoDescriptionNetwork } from '@app/shared/common.utils';

@Component({
  selector: 'app-recent-transactions-list',
  templateUrl: './recent-transactions-list.component.html',
  styleUrls: ['./recent-transactions-list.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecentTransactionsList implements OnInit, OnDestroy {
  @Input() widget: boolean = false;

  transactions$: Observable<TransactionStripped[]>;
  network$: Observable<string>;
  currency: string;
  currencySubscription: Subscription;
  isLoading = true;
  isManualPaused = false;
  isAutoPaused = false;
  bufferedCount = 0;
  txLimit = 50;
  limitOptions = [10, 50, 100, 500, 1000];
  private pausedTransactions: TransactionStripped[] = [];
  private pausedNewTxs: TransactionStripped[] = []; // buffered while paused, newest first
  private pausedNewTxids = new Set<string>();
  private limit$ = new BehaviorSubject<number>(50);

  constructor(
    public stateService: StateService,
    private websocketService: WebsocketService,
    private seoService: SeoService,
    private ogService: OpenGraphService,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    if (this.widget) {
      this.txLimit = 6;
      this.limit$.next(this.txLimit);
    } else {
      this.websocketService.want(['stats', 'mempool-blocks']);
    }
    this.network$ = merge(of(''), this.stateService.networkChanged$);

    this.transactions$ = this.limit$.pipe(
      switchMap((limit) => {
        return this.stateService.transactions$.pipe(
          filter((txs) => txs != null),
          scan((acc: TransactionStripped[], txs: TransactionStripped[]) => {
            const seen = new Set(acc.map(t => t.txid));
            const newTxs = txs.filter(t => !seen.has(t.txid));
            if (this.isManualPaused || this.isAutoPaused) {
              // While paused we freeze the visible list and buffer every
              // fresh transaction we see across emissions. We need the full
              // objects (not just txids) because stateService.transactions$
              // only holds a small rolling window, so early-pause txs would
              // otherwise fall off before we can re-render them on resume.
              const incoming: TransactionStripped[] = [];
              for (const tx of newTxs) {
                if (!this.pausedNewTxids.has(tx.txid)) {
                  this.pausedNewTxids.add(tx.txid);
                  incoming.push(tx);
                }
              }
              if (incoming.length) {
                this.pausedNewTxs = [...incoming, ...this.pausedNewTxs];
                // Cap the buffer at txLimit to bound memory on long pauses.
                // Anything beyond the limit would be sliced off on resume
                // anyway, so drop the oldest entries (tail) and evict their
                // txids from the dedup set so it can't grow unbounded.
                if (this.pausedNewTxs.length > limit) {
                  const dropped = this.pausedNewTxs.slice(limit);
                  for (const tx of dropped) {
                    this.pausedNewTxids.delete(tx.txid);
                  }
                  this.pausedNewTxs = this.pausedNewTxs.slice(0, limit);
                }
              }
              this.bufferedCount = this.pausedNewTxs.length;
              return acc;
            }
            this.pausedNewTxs = [];
            this.pausedNewTxids.clear();
            this.bufferedCount = 0;
            const result = [...newTxs, ...acc].slice(0, limit);
            this.pausedTransactions = result;
            return result;
          }, this.pausedTransactions),
          startWith(this.pausedTransactions),
        );
      }),
    );

    this.currencySubscription = this.stateService.fiatCurrency$.subscribe((fiat) => {
      this.currency = fiat;
    });

    if (!this.widget) {
      this.seoService.setTitle($localize`:@@recent-transactions-title:Recent Transactions`);
      this.seoService.setDescription($localize`:@@meta.description.recent-transactions:See the most recent transactions on the Bitcoin${seoDescriptionNetwork(this.stateService.network)} network, updated in real-time.`);
    }
  }

  setLimit(limit: number): void {
    this.txLimit = limit;
    this.limit$.next(limit);
  }

  togglePause(): void {
    this.isManualPaused = !this.isManualPaused;
    if (!this.isManualPaused && !this.isAutoPaused) {
      this.flushPausedBuffer();
      this.limit$.next(this.txLimit);
    }
    this.cd.markForCheck();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.widget || !this.stateService.isBrowser) {
      return;
    }
    const scrollEl = document.scrollingElement || document.documentElement;
    const atTop = !scrollEl || scrollEl.scrollTop <= 0;
    const shouldAutoPause = !atTop;
    if (shouldAutoPause === this.isAutoPaused) {
      return;
    }
    this.isAutoPaused = shouldAutoPause;
    if (!this.isAutoPaused && !this.isManualPaused) {
      // Flush buffered updates as soon as the user returns to the top.
      this.flushPausedBuffer();
      this.limit$.next(this.txLimit);
    }
    this.cd.markForCheck();
  }

  // Merges buffered (paused) transactions into pausedTransactions so that the
  // re-subscribed scan starts from the up-to-date frozen list, then clears
  // the buffer so the pill disappears.
  private flushPausedBuffer(): void {
    if (this.pausedNewTxs.length > 0) {
      this.pausedTransactions = [...this.pausedNewTxs, ...this.pausedTransactions].slice(0, this.txLimit);
    }
    this.pausedNewTxs = [];
    this.pausedNewTxids.clear();
    this.bufferedCount = 0;
  }

  scrollToTop(): void {
    if (!this.stateService.isBrowser) {
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  trackByTxid(index: number, tx: TransactionStripped): string {
    return tx.txid;
  }

ngOnDestroy(): void {
    this.currencySubscription?.unsubscribe();
  }
}
