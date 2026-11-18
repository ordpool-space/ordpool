import { firstValueFrom, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ElectrsApiService } from './electrs-api.service';
import { StateService } from './state.service';
import { Utxo } from '@interfaces/electrs.interface';

/**
 * electrs can list the SAME outpoint twice on `/address/<a>/utxo` around a
 * confirmation: once `confirmed: true`, once still unconfirmed (observed on
 * regtest 2026-09-12, documented on the SDK's `dedupeUtxosByOutpoint`). The
 * address page sums and renders this list, so a duplicate shows a doubled
 * balance. These specs pin that both electrs UTXO readers return one row per
 * outpoint, and that a different vout of the same txid is NOT merged.
 */
const TXID = 'a1'.repeat(32);

const CONFIRMED: Utxo = {
  txid: TXID,
  vout: 0,
  value: 500_000,
  status: { confirmed: true, block_height: 101, block_hash: 'b2'.repeat(32), block_time: 1_726_000_000 },
};
const SAME_OUTPOINT_UNCONFIRMED: Utxo = {
  txid: TXID,
  vout: 0,
  value: 500_000,
  status: { confirmed: false },
};
const SIBLING_VOUT: Utxo = {
  txid: TXID,
  vout: 1,
  value: 1_234,
  status: { confirmed: true, block_height: 101, block_hash: 'b2'.repeat(32), block_time: 1_726_000_000 },
};

function makeService(response: Utxo[]) {
  const get = jest.fn().mockReturnValue(of(response));
  const httpClient = { get } as unknown as HttpClient;
  const stateService = {
    isBrowser: true,
    env: { ROOT_NETWORK: '' },
    networkChanged$: of(''),
  } as unknown as StateService;
  return { service: new ElectrsApiService(httpClient, stateService), get };
}

describe('ElectrsApiService UTXO readers dedupe by outpoint', () => {
  it('getAddressUtxos$ returns one row per outpoint and keeps a sibling vout', async () => {
    const { service, get } = makeService([CONFIRMED, SAME_OUTPOINT_UNCONFIRMED, SIBLING_VOUT]);

    const utxos = await firstValueFrom(service.getAddressUtxos$('bc1qexample'));

    expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/address\/bc1qexample\/utxo$/));
    expect(utxos).toEqual([CONFIRMED, SIBLING_VOUT]);
    expect(utxos.reduce((sum, u) => sum + u.value, 0)).toBe(501_234);
  });

  it('getScriptHashUtxos$ returns one row per outpoint and keeps a sibling vout', async () => {
    const { service, get } = makeService([CONFIRMED, SAME_OUTPOINT_UNCONFIRMED, SIBLING_VOUT]);

    // A P2PK script, the shape address.component passes for a raw pubkey address.
    const utxos = await firstValueFrom(service.getScriptHashUtxos$('21' + '02'.repeat(33) + 'ac'));

    expect(get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/scripthash\/[0-9a-f]{64}\/utxo$/));
    expect(utxos).toEqual([CONFIRMED, SIBLING_VOUT]);
  });
});
