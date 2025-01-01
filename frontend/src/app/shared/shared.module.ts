import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgbCollapseModule, NgbTypeaheadModule, NgbModalModule, NgbPopoverModule } from '@ng-bootstrap/ng-bootstrap';
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faFilter, faAngleDown, faAngleUp, faAngleRight, faAngleLeft, faBolt, faChartArea, faCogs, faCubes, faHammer, faDatabase, faExchangeAlt, faInfoCircle,
  faLink, faList, faSearch, faCaretUp, faCaretDown, faTachometerAlt, faThList, faTint, faTv, faClock, faAngleDoubleDown, faSortUp, faAngleDoubleUp, faChevronDown,
  faFileAlt, faRedoAlt, faArrowAltCircleRight, faExternalLinkAlt, faBook, faListUl, faDownload, faQrcode, faArrowRightArrowLeft, faArrowsRotate, faCircleLeft, faFastForward, faWallet, faUserClock, faWrench, faUserFriends, faQuestionCircle, faHistory, faSignOutAlt, faKey, faSuitcase, faIdCardAlt, faNetworkWired, faUserCheck, faCircleCheck, faUserCircle, faCheck, faRocket, faScaleBalanced, faHourglassStart, faHourglassHalf, faHourglassEnd, faWandMagicSparkles, faFaucetDrip } from '@fortawesome/free-solid-svg-icons';
