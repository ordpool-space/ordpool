import { DigitalArtifactType, ParsedStamp, StampParserService } from 'ordpool-parser';

import { $fetchTxByTxid } from './ordpool-tx-fetch.helper';

/**
 * Resolve a txid to its parsed stamp, if any.
 *
 * Stamps are tx-level (one stamp per tx), so the lookup is keyed by txid only —
 * no inscription-style index suffix. Returns undefined for txs that aren't
 * stamps and for txs that aren't on chain.
 *
 * No content-type filtering at this layer: the route serves whatever the stamp
 * carries (image/png, image/svg+xml, text/html, …). Same posture as
 * /content/<inscriptionId>: the consumer asked for this specific stamp, give
 * them the bytes.
 */
class OrdpoolStampsApi {

  public async $getStamp(txid: string): Promise<ParsedStamp | undefined> {
    const transaction = await $fetchTxByTxid(txid);
    if (!transaction) {
      return undefined;
    }
    // StampParserService can also return ParsedSrc20/Src721/Src101 protocol
    // wrappers when the stamp's payload is one of those formats. Those don't
    // carry raw renderable bytes (their getDataRaw is the protocol payload,
    // not the underlying image), so we only accept ParsedStamp here.
    const parsed = StampParserService.parse(transaction);
    if (parsed && parsed.type === DigitalArtifactType.Stamp) {
      return parsed as ParsedStamp;
    }
    return undefined;
  }
}

export default new OrdpoolStampsApi();
