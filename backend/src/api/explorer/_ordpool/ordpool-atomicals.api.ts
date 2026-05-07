import { AtomicalFile, AtomicalParserService, isImageContentType } from 'ordpool-parser';

import { $fetchTxByTxid } from './ordpool-tx-fetch.helper';

/**
 * Atomicals carry their CBOR-decoded files as a list. The atlas / preview
 * consumers need a single renderable image, so we expose a "first image" API
 * that mirrors $getFirstImageInscription on the inscriptions side.
 *
 * The list of files is set by the operation type (NFT/FT/DFT/DAT/etc.) — see
 * the Atomicals parser for the details. We don't filter on operation here;
 * any file with an image MIME counts.
 */
class OrdpoolAtomicalsApi {

  public async $getFirstAtomicalImage(txid: string): Promise<AtomicalFile | undefined> {
    const transaction = await $fetchTxByTxid(txid);
    if (!transaction) {
      return undefined;
    }
    const atomical = AtomicalParserService.parse(transaction);
    if (!atomical) {
      return undefined;
    }
    return atomical.getFiles().find((f) => isImageContentType(f.contentType));
  }
}

export default new OrdpoolAtomicalsApi();
