import { Component, OnInit, ChangeDetectionStrategy, OnDestroy, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';
import { StateService } from '../../services/state.service';
import { Observable, combineLatest, Subscription } from 'rxjs';
import { Recommendedfees } from '../../interfaces/websocket.interface';
import { feeLevels } from '../../app.constants';
import { map, startWith, tap } from 'rxjs/operators';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-fees-box-clickable',
  templateUrl: './fees-box-clickable.component.html',
  styleUrls: ['./fees-box-clickable.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeesBoxClickableComponent implements OnInit, OnDestroy {
  isLoading$: Observable<boolean>;
  recommendedFees$: Observable<Recommendedfees>;
  themeSubscription: Subscription;
  gradient = 'linear-gradient(to right, var(--skeleton-bg), var(--skeleton-bg))';
  noPriority = 'var(--skeleton-bg)';
  fees: Recommendedfees;

  @Output()
  feeClicked = new EventEmitter<number>();

  constructor(
    private stateService: StateService,
    private themeService: ThemeService,
    private cd: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.isLoading$ = combineLatest(
      this.stateService.isLoadingWebSocket$.pipe(startWith(false)),
      this.stateService.loadingIndicators$.pipe(startWith({ mempool: 0 })),
    ).pipe(map(([socket, indicators]) => {
      return socket || (indicators.mempool != null && indicators.mempool !== 100);
    }));
    this.recommendedFees$ = this.stateService.recommendedFees$
      .pipe(
        tap((fees) => {
          this.fees = fees;
          this.setFeeGradient();
        }
      )
    );
    this.themeSubscription = this.themeService.themeChanged$.subscribe(() => {
      this.setFeeGradient();
    })
  }

  setFeeGradient() {
    let feeLevelIndex = feeLevels.slice().reverse().findIndex((feeLvl) => this.fees.minimumFee >= feeLvl);
    feeLevelIndex = feeLevelIndex >= 0 ? feeLevels.length - feeLevelIndex : feeLevelIndex;
    const startColor = '#' + (this.themeService.mempoolFeeColors[feeLevelIndex - 1] || this.themeService.mempoolFeeColors[this.themeService.mempoolFeeColors.length - 1]);

    feeLevelIndex = feeLevels.slice().reverse().findIndex((feeLvl) => this.fees.fastestFee >= feeLvl);
    feeLevelIndex = feeLevelIndex >= 0 ? feeLevels.length - feeLevelIndex : feeLevelIndex;
    const endColor = '#' + (this.themeService.mempoolFeeColors[feeLevelIndex - 1] || this.themeService.mempoolFeeColors[this.themeService.mempoolFeeColors.length - 1]);

    this.gradient = `linear-gradient(to right, ${startColor}, ${endColor})`;
    this.noPriority = startColor;

    this.cd.markForCheck();
  }

  ngOnDestroy(): void {
    this.themeSubscription.unsubscribe();
  }
}
