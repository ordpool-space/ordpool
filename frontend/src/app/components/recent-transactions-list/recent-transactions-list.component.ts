import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, Input } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, merge, of } from 'rxjs';
import { filter, scan, switchMap, tap } from 'rxjs/operators';
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
  isPaused = false;
  txLimit = 50;
  limitOptions = [10, 50, 100, 500, 1000];
  skeletonRows: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  private pausedTransactions: TransactionStripped[] = [];
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
      this.skeletonRows = [0, 1, 2, 3, 4, 5];
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
            if (this.isPaused) {
              return acc;
            }
            const seen = new Set(acc.map(t => t.txid));
            const newTxs = txs.filter(t => !seen.has(t.txid));
            const result = [...newTxs, ...acc].slice(0, limit);
            this.pausedTransactions = result;
            return result;
          }, this.pausedTransactions),
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
    this.isPaused = !this.isPaused;
    if (!this.isPaused) {
      this.limit$.next(this.txLimit);
    }
    this.cd.markForCheck();
  }

  trackByTxid(index: number, tx: TransactionStripped): string {
    return tx.txid;
  }

  ngOnDestroy(): void {
    this.currencySubscription?.unsubscribe();
  }
}
