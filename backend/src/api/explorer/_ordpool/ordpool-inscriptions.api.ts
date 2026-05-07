import { InscriptionParserService, isValidInscriptionId, ParsedInscription } from 'ordpool-parser';

import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import { IEsploraApi } from '../../bitcoin/esplora-api.interface';
import memPool from '../../mempool';



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

    const inscriptions = await this.$parseTxInscriptions(txId);
    return inscriptions?.[inscriptionIndex];
  }

  // Find the first image-bearing inscription in a tx. Used by the block-overview
  // atlas: the parser sets ordpool_inscription_image when ANY inscription in the tx
  // is an image, so a flat `<txid>i0` lookup hits the wrong index whenever the image
  // sits behind a JSON or text inscription in a batch reveal.
  public async $getFirstImageInscription(txid: string, recursiveLevel = 0): Promise<ParsedInscription | undefined> {

    if (recursiveLevel > 4) {
      throw new Error('Too many delegate levels. Stopping.');
    }

    const inscriptions = await this.$parseTxInscriptions(txid);
    if (!inscriptions?.length) {
      return undefined;
    }

    const first = inscriptions.find((i) => (i.contentType || '').startsWith('image/'));
    if (!first) {
      return undefined;
    }

    const delegates = first.getDelegates();
    if (delegates.length) {
      // delegate ids are inscription-shaped (txid + iN); recurse via the existing resolver
      // so we walk the same chain as direct content lookups.
      return this.$getInscriptionOrDelegeate(delegates[0], recursiveLevel + 1);
    }

    return first;
  }

  private async $parseTxInscriptions(txId: string): Promise<ParsedInscription[] | undefined> {
    const mempool = memPool.getMempool();
    let transaction = mempool[txId] as IEsploraApi.Transaction;
    if (!transaction) {
      try {
        // skipConversion=false so the bitcoind RPC shape (vin[].txinwitness) is
        // converted into the Esplora shape (vin[].witness) that the parser
        // reads. With skipConversion=true the parser sees no witness array
        // and returns []; that's how every preview/content lookup silently
        // 404'd until the tx happened to be in mempool (which is already
        // stored in Esplora shape on this code path's other branch).
        transaction = await bitcoinApi.$getRawTransaction(txId, false, false, false);
      } catch (error: any) {
        if (error.response && error.response.status === 404) {
          return undefined;
        }
        throw error;
      }
    }
    return InscriptionParserService.parse(transaction);
  }

}

export default new OrdpoolInscriptionsApi();
