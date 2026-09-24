import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap, tap } from 'rxjs';
import { InscriptionParserService, ParsedInscription, RuneParserService, RunestoneSpec } from 'ordpool-parser';

/** The etching as the parser reports it inside a runestone. */
export type RuneEtchingSpec = NonNullable<RunestoneSpec['etching']>;
import { Transaction } from '@interfaces/electrs.interface';
import { ElectrsApiService } from '@app/services/electrs-api.service';


/** A rune id is addressed as "block:tx" wherever it is used as a key. */
export function runeIdKey(id: { block: bigint | number; tx: number }): string {
  return `${id.block}:${id.tx}`;
}

/**
 * Rune 1:0, which has no etching transaction: it came into being with the
 * Runes protocol itself. ord hardcodes it the same way.
 */
const UNCOMMON_GOODS: RuneEtchingSpec = {
  divisibility: 0,
  premine: 0n,
  symbol: '\u29c9',
  runeName: 'UNCOMMON\u2022GOODS',
  terms: {
    cap: 340282366920938463463374607431768211455n, // u128 max
    amount: 1n,
  },
  turbo: false,
};

@Injectable({
  providedIn: 'root'
})
export class OrdApiService {

  constructor(
    private electrsApiService: ElectrsApiService,
  ) { }

  decodeRunestone$(tx: Transaction): Observable<{ runestone: RunestoneSpec, runeInfo: { [id: string]: { etching: RuneEtchingSpec; txid: string; } } }> {
    const runestone = RuneParserService.parse(tx)?.runestone;
    const runeInfo: { [id: string]: { etching: RuneEtchingSpec; txid: string; } } = {};

    if (runestone) {
      const runesToFetch: Set<string> = new Set();

      if (runestone.mint) {
        runesToFetch.add(runeIdKey(runestone.mint));
      }

      runestone.edicts?.forEach(edict => {
        runesToFetch.add(runeIdKey(edict.id));
      });

      if (runesToFetch.size) {
        const runeEtchingObservables = Array.from(runesToFetch).map(runeId => this.getEtchingFromRuneId$(runeId));

        return forkJoin(runeEtchingObservables).pipe(
          map((etchings) => {
            etchings.forEach((el) => {
              if (el) {
                runeInfo[el.runeId] = { etching: el.etching, txid: el.txid };
              }
            });
            return { runestone: runestone, runeInfo };
          })
        );
      }
      return of({ runestone: runestone, runeInfo });
    } else {
      return of({ runestone: null, runeInfo: {} });
    }
  }

  // Get etching from runeId by looking up the transaction that etched the rune
  getEtchingFromRuneId$(runeId: string): Observable<{ runeId: string; etching: RuneEtchingSpec; txid: string; }> {
    if (runeId === '1:0') {
      return of({ runeId, etching: UNCOMMON_GOODS, txid: '0000000000000000000000000000000000000000000000000000000000000000' });
    } else {
      const [blockNumber, txIndex] = runeId.split(':');
      return this.electrsApiService.getBlockHashFromHeight$(parseInt(blockNumber)).pipe(
        switchMap(blockHash => this.electrsApiService.getBlockTxId$(blockHash, parseInt(txIndex))),
        switchMap(txId => this.electrsApiService.getTransaction$(txId)),
        switchMap(tx => {
          const runestone = RuneParserService.parse(tx)?.runestone;
          if (runestone) {
            const etching = runestone.etching;
            if (etching) {
              return of({ runeId, etching, txid: tx.txid });
            }
          }
          return of(null);
        }),
        catchError(() => of(null))
      );
    }
  }

  /**
   * Reads the inscriptions of ONE input, via ordpool-parser.
   *
   * The parser takes a transaction, so the input is handed over as a
   * single-input transaction. That keeps the element selection (leaf script,
   * annex aware) and the envelope decoding identical to what ord does, and to
   * what the rest of ordpool shows.
   */
  decodeInscriptions(tx: Transaction, vinIndex: number): ParsedInscription[] {

    const vin = tx.vin[vinIndex];
    if (!vin?.witness?.length) {
      return [];
    }

    return InscriptionParserService.parse({ txid: tx.txid, vin: [{ witness: vin.witness }] });
  }
}
