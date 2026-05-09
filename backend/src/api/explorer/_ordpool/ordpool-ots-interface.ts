/**
 * Pure-type interface module for OTS data.
 *
 * Importing from `repositories/OrdpoolOtsRepository.ts` directly would drag
 * the whole DB graph (mysql2, fs, path, ...) into the frontend's TypeScript
 * compile, breaking `ng build`. Same pattern as `ordpool-statistics-interface.ts`.
 *
 * Both backend (repositories) and frontend (api service) re-export from here.
 */

export interface OrdpoolOtsRow {
  txid: string;
  calendar: string;
  merkleRoot: string;
  firstSeenAt: Date;
  confirmedAt: Date | null;
  blockhash: string | null;
  blockheight: number | null;
  blocktime: number | null;
  fee: number | null;
  feerate: string | null;
}

export interface OrdpoolOtsConfirmFields {
  blockhash: string;
  blockheight: number;
  blocktime: number;
  fee: number;
  feerate: string;
}

export interface OrdpoolOtsCalendarStats {
  calendar: string;
  totalCommits: number;
  lastBlockheight: number | null;
  lastBlocktime: number | null;
  pendingCount: number;
}
