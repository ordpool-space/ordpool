import { Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap, tap } from 'rxjs';
import { InscriptionParserService, ParsedInscription } from 'ordpool-parser';
import { Transaction } from '@interfaces/electrs.interface';
import { decipherRunestone, Runestone, Etching, UNCOMMON_GOODS } from '@app/shared/ord/rune.utils';
import { ElectrsApiService } from '@app/services/electrs-api.service';


@Injectable({
  providedIn: 'root'
})
export class OrdApiService {

  constructor(
    private electrsApiService: ElectrsApiService,
  ) { }

  decodeRunestone$(tx: Transaction): Observable<{ runestone: Runestone, runeInfo: { [id: string]: { etching: Etching; txid: string; } } }> {
    const runestone = decipherRunestone(tx);
    const runeInfo: { [id: string]: { etching: Etching; txid: string; } } = {};

    if (runestone) {
      const runesToFetch: Set<string> = new Set();

      if (runestone.mint) {
        runesToFetch.add(runestone.mint.toString());
      }

      if (runestone.edicts.length) {
        runestone.edicts.forEach(edict => {
          runesToFetch.add(edict.id.toString());
        });
      }

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
  getEtchingFromRuneId$(runeId: string): Observable<{ runeId: string; etching: Etching; txid: string; }> {
    if (runeId === '1:0') {
      return of({ runeId, etching: UNCOMMON_GOODS, txid: '0000000000000000000000000000000000000000000000000000000000000000' });
    } else {
      const [blockNumber, txIndex] = runeId.split(':');
      return this.electrsApiService.getBlockHashFromHeight$(parseInt(blockNumber)).pipe(
        switchMap(blockHash => this.electrsApiService.getBlockTxId$(blockHash, parseInt(txIndex))),
        switchMap(txId => this.electrsApiService.getTransaction$(txId)),
        switchMap(tx => {
          const runestone = decipherRunestone(tx);
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
