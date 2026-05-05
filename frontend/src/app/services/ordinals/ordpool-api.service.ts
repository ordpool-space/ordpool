import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {
  Aggregation,
  ChartType,
  IndexerProgress,
  Interval,
  OrdpoolStatisticResponse,
} from '../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';
import { StateService } from '../state.service';
import { environment } from '@environments/environment';


@Injectable({
  providedIn: 'root'
})
export class OrdpoolApiService {

  private apiBaseUrl: string; // base URL is protocol, hostname, and port
  private apiBasePath: string; // network path is /testnet, etc. or '' for mainnet

  private httpClient = inject(HttpClient);
  private stateService  = inject(StateService);

  constructor() {
    this.apiBaseUrl = environment.apiBaseUrl;
    if (!this.stateService.isBrowser) { // except when inside AU SSR process
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
    this.apiBasePath = ''; // assume mainnet by default
    this.stateService.networkChanged$.subscribe((network) => {
      this.apiBasePath = network ? '/' + network : '';
    });
  }


  /**
   * Fetch ordpool statistics based on type, interval and aggregation level.
   *
   * @param type The type of data (e.g. 'mints', 'new-tokens', 'fees' or 'inscription-sizes').
   * @param interval The time range (e.g., '24h', '3d', '1y').
   * @param aggregation The aggregation level ('block', 'hour', 'day').
   * @returns An observable with the statistics data.
   */
  getOrdpoolStatistics$(type: ChartType, interval: Interval, aggregation: Aggregation): Observable<OrdpoolStatisticResponse[]> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/ordpool/statistics/${type}/${interval}/${aggregation}`;
    return this.httpClient.get<OrdpoolStatisticResponse[]>(url);
  }

  /**
   * Fetch the indexer's current liveness + progress snapshot. Returns 200
   * when the indexer is fresh (lag <= maxLagMinutes) and 503 when stale —
   * both bodies share the same shape, the frontend treats `ok=false` as
   * the staleness signal rather than relying on the HTTP status.
   *
   * @returns An observable with the indexer-progress payload.
   */
  getIndexerProgress$(): Observable<IndexerProgress> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/health/indexer-progress`;
    return this.httpClient.get<IndexerProgress>(url);
  }
}
