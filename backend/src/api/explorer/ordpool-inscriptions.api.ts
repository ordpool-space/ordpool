import { InscriptionParserService, isValidInscriptionId, ParsedInscription } from 'ordpool-parser';

import bitcoinApi from '../bitcoin/bitcoin-api-factory';
import { IEsploraApi } from '../bitcoin/esplora-api.interface';
import memPool from '../mempool';



class OrdpoolInscriptionsApi {

  public async $getInscriptionOrDelegeate(inscriptionId: string, recursiveLevel = 0): Promise<ParsedInscription | undefined> {


    // prevent endless loops via circular delegates
    if (recursiveLevel > 4) {
      throw new Error('Too many delegate levels. Stopping.');
    }

    const inscription = await this.$getInscriptionById(inscriptionId);
    if (!inscription) {
      return undefined;
    }

    const delegates = inscription.getDelegates();
    if (delegates.length) {
      return this.$getInscriptionOrDelegeate(delegates[0], recursiveLevel + 1);
    }

    return inscription;
  }

  private async $getInscriptionById(inscriptionId: string): Promise<ParsedInscription | undefined> {

    if (!isValidInscriptionId(inscriptionId)) {
      throw new Error('Invalid inscription ID!');
    }

    const splitted = inscriptionId.split('i');
    const txId = splitted[0];
    const inscriptionIndex = parseInt(splitted[1]);

    const mempool = memPool.getMempool();
    let transaction = mempool[txId] as IEsploraApi.Transaction;
    if (!transaction) {

      try {
        transaction = await bitcoinApi.$getRawTransaction(txId, true, false, false);
      } catch(error: any) {
        if (error.response && error.response.status === 404) {
          return undefined;
        }
        throw error;
      }
    }

    const parsedInscriptions: ParsedInscription[] = InscriptionParserService.parse(transaction);
    return parsedInscriptions[inscriptionIndex];
  }

}

export default new OrdpoolInscriptionsApi();