import { InfiniteScrollModule } from 'ngx-infinite-scroll';
import { MenuComponent } from '../components/menu/menu.component';
import { PreviewTitleComponent } from '../components/master-page-preview/preview-title.component';
import { VbytesPipe } from './pipes/bytes-pipe/vbytes.pipe';
import { ShortenStringPipe } from './pipes/shorten-string-pipe/shorten-string.pipe';
import { CeilPipe } from './pipes/math-ceil/math-ceil.pipe';
import { Hex2asciiPipe } from './pipes/hex2ascii/hex2ascii.pipe';
import { Decimal2HexPipe } from './pipes/decimal2hex/decimal2hex.pipe';
import { FeeRoundingPipe } from './pipes/fee-rounding/fee-rounding.pipe';
import { AsmStylerPipe } from './pipes/asm-styler/asm-styler.pipe';
import { AbsolutePipe } from './pipes/absolute/absolute.pipe';
import { RelativeUrlPipe } from './pipes/relative-url/relative-url.pipe';
import { ScriptpubkeyTypePipe } from './pipes/scriptpubkey-type-pipe/scriptpubkey-type.pipe';
import { BytesPipe } from './pipes/bytes-pipe/bytes.pipe';
import { WuBytesPipe } from './pipes/bytes-pipe/wubytes.pipe';
import { FiatCurrencyPipe } from './pipes/fiat-currency.pipe';
import { HttpErrorPipe } from './pipes/http-error-pipe/http-error.pipe';
import { BlockchainComponent } from '../components/blockchain/blockchain.component';
import { TimeComponent } from '../components/time/time.component';
import { ClipboardComponent } from '../components/clipboard/clipboard.component';
import { QrcodeComponent } from '../components/qrcode/qrcode.component';
import { FiatComponent } from '../fiat/fiat.component';
import { NgbNavModule, NgbTooltipModule, NgbPaginationModule, NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { TxFeaturesComponent } from '../components/tx-features/tx-features.component';
import { TxFeeRatingComponent } from '../components/tx-fee-rating/tx-fee-rating.component';
import { ReactiveFormsModule } from '@angular/forms';
import { LanguageSelectorComponent } from '../components/language-selector/language-selector.component';
import { FiatSelectorComponent } from '../components/fiat-selector/fiat-selector.component';
import { RateUnitSelectorComponent } from '../components/rate-unit-selector/rate-unit-selector.component';
import { ThemeSelectorComponent } from '../components/theme-selector/theme-selector.component';
import { BrowserOnlyDirective } from './directives/browser-only.directive';
import { ServerOnlyDirective } from './directives/server-only.directive';
import { ColoredPriceDirective } from './directives/colored-price.directive';
import { NoSanitizePipe } from './pipes/no-sanitize.pipe';
import { MempoolBlocksComponent } from '../components/mempool-blocks/mempool-blocks.component';
import { BlockchainBlocksComponent } from '../components/blockchain-blocks/blockchain-blocks.component';
import { AmountComponent } from '../components/amount/amount.component';
import { RouterModule } from '@angular/router';
import { CapAddressPipe } from './pipes/cap-address-pipe/cap-address-pipe';
import { StartComponent } from '../components/start/start.component';
import { TransactionsListComponent } from '../components/transactions-list/transactions-list.component';
import { BlockOverviewGraphComponent } from '../components/block-overview-graph/block-overview-graph.component';
import { BlockOverviewTooltipComponent } from '../components/block-overview-tooltip/block-overview-tooltip.component';
import { BlockFiltersComponent } from '../components/block-filters/block-filters.component';
import { AddressGroupComponent } from '../components/address-group/address-group.component';
import { TrackerComponent } from '../components/tracker/tracker.component';
import { TrackerBarComponent } from '../components/tracker/tracker-bar.component';
import { SearchFormComponent } from '../components/search-form/search-form.component';
import { AddressLabelsComponent } from '../components/address-labels/address-labels.component';
import { FooterComponent } from '../components/footer/footer.component';
import { AssetComponent } from '../components/asset/asset.component';
import { AssetsComponent } from '../components/assets/assets.component';
import { AssetsNavComponent } from '../components/assets/assets-nav/assets-nav.component';
import { StatusViewComponent } from '../components/status-view/status-view.component';
import { ServerHealthComponent } from '../components/server-health/server-health.component';
import { ServerStatusComponent } from '../components/server-health/server-status.component';
import { FeesBoxComponent } from '../components/fees-box/fees-box.component';
import { DifficultyComponent } from '../components/difficulty/difficulty.component';
import { DifficultyTooltipComponent } from '../components/difficulty/difficulty-tooltip.component';
import { DifficultyMiningComponent } from '../components/difficulty-mining/difficulty-mining.component';
import { BalanceWidgetComponent } from '../components/balance-widget/balance-widget.component';
import { AddressTransactionsWidgetComponent } from '../components/address-transactions-widget/address-transactions-widget.component';
import { RbfTimelineComponent } from '../components/rbf-timeline/rbf-timeline.component';
import { RbfTimelineTooltipComponent } from '../components/rbf-timeline/rbf-timeline-tooltip.component';
import { PushTransactionComponent } from '../components/push-transaction/push-transaction.component';
import { TestTransactionsComponent } from '../components/test-transactions/test-transactions.component';
import { AssetsFeaturedComponent } from '../components/assets/assets-featured/assets-featured.component';
import { AssetGroupComponent } from '../components/assets/asset-group/asset-group.component';
import { AssetCirculationComponent } from '../components/asset-circulation/asset-circulation.component';
import { AmountShortenerPipe } from '../shared/pipes/amount-shortener.pipe';
import { DifficultyAdjustmentsTable } from '../components/difficulty-adjustments-table/difficulty-adjustments-table.components';
import { BlocksList } from '../components/blocks-list/blocks-list.component';
import { RbfList } from '../components/rbf-list/rbf-list.component';
import { RewardStatsComponent } from '../components/reward-stats/reward-stats.component';
import { DataCyDirective } from '../data-cy.directive';
import { LoadingIndicatorComponent } from '../components/loading-indicator/loading-indicator.component';
import { IndexingProgressComponent } from '../components/indexing-progress/indexing-progress.component';
import { SvgImagesComponent } from '../components/svg-images/svg-images.component';
import { ChangeComponent } from '../components/change/change.component';
import { SatsComponent } from './components/sats/sats.component';
import { BtcComponent } from './components/btc/btc.component';
import { FeeRateComponent } from './components/fee-rate/fee-rate.component';
import { TruncateComponent } from './components/truncate/truncate.component';
import { SearchResultsComponent } from '../components/search-form/search-results/search-results.component';
import { TimestampComponent } from './components/timestamp/timestamp.component';
import { ConfirmationsComponent } from './components/confirmations/confirmations.component';
import { ToggleComponent } from './components/toggle/toggle.component';
import { GeolocationComponent } from '../shared/components/geolocation/geolocation.component';
import { TestnetAlertComponent } from './components/testnet-alert/testnet-alert.component';
import { GlobalFooterComponent } from './components/global-footer/global-footer.component';
import { AcceleratePreviewComponent } from '../components/accelerate-preview/accelerate-preview.component';
import { AccelerateFeeGraphComponent } from '../components/accelerate-preview/accelerate-fee-graph.component';
import { MempoolErrorComponent } from './components/mempool-error/mempool-error.component';
import { AccelerationsListComponent } from '../components/acceleration/accelerations-list/accelerations-list.component';
import { PendingStatsComponent } from '../components/acceleration/pending-stats/pending-stats.component';
import { AccelerationStatsComponent } from '../components/acceleration/acceleration-stats/acceleration-stats.component';
import { AccelerateCheckout } from '../components/accelerate-checkout/accelerate-checkout.component';

import { BlockViewComponent } from '../components/block-view/block-view.component';
import { EightBlocksComponent } from '../components/eight-blocks/eight-blocks.component';
import { MempoolBlockViewComponent } from '../components/mempool-block-view/mempool-block-view.component';
import { MempoolBlockOverviewComponent } from '../components/mempool-block-overview/mempool-block-overview.component';
import { ClockchainComponent } from '../components/clockchain/clockchain.component';
import { ClockFaceComponent } from '../components/clock-face/clock-face.component';
import { ClockComponent } from '../components/clock/clock.component';
import { CalculatorComponent } from '../components/calculator/calculator.component';
import { BitcoinsatoshisPipe } from '../shared/pipes/bitcoinsatoshis.pipe';
import { HttpErrorComponent } from '../shared/components/http-error/http-error.component';
import { TwitterWidgetComponent } from '../components/twitter-widget/twitter-widget.component';
import { FaucetComponent } from '../components/faucet/faucet.component';

import { OnlyVsizeDirective, OnlyWeightDirective } from './components/weight-directives/weight-directives';
import { DigitalArtifactViewerComponent } from '../components/_ordpool/digital-artifact-viewer/digital-artifact-viewer.component';
import { InscriptionViewerComponent } from '../components/_ordpool/digital-artifact-viewer/inscription-viewer/inscription-viewer.component';
import { Src20ViewerComponent } from '../components/_ordpool/digital-artifact-viewer/src20-viewer/src20-viewer.component';
import { Cat21ViewerComponent } from '../components/_ordpool/digital-artifact-viewer/cat21-viewer/cat21-viewer.component';
import { RunestoneViewerComponent } from '../components/_ordpool/digital-artifact-viewer/runestone-viewer/runestone-viewer.component';
import { RunestoneIdToLinkComponent } from '../components/_ordpool/digital-artifact-viewer/runestone-viewer/runestone-id-to-link.component';
import { RunestoneIdToTextComponent } from '../components/_ordpool/digital-artifact-viewer/runestone-viewer/runestone-id-to-text.component';
import { BigIntFormatterPipe } from '../components/_ordpool/digital-artifact-viewer/runestone-viewer/big-int-formatter.pipe';
import { NumberSuffixPipe } from '../components/_ordpool/digital-artifact-viewer/runestone-viewer/number-suffix.pipe';
import { DivisibilityPipe } from '../components/_ordpool/digital-artifact-viewer/runestone-viewer/divisibility-pipe';
import { CapitalizeFirstPipe } from '../components/_ordpool/digital-artifact-viewer/cat21-viewer/capitalize-first.pipe';
import { JsonViewerComponent } from '../components/_ordpool/digital-artifact-viewer/json-viewer/json-viewer.component';
import { CodeViewerComponent } from '../components/_ordpool/digital-artifact-viewer/code-viewer/code-viewer.component';
import { MetadataViewerComponent } from '../components/_ordpool/digital-artifact-viewer/metadata-viewer/metadata-viewer.component';
import { InscriptionAcceleratorComponent } from '../components/_ordpool/inscription-accelerator/inscription-accelerator.component';
import { FeesBoxClickableComponent } from '../components/fees-box-clickable/fees-box-clickable.component';
import { WalletConnectComponent } from '../components/_ordpool/wallet-connect/wallet-connect.component';
import { HighlightModule } from 'ngx-highlightjs';
import { Cat21MintComponent } from '../components/_ordpool/cat21-mint/cat21-mint.component';
import { CountdownTimerComponent } from '../components/_ordpool/cat21-mint/countdown-timer-component';
import { Cat21CollabComponent } from '../components/_ordpool/cat21-collab/cat21-collab.component';
import { Cat21WhitelistCheckerComponent } from '../components/_ordpool/cat21-whitelist-checker/cat21-whitelist-checker.component';

import { PreviewViewerComponent } from '../components/_ordpool/digital-artifact-viewer/preview-viewer/preview-viewer.component';
import { AtomicalViewerComponent } from '../components/_ordpool/digital-artifact-viewer/atomical-viewer/atomical-viewer.component';
import { MiniInscriptionViewerComponent } from '../components/_ordpool/digital-artifact-viewer/inscription-viewer/mini-inscription-viewer.component';


@NgModule({
  declarations: [
    ClipboardComponent,
    TimeComponent,
    QrcodeComponent,
    FiatComponent,
    TxFeaturesComponent,
    TxFeeRatingComponent,
    LanguageSelectorComponent,
    FiatSelectorComponent,
    ThemeSelectorComponent,
    RateUnitSelectorComponent,
    ScriptpubkeyTypePipe,
    RelativeUrlPipe,
    NoSanitizePipe,
    Hex2asciiPipe,
    AsmStylerPipe,
    AbsolutePipe,
    BytesPipe,
    VbytesPipe,
    WuBytesPipe,
    CeilPipe,
    ShortenStringPipe,
    CapAddressPipe,
    Decimal2HexPipe,
    FeeRoundingPipe,
    FiatCurrencyPipe,
    HttpErrorPipe,
    ColoredPriceDirective,
    BrowserOnlyDirective,
    ServerOnlyDirective,
    BlockchainComponent,
    BlockViewComponent,
    EightBlocksComponent,
    MempoolBlockViewComponent,
    MempoolBlocksComponent,
    BlockchainBlocksComponent,
    AmountComponent,
    MenuComponent,
    PreviewTitleComponent,
    StartComponent,
    BlockOverviewGraphComponent,
    BlockOverviewTooltipComponent,
    BlockFiltersComponent,
    TransactionsListComponent,
    AddressGroupComponent,
    TrackerComponent,
    TrackerBarComponent,
    SearchFormComponent,
    AddressLabelsComponent,
    FooterComponent,
    AssetComponent,
    AssetsComponent,
    StatusViewComponent,
    ServerHealthComponent,
    ServerStatusComponent,
    FeesBoxComponent,
    DifficultyComponent,
    DifficultyMiningComponent,
    DifficultyTooltipComponent,
    BalanceWidgetComponent,
    AddressTransactionsWidgetComponent,
    RbfTimelineComponent,
    RbfTimelineTooltipComponent,
    PushTransactionComponent,
    TestTransactionsComponent,
    AssetsNavComponent,
    AssetsFeaturedComponent,
    AssetGroupComponent,
    AssetCirculationComponent,
    AmountShortenerPipe,
    DifficultyAdjustmentsTable,
    BlocksList,
    RbfList,
    DataCyDirective,
    RewardStatsComponent,
    LoadingIndicatorComponent,
    IndexingProgressComponent,
    SvgImagesComponent,
    ChangeComponent,
    SatsComponent,
    BtcComponent,
    FeeRateComponent,
    TruncateComponent,
    SearchResultsComponent,
    TimestampComponent,
    ConfirmationsComponent,
    ToggleComponent,
    GeolocationComponent,
    TestnetAlertComponent,
    GlobalFooterComponent,
    AcceleratePreviewComponent,
    AccelerateFeeGraphComponent,
    CalculatorComponent,
    BitcoinsatoshisPipe,
    BlockViewComponent,
    EightBlocksComponent,
    MempoolBlockViewComponent,
    MempoolBlockOverviewComponent,
    ClockchainComponent,
    ClockComponent,
    ClockFaceComponent,
    OnlyVsizeDirective,
    OnlyWeightDirective,
    MempoolErrorComponent,
    AccelerationsListComponent,
    AccelerationStatsComponent,
    AccelerateCheckout,
    PendingStatsComponent,
    HttpErrorComponent,
    TwitterWidgetComponent,
    FaucetComponent,
    DigitalArtifactViewerComponent,
    InscriptionViewerComponent,
    Src20ViewerComponent,
    Cat21ViewerComponent,
    RunestoneViewerComponent,
    RunestoneIdToLinkComponent,
    RunestoneIdToTextComponent,
    BigIntFormatterPipe,
    NumberSuffixPipe,
    DivisibilityPipe,
    JsonViewerComponent,
    CodeViewerComponent,
    MetadataViewerComponent,
    InscriptionAcceleratorComponent,
    FeesBoxClickableComponent,
    WalletConnectComponent,
    Cat21MintComponent,
    CountdownTimerComponent,
    Cat21CollabComponent,
    Cat21WhitelistCheckerComponent
  ],
  imports: [
    CommonModule,
    RouterModule,
    ReactiveFormsModule,
    NgbNavModule,
    NgbTooltipModule,
    NgbPaginationModule,
    NgbTypeaheadModule,
    NgbDropdownModule,
    NgbCollapseModule,
    InfiniteScrollModule,
    FontAwesomeModule,
    NgbModalModule,
    NgbPopoverModule,
    HighlightModule,
    
    PreviewViewerComponent,
    AtomicalViewerComponent,
    MiniInscriptionViewerComponent,
    CapitalizeFirstPipe
  ],
  providers: [
    BytesPipe,
    VbytesPipe,
    WuBytesPipe,
    RelativeUrlPipe,
    NoSanitizePipe,
    ShortenStringPipe,
    CapAddressPipe,
    AmountShortenerPipe,
  ],
  exports: [
    MenuComponent,
    RouterModule,
    ReactiveFormsModule,
    NgbNavModule,
    NgbTooltipModule,
    NgbPaginationModule,
    NgbTypeaheadModule,
    NgbDropdownModule,
    NgbCollapseModule,
    InfiniteScrollModule,
    FontAwesomeModule,
    TimeComponent,
    ClipboardComponent,
    QrcodeComponent,
    FiatComponent,
    TxFeaturesComponent,
    TxFeeRatingComponent,
    LanguageSelectorComponent,
    FiatSelectorComponent,
    RateUnitSelectorComponent,
    ThemeSelectorComponent,
    ScriptpubkeyTypePipe,
    RelativeUrlPipe,
    Hex2asciiPipe,
    AsmStylerPipe,
    AbsolutePipe,
    BytesPipe,
    VbytesPipe,
    WuBytesPipe,
    FiatCurrencyPipe,
    HttpErrorPipe,
    CeilPipe,
    ShortenStringPipe,
    CapAddressPipe,
    Decimal2HexPipe,
    FeeRoundingPipe,
    ColoredPriceDirective,
    BrowserOnlyDirective,
    ServerOnlyDirective,
    NoSanitizePipe,
    BlockchainComponent,
    MempoolBlocksComponent,
    BlockchainBlocksComponent,
    AmountComponent,
    StartComponent,
    BlockOverviewGraphComponent,
    BlockOverviewTooltipComponent,
    BlockFiltersComponent,
    TransactionsListComponent,
    AddressGroupComponent,
    TrackerComponent,
    TrackerBarComponent,
    SearchFormComponent,
    AddressLabelsComponent,
    FooterComponent,
    AssetComponent,
    AssetsComponent,
    StatusViewComponent,
    ServerHealthComponent,
    ServerStatusComponent,
    FeesBoxComponent,
    DifficultyComponent,
    DifficultyMiningComponent,
    DifficultyTooltipComponent,
    BalanceWidgetComponent,
    AddressTransactionsWidgetComponent,
    RbfTimelineComponent,
    RbfTimelineTooltipComponent,
    PushTransactionComponent,
    TestTransactionsComponent,
    AssetsNavComponent,
    AssetsFeaturedComponent,
    AssetGroupComponent,
    AssetCirculationComponent,
    AmountShortenerPipe,
    DifficultyAdjustmentsTable,
    BlocksList,
    DataCyDirective,
    RewardStatsComponent,
    LoadingIndicatorComponent,
    IndexingProgressComponent,
    SvgImagesComponent,
    ChangeComponent,
    SatsComponent,
    BtcComponent,
    FeeRateComponent,
    TruncateComponent,
    SearchResultsComponent,
    TimestampComponent,
    ConfirmationsComponent,
    ToggleComponent,
    GeolocationComponent,
    TestnetAlertComponent,
    PreviewTitleComponent,
    GlobalFooterComponent,
    AcceleratePreviewComponent,
    AccelerateFeeGraphComponent,
    MempoolErrorComponent,
    AccelerationsListComponent,
    AccelerationStatsComponent,
    AccelerateCheckout,
    PendingStatsComponent,
    HttpErrorComponent,
    TwitterWidgetComponent,

    MempoolBlockOverviewComponent,
    ClockchainComponent,
    ClockComponent,
    ClockFaceComponent,

    OnlyVsizeDirective,
    OnlyWeightDirective,

    DigitalArtifactViewerComponent,
    InscriptionAcceleratorComponent,
    RunestoneIdToLinkComponent,
    RunestoneIdToTextComponent,
    Cat21ViewerComponent
  ]
})
export class SharedModule {
  constructor(library: FaIconLibrary) {
    library.addIcons(faInfoCircle);
    library.addIcons(faChartArea);
    library.addIcons(faTv);
    library.addIcons(faClock);
    library.addIcons(faTachometerAlt);
    library.addIcons(faCubes);
    library.addIcons(faHammer);
    library.addIcons(faCogs);
    library.addIcons(faThList);
    library.addIcons(faList);
    library.addIcons(faTachometerAlt);
    library.addIcons(faDatabase);
    library.addIcons(faSearch);
    library.addIcons(faLink);
    library.addIcons(faBolt);
    library.addIcons(faTint);
    library.addIcons(faFilter);
    library.addIcons(faAngleDown);
    library.addIcons(faAngleUp);
    library.addIcons(faExchangeAlt);
    library.addIcons(faAngleDoubleUp);
    library.addIcons(faAngleDoubleDown);
    library.addIcons(faChevronDown);
    library.addIcons(faFileAlt);
    library.addIcons(faRedoAlt);
    library.addIcons(faArrowAltCircleRight);
    library.addIcons(faArrowsRotate);
    library.addIcons(faCircleLeft);
    library.addIcons(faExternalLinkAlt);
    library.addIcons(faSortUp);
    library.addIcons(faCaretUp);
    library.addIcons(faCaretDown);
    library.addIcons(faAngleRight);
    library.addIcons(faAngleLeft);
    library.addIcons(faBook);
    library.addIcons(faListUl);
    library.addIcons(faDownload);
    library.addIcons(faQrcode);
    library.addIcons(faArrowRightArrowLeft);
    library.addIcons(faExchangeAlt);
    library.addIcons(faList);
    library.addIcons(faFastForward);
    library.addIcons(faWallet);
    library.addIcons(faUserClock);
    library.addIcons(faWrench);
    library.addIcons(faUserFriends);
    library.addIcons(faQuestionCircle);
    library.addIcons(faHistory);
    library.addIcons(faSignOutAlt);
    library.addIcons(faKey);
    library.addIcons(faSuitcase);
    library.addIcons(faIdCardAlt);
    library.addIcons(faNetworkWired);
    library.addIcons(faUserCheck);
    library.addIcons(faCircleCheck);
    library.addIcons(faUserCircle);
    library.addIcons(faCheck);
    library.addIcons(faRocket);
    library.addIcons(faScaleBalanced);
    library.addIcons(faHourglassStart);
    library.addIcons(faHourglassHalf);
    library.addIcons(faHourglassEnd);
    library.addIcons(faWandMagicSparkles);
    library.addIcons(faFaucetDrip);
    
  }
}
