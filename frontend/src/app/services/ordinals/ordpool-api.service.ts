import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import {
  Aggregation,
  ChartType,
  IndexerProgress,
  Interval,
  OrdpoolStatisticResponse,
} from '../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';
import {
  OrdpoolOtsRow,
  OrdpoolOtsCalendarStats,
} from '../../../../../backend/src/api/explorer/_ordpool/ordpool-ots-interface';
import { StateService } from '../state.service';
import { environment } from '@environments/environment';

export type { OrdpoolOtsRow, OrdpoolOtsCalendarStats };


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

  /** Look up a single tx. The backend always answers 200 — non-OTS txs
   *  are a legitimate negative result, not an error — so the envelope
   *  `{ found, row? }` carries the answer instead of relying on HTTP
   *  status. Returns the bare row (or null) for the caller's convenience. */
  getOtsTx$(txid: string): Observable<OrdpoolOtsRow | null> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/ordpool/ots/tx/${txid}`;
    return this.httpClient
      .get<{ found: boolean; row?: OrdpoolOtsRow }>(url)
      .pipe(map(resp => resp.found && resp.row ? resp.row : null));
  }

  /** Lazy point-lookup against the backend's in-memory `ordpoolOtsTxidSet`:
   *  is the given txid a known OTS calendar batch commit? Used by
   *  `OtsKnowledgeService` only when the strip-wire surfaces didn't already
   *  attach the answer as `tx.isOtsCommit` and when the client-side
   *  OP_RETURN fast-path couldn't decide. See ORDPOOL-FLAGS-ARCHITECTURE.md §4. */
  isOtsCommit$(txid: string): Observable<{ result: boolean }> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/ordpool/ots/is-commit/${txid}`;
    return this.httpClient.get<{ result: boolean }>(url);
  }

  /** Per-calendar summary for the /ots/calendars dashboard. */
  getOtsCalendars$(): Observable<OrdpoolOtsCalendarStats[]> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/ordpool/ots/calendars`;
    return this.httpClient.get<OrdpoolOtsCalendarStats[]>(url);
  }

  /** Most-recent confirmed OTS commits. */
  getOtsRecent$(limit = 50): Observable<OrdpoolOtsRow[]> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/ordpool/ots/recent?limit=${limit}`;
    return this.httpClient.get<OrdpoolOtsRow[]>(url);
  }

  /** Every OTS commit at a given block height. */
  getOtsBlock$(height: number): Observable<OrdpoolOtsRow[]> {
    const url = `${this.apiBaseUrl}${this.apiBasePath}/api/v1/ordpool/ots/block/${height}`;
    return this.httpClient.get<OrdpoolOtsRow[]>(url);
  }
}
