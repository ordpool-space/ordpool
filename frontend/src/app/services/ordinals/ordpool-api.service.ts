import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '../state.service';
import { OrdpoolStatisticResponse } from '../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';


@Injectable({
  providedIn: 'root'
})
export class OrdpoolApiService {

  private apiBaseUrl: string; // base URL is protocol, hostname, and port
  private apiBasePath: string; // network path is /testnet, etc. or '' for mainnet

  private httpClient = inject(HttpClient);
  private stateService  = inject(StateService);

  constructor() {
    this.apiBaseUrl = ''; // use relative URL by default
    if (!this.stateService.isBrowser) { // except when inside AU SSR process
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
    this.apiBasePath = ''; // assume mainnet by default
    this.stateService.networkChanged$.subscribe((network) => {
      this.apiBasePath = network ? '/' + network : '';
    });
  }


  /**
   * Fetch ordpool statistics based on interval and aggregation level.
   * @param interval The time range (e.g., '24h', '3d', '1y').
   * @param aggregation The aggregation level ('block', 'hour', 'day').
   * @returns An observable with the statistics data.
   */
  getOrdpoolStatistics$(type: , interval: string, aggregation: string): Observable<any> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/ordpool/statistics/${interval}/${aggregation}`;
    return this.httpClient.get<OrdpoolStatisticResponse[]>(url);
  }
}
