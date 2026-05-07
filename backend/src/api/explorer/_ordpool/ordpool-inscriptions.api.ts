import { InscriptionParserService, isImageContentType, isValidInscriptionId, ParsedInscription } from 'ordpool-parser';

import { $fetchTxByTxid } from './ordpool-tx-fetch.helper';



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

    const first = inscriptions.find((i) => isImageContentType(i.contentType));
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
    const transaction = await $fetchTxByTxid(txId);
    if (!transaction) {
      return undefined;
    }
    return InscriptionParserService.parse(transaction);
  }

}

export default new OrdpoolInscriptionsApi();
