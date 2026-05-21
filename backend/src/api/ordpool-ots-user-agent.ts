/**
 * User-Agent we send on every outbound request to a public
 * OpenTimestamps calendar. Used by:
 *
 *   - ordpool.routes.ts::$proxyOtsDigest   (stamp submission proxy)
 *   - ordpool.routes.ts::$proxyOtsUpgrade  (upgrade-poll proxy)
 *   - ordpool-ots-poller.ts                (periodic 60 s indexer)
 *   - ordpool-ots-backfill.ts              (one-time historical sync)
 *
 * The default Node fetch UA reads as anonymous bot traffic when every
 * request funnels through the same backend IP. An identifying UA with a
 * URL and a contact invitation lets calendar operators recognise us and
 * reach out before they reach for the block button.
 */
export const OTS_OUTBOUND_USER_AGENT =
  'ordpool.space proxy. See https://ordpool.space/open-timestamps. ' +
  'If you don\'t like what we do, please contact us first.';
