import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, Inject, LOCALE_ID, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Observable, merge, of, Subject, Subscription } from 'rxjs';
import { tap, takeUntil } from 'rxjs/operators';
import { Env, StateService } from '@app/services/state.service';
import { IBackendInfo } from '@interfaces/websocket.interface';
import { LanguageService } from '@app/services/language.service';
import { NavigationService } from '@app/services/navigation.service';
import { StorageService } from '@app/services/storage.service';
import { WebsocketService } from '@app/services/websocket.service';
import { EnterpriseService } from '@app/services/enterprise.service';
// HACK -- Ordpool: import environment for CAT-21 mint flag
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-global-footer',
  templateUrl: './global-footer.component.html',
  styleUrls: ['./global-footer.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalFooterComponent implements OnInit, OnDestroy {
  // HACK -- Ordpool: CAT-21 mint flag
  enableCat21Mint = environment.enableCat21Mint;

  private destroy$: Subject<any> = new Subject<any>();
  env: Env;
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;
  backendInfo$: Observable<IBackendInfo>;
  servicesBackendInfo$: Observable<IBackendInfo>;
  frontendGitCommitHash = this.stateService.env.GIT_COMMIT_HASH;
  packetJsonVersion = this.stateService.env.PACKAGE_JSON_VERSION;
  urlLanguage: string;
  network$: Observable<string>;
  networkPaths: { [network: string]: string };
  currentNetwork = '';
  urlSubscription: Subscription;
  isServicesPage = false;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private navigationService: NavigationService,
    private enterpriseService: EnterpriseService,
    @Inject(LOCALE_ID) public locale: string,
    private storageService: StorageService,
    private route: ActivatedRoute,
    private cd: ChangeDetectorRef,
    private websocketService: WebsocketService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.isServicesPage = this.router.url.includes('/services/');

    this.env = this.stateService.env;
    this.backendInfo$ = this.stateService.backendInfo$;
    this.servicesBackendInfo$ = this.stateService.servicesBackendInfo$;
    this.urlLanguage = this.languageService.getLanguageForUrl();
    this.navigationService.subnetPaths.subscribe((paths) => {
      this.networkPaths = paths;
    });
    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe(info => {
      this.enterpriseInfo = info;
    });
    this.network$ = merge(of(''), this.stateService.networkChanged$).pipe(
      tap((network: string) => {
        return network;
      })
    );
    this.network$.pipe(takeUntil(this.destroy$)).subscribe((network) => {
      this.currentNetwork = network;
    });

    this.urlSubscription = this.route.url.subscribe((url) => {
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next(true);
    this.destroy$.complete();
    this.urlSubscription.unsubscribe();
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
  }

  networkLink(network) {
    const thisNetwork = network || 'mainnet';
    if( network === '' || network === 'mainnet' || network === 'testnet' || network === 'testnet4' || network === 'signet' ) {
      return (this.env.BASE_MODULE === 'mempool' ? '' : this.env.MEMPOOL_WEBSITE_URL + this.urlLanguage) + this.networkPaths[thisNetwork] || '/';
    }
    if( network === 'liquid' || network === 'liquidtestnet' ) {
      return (this.env.BASE_MODULE === 'liquid' ? '' : this.env.LIQUID_WEBSITE_URL + this.urlLanguage) + this.networkPaths[thisNetwork] || '/';
    }
  }
}
