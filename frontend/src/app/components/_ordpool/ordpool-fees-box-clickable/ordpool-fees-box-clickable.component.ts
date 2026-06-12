import { Component, OnInit, ChangeDetectionStrategy, OnDestroy, ChangeDetectorRef, Output, EventEmitter } from '@angular/core';
import { StateService } from '../../../services/state.service';
import { Observable, combineLatest, Subscription } from 'rxjs';
import { Recommendedfees } from '../../../interfaces/websocket.interface';
import { feeLevels } from '../../../app.constants';
import { map, startWith, tap } from 'rxjs/operators';
import { ThemeService } from '../../../services/theme.service';

@Component({
  selector: 'app-ordpool-fees-box-clickable',
  templateUrl: './ordpool-fees-box-clickable.component.html',
  styleUrls: ['./ordpool-fees-box-clickable.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class OrdpoolFeesBoxClickableComponent implements OnInit, OnDestroy {
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
    this.themeSubscription = this.themeService.themeState$.subscribe(() => {
      this.setFeeGradient();
    })
  }

  setFeeGradient() {
    // themeState$ is a BehaviorSubject and emits synchronously on
    // subscribe, which happens in ngOnInit BEFORE recommendedFees$
    // has delivered its first value. At that point `this.fees` is
    // still undefined and reading `.minimumFee` throws. Bail out;
    // the first recommendedFees$ emission re-runs this with the
    // right data.
    if (!this.fees) { return; }
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
