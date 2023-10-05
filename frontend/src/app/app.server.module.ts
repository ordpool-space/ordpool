import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { ServerModule, ServerTransferStateModule } from '@angular/platform-server';

import { AppModule } from './app.module';
import { AppComponent } from './components/app/app.component';
import { HttpCacheInterceptor } from './services/http-cache.interceptor';
import { HttpRetryInterceptor } from './services/http-retry.interceptor';

@NgModule({
  imports: [
    AppModule,
    ServerModule,
    ServerTransferStateModule,
  ],
  providers: [
    // twice ??
    { provide: HTTP_INTERCEPTORS, useClass: HttpCacheInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: HttpRetryInterceptor, multi: true },
  ],
  bootstrap: [AppComponent],
})
export class AppServerModule {}
