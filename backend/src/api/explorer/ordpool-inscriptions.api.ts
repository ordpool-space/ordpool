import { InscriptionParserService, isValidInscriptionId, ParsedInscription } from 'ordpool-parser';

import bitcoinApi from '../bitcoin/bitcoin-api-factory';
import { IEsploraApi } from '../bitcoin/esplora-api.interface';
import memPool from '../mempool';



class OrdpoolInscriptionsApi {

  async $getInscriptionById(inscriptionId: string): Promise<ParsedInscription | undefined> {

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
