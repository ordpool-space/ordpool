/**
 * User-Agent for every outbound call to a public OpenTimestamps calendar
 * (proxy + poller + backfill). The default Node fetch UA reads as
 * anonymous bot traffic; the identifying string gives operators a URL
 * to check and a path to contact us.
 */
export const OTS_OUTBOUND_USER_AGENT =
  'ordpool.space proxy. See https://ordpool.space/open-timestamps. ' +
  'If you don\'t like what we do, please contact us first.';
