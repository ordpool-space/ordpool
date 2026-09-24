import { InscriptionParserService, isImageContentType, isValidInscriptionId, ParsedInscription } from 'ordpool-parser';

import { isHidden } from './hidden-content';
import { $fetchTxByTxid } from './ordpool-tx-fetch.helper';



class OrdpoolInscriptionsApi {

  /**
   * Resolves an inscription and, if it delegates, the target it delegates to.
   *
   * ord follows EXACTLY ONE hop. `content`, `preview` and
   * `effective_content_type` all read
   * `if let Some(delegate) = inscription.delegate() { inscription = get(delegate) }`
   * with no loop (cat21-ord src/subcommand/server.rs and server/r.rs, and
   * src/index.rs for the effective type). A delegate whose target delegates
   * again therefore resolves to that target's OWN body for ord, which for a
   * body-less delegate means no content at all. Following the chain further
   * would serve content ord does not serve.
   */
  public async $getInscriptionOrDelegeate(inscriptionId: string): Promise<ParsedInscription | undefined> {

    // HACK -- Ordpool: a non-hidden inscription can delegate to a hidden
    // target. The route gates only the requested id, so gate every resolved
    // id here (the requested one and the delegate hop) before decoding its
    // witness.
    if (isHidden(inscriptionId)) {
      return undefined;
    }

    const inscription = await this.$getInscriptionById(inscriptionId);
    if (!inscription) {
      return undefined;
    }

    // ord takes the FIRST delegate field; getDelegates() has already dropped
    // malformed ones, which ord treats as no delegate at all
    const delegate = inscription.getDelegates()[0];
    if (!delegate) {
      return inscription;
    }

    if (isHidden(delegate)) {
      return undefined;
    }

    return this.$getInscriptionById(delegate);
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
  public async $getFirstImageInscription(txid: string): Promise<ParsedInscription | undefined> {

    const inscriptions = await this.$parseTxInscriptions(txid);
    if (!inscriptions?.length) {
      return undefined;
    }

    const first = inscriptions.find((i) => isImageContentType(i.contentType));
    if (!first) {
      return undefined;
    }

    const delegate = first.getDelegates()[0];
    if (delegate) {
      // delegate ids are inscription-shaped (txid + iN); resolve via the same
      // one-hop path as direct content lookups
      return this.$getInscriptionOrDelegeate(delegate);
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
