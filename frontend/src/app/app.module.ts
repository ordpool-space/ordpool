import { BrowserModule } from '@angular/platform-browser';
import { ModuleWithProviders, NgModule } from '@angular/core';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './components/app/app.component';
import { ElectrsApiService } from './services/electrs-api.service';
import { StateService } from './services/state.service';
import { CacheService } from './services/cache.service';
import { PriceService } from './services/price.service';
import { EnterpriseService } from './services/enterprise.service';
import { WebsocketService } from './services/websocket.service';
import { AudioService } from './services/audio.service';
import { SeoService } from './services/seo.service';
import { OpenGraphService } from './services/opengraph.service';
import { SharedModule } from './shared/shared.module';
import { StorageService } from './services/storage.service';
import { HttpCacheInterceptor } from './services/http-cache.interceptor';
import { HttpRetryInterceptor } from './services/http-retry.interceptor';
import { LanguageService } from './services/language.service';
import { FiatShortenerPipe } from './shared/pipes/fiat-shortener.pipe';
import { FiatCurrencyPipe } from './shared/pipes/fiat-currency.pipe';
import { ShortenStringPipe } from './shared/pipes/shorten-string-pipe/shorten-string.pipe';
import { CapAddressPipe } from './shared/pipes/cap-address-pipe/cap-address-pipe';
import { AppPreloadingStrategy } from './app.preloading-strategy';
import { DigitalArtifactsFetcherService } from './services/ordinals/digital-artifacts-fetcher.service';
import { BlockchainApiService } from './services/ordinals/blockchain-api.service';
import { HiroApiService } from './services/ordinals/hiro-api.service';
import { InscriptionAcceleratorApiService } from './services/ordinals/inscription-accelerator-api.service';
import { WalletService } from './services/ordinals/wallet.service';
import { RollingElectrsApiService } from './services/ordinals/rolling-electrs-api.service';
import { Cat21Service } from './services/ordinals/cat21.service';

import { HIGHLIGHT_OPTIONS } from 'ngx-highlightjs';

const providers = [
  ElectrsApiService,
  StateService,
  CacheService,
  PriceService,
  WebsocketService,
  AudioService,
  SeoService,
  OpenGraphService,
  StorageService,
  EnterpriseService,
  LanguageService,
  ShortenStringPipe,
  FiatShortenerPipe,
  FiatCurrencyPipe,
  CapAddressPipe,
  AppPreloadingStrategy,
  DigitalArtifactsFetcherService,
  BlockchainApiService,
  HiroApiService,
  InscriptionAcceleratorApiService,
  WalletService,
  RollingElectrsApiService,
  Cat21Service,
  // HACK
  { provide: HTTP_INTERCEPTORS, useClass: HttpCacheInterceptor, multi: true },
  { provide: HTTP_INTERCEPTORS, useClass: HttpRetryInterceptor, multi: true },
  { provide: HIGHLIGHT_OPTIONS,
    useValue: {
      coreLibraryLoader: () => import('highlight.js/lib/core'),
      languages: {
        json: () => import('highlight.js/lib/languages/json'),
        yaml: () => import('highlight.js/lib/languages/yaml'),
      },
      // themePath: 'path-to-theme.css' // Optional, and useful if you want to change the theme dynamically
    }
  }
];

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    BrowserAnimationsModule,
    SharedModule,
  ],
  providers: providers,
  bootstrap: [AppComponent]
})
export class AppModule { }

@NgModule({})
export class MempoolSharedModule{
  static forRoot(): ModuleWithProviders<MempoolSharedModule> {
    return {
      ngModule: AppModule,
      providers: providers
    };
  }
}
