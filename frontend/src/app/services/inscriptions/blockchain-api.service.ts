import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { EMPTY, Observable, concatAll, expand, filter, map, of, toArray } from 'rxjs';
import { Transaction } from '../../interfaces/electrs.interface';
import { InscriptionFetcherService } from './inscription-fetcher.service';

/**
 * Represents the spending outpoint of a transaction.
 */
interface SpendingOutpoint {
  n: number;
  tx_index: number;
}

/**
* Represents the input of a transaction.
*/
interface Input {
  sequence: number;
  witness: string;
  script: string;
  index: number;
  prev_out: {
    addr: string;
    n: number;
    script: string;
    spending_outpoints: SpendingOutpoint[];
    spent: boolean;
    tx_index: number;
    type: number;
    value: number;
  };
}

/**
* Represents the output of a transaction.
*/
interface Output {
  type: number;
  spent: boolean;
  value: number;
  spending_outpoints: SpendingOutpoint[];
  n: number;
  tx_index: number;
  script: string;
  addr: string;
}

/**
* Represents an unconfirmed transaction.
*/
interface UnconfirmedTransaction {
  hash: string;
  ver: number;
  vin_sz: number;
  vout_sz: number;
  size: number;
  weight: number;
  fee: number;
  relayed_by: string;
  lock_time: number;
  tx_index: number;
  double_spend: boolean;
  time: number;
  block_index: null | number;
  block_height: null | number;
  inputs: Input[];
  out: Output[];
}

/**
 * Represents the response structure for unconfirmed transactions.
 */
interface UnconfirmedTransactionsResponse {
  txs: UnconfirmedTransaction[];
}

/**
 * Decodes a concatenated witness buffer string into its individual components.
 *
 * The provided witness string starts with a byte indicating the number of stack items.
 * Each stack item starts with a length byte followed by the data.
 *
 * For example:
 *
 * '02473044022042d4e9d6...7a7e0121037f7ed0819e905837...'
 * would be decoded into:
 * ['3044022042d4e9d6...7a7e01', '037f7ed0819e905837...']
 *
 * @param witnessStr - The concatenated witness data in hex format.
 * @returns An array of hex strings representing individual witness items or undefined.
 */
function decodeWitness(witnessStr: string): string[] | undefined {
  let offset = 0;  // Start at the beginning of the string

  // Read the number of witness items (it's the first byte)
  const numItems = parseInt(witnessStr.substring(offset, offset + 2), 16);
  offset += 2;  // Move past the number of items byte

  const witnessItems: string[] = [];

  for (let i = 0; i < numItems; i++) {
    // For each item, read its length (the first byte)
    const length = parseInt(witnessStr.substring(offset, offset + 2), 16) * 2;  // Times 2 because we're counting in characters, not bytes
    offset += 2;  // Move past the length byte

    // Capture the witness item based on its length
    const item = witnessStr.substring(offset, offset + length);
    witnessItems.push(item);

    offset += length;  // Move to the next item or the end of the string
  }

  // Ensure we've consumed the entire input string
  if (offset !== witnessStr.length) {
    // throw new Error('Malformed witness data');
    return undefined;
  }

  if (!witnessItems.length) {
    return undefined;
  }

  return witnessItems;
}



/**
This mapping is untested and might be faulty at some places that are not related to the witness data.


Transaction format:

{
    "txid": "743feec584be2a93cca84c9d4652da6d160076b85d91d160c6204ddc28f4b580",
    "version": 1,
    "locktime": 0,
    "vin": [
        {
            "txid": "db6d72a191e705a5317376e03fef8d7236620b9a926bb1c306ad8ad1fb4cfcec",
            "vout": 1,
            "prevout": {
                "scriptpubkey": "00140a7fe23a39fee281a2336855bec1aa6a1994f711",
                "scriptpubkey_asm": "OP_0 OP_PUSHBYTES_20 0a7fe23a39fee281a2336855bec1aa6a1994f711",
                "scriptpubkey_type": "v0_p2wpkh",
                "scriptpubkey_address": "bc1qpfl7yw3elm3grg3ndp2masd2dgvefac3sar3q3",
                "value": 9616
            },
            "scriptsig": "",
            "scriptsig_asm": "",
            "witness": [
                "3044022042d4e9d615b58f55673c9083b208514756dec6d66766dbbe15e8d2619f2530ec02205a8ba729aa5f218890b3717a75211013901aa024f7a7ece265e80621acee7a7e01",
                "037f7ed0819e90583714a4c2404c16df00dbb4e438e62c786be49e7d007f04a179"
            ],
            "is_coinbase": false,
            "sequence": 4294967295
        },
        {
            "txid": "4739724ab50e22075c91d8c9fe8eed8f19b596ceb71a26c907b536705e3146c1",
            "vout": 80,
            "prevout": {
                "scriptpubkey": "00148dd473053e008f021896106bbc699d28334e6988",
                "scriptpubkey_asm": "OP_0 OP_PUSHBYTES_20 8dd473053e008f021896106bbc699d28334e6988",
                "scriptpubkey_type": "v0_p2wpkh",
                "scriptpubkey_address": "bc1q3h28xpf7qz8syxykzp4mc6va9qe5u6vgjcu8fz",
                "value": 1775500
            },
            "scriptsig": "",
            "scriptsig_asm": "",
            "witness": [
                "3045022100a383dd2abd2afaeb074517bc8a8e2f7115399762a67524d4906336e9261df773022074bd4fd75e4768631fb8a3f66d9b9941b91776caa192741f313c424f29bb182f01",
                "03fe74239d8c0ee892ae3abcfbdc7c0d2f25804c7e0dcec04171112df37e803c8b"
            ],
            "is_coinbase": false,
            "sequence": 4294967295
        }
    ],
    "vout": [
        {
            "scriptpubkey": "a9140c5f3d8e0fc215e77191b5c27cbd8fffe5d365a387",
            "scriptpubkey_asm": "OP_HASH160 OP_PUSHBYTES_20 0c5f3d8e0fc215e77191b5c27cbd8fffe5d365a3 OP_EQUAL",
            "scriptpubkey_type": "p2sh",
            "scriptpubkey_address": "32pS8GWDX5xS56ZfWTwAfEmWcbbpVudTzM",
            "value": 1381300
        },
        {
            "scriptpubkey": "0014a34f9048cc3e64da0687de3322b7785a622f55a7",
            "scriptpubkey_asm": "OP_0 OP_PUSHBYTES_20 a34f9048cc3e64da0687de3322b7785a622f55a7",
            "scriptpubkey_type": "v0_p2wpkh",
            "scriptpubkey_address": "bc1q5d8eqjxv8ejd5p58mcej9dmctf3z74d8s2pc0s",
            "value": 397769
        }
    ],
    "size": 372,
    "weight": 837,
    "fee": 6047,
    "status": {
        "confirmed": false
    }
}

UnconfirmedTransaction format:

{
  "hash":"743feec584be2a93cca84c9d4652da6d160076b85d91d160c6204ddc28f4b580",
  "ver":1,
  "vin_sz":2,
  "vout_sz":2,
  "size":372,
  "weight":837,
  "fee":6047,
  "relayed_by":"0.0.0.0",
  "lock_time":0,
  "tx_index":4528607160142244,
  "double_spend":false,
  "time":1696576383,
  "block_index":null,
  "block_height":null,
  "inputs":[
    {
      "sequence":4294967295,
      "witness":"0247 + 3044022042d4e9d615b58f55673c9083b208514756dec6d66766dbbe15e8d2619f2530ec02205a8ba729aa5f218890b3717a75211013901aa024f7a7ece265e80621acee7a7e01 + 21 + 037f7ed0819e90583714a4c2404c16df00dbb4e438e62c786be49e7d007f04a179",
      "script":"",
      "index":0,
      "prev_out":{
        "addr":"bc1qpfl7yw3elm3grg3ndp2masd2dgvefac3sar3q3",
        "n":1,
        "script":"00140a7fe23a39fee281a2336855bec1aa6a1994f711",
        "spending_outpoints":[
          {
            "n":0,
            "tx_index":4528607160142244
          }
        ],
        "spent":true,
        "tx_index":8338187759530325,
        "type":0,
        "value":9616
      }
    },
    {
      "sequence":4294967295,
      "witness":"02483045022100a383dd2abd2afaeb074517bc8a8e2f7115399762a67524d4906336e9261df773022074bd4fd75e4768631fb8a3f66d9b9941b91776caa192741f313c424f29bb182f012103fe74239d8c0ee892ae3abcfbdc7c0d2f25804c7e0dcec04171112df37e803c8b",
      "script":"",
      "index":1,
      "prev_out":{
        "addr":"bc1q3h28xpf7qz8syxykzp4mc6va9qe5u6vgjcu8fz",
        "n":80,
        "script":"00148dd473053e008f021896106bbc699d28334e6988",
        "spending_outpoints":[
          {
            "n":1,
            "tx_index":4528607160142244
          }
        ],
        "spent":true,
        "tx_index":6800231044613846,
        "type":0,
        "value":1775500
      }
    }
  ],
  "out":[
    {
      "type":0,
      "spent":false,
      "value":1381300,
      "spending_outpoints":[

      ],
      "n":0,
      "tx_index":4528607160142244,
      "script":"a9140c5f3d8e0fc215e77191b5c27cbd8fffe5d365a387",
      "addr":"32pS8GWDX5xS56ZfWTwAfEmWcbbpVudTzM"
    },
    {
      "type":0,
      "spent":false,
      "value":397769,
      "spending_outpoints":[

      ],
      "n":1,
      "tx_index":4528607160142244,
      "script":"0014a34f9048cc3e64da0687de3322b7785a622f55a7",
      "addr":"bc1q5d8eqjxv8ejd5p58mcej9dmctf3z74d8s2pc0s"
    }
  ]
}

>> Let's breakdown the key differences:

Transaction Identifiers:
  "Transaction" format uses "txid".
  "UnconfirmedTransaction" format uses "hash".

Version:
  Both formats use "version" or "ver" to denote the version.

Input Size:
  "Transaction" format doesn't explicitly mention the input size.
  "UnconfirmedTransaction" format mentions it with "vin_sz".

Output Size:
  "Transaction" format doesn't explicitly mention the output size.
  "UnconfirmedTransaction" format mentions it with "vout_sz".

Input
  "Transaction" format uses "vin" which contains detailed information about each input including the previous transaction, scripts, and witness.
  "UnconfirmedTransaction" format uses "inputs", which condenses this information. The witness data appears to be concatenated in the "UnconfirmedTransaction" format.

Output details:
  "Transaction" format uses "vout" which has detailed information about each output including its script and value.
  "UnconfirmedTransaction" format uses "out", which is a more concise representation.

Weight, Size, and Fee:
  Both formats represent these similarly.

Transaction Index:
  Only "UnconfirmedTransaction" format has a "tx_index".

Confirmation Status:
  "Transaction" format has a "status" field to denote if it's confirmed.
  "UnconfirmedTransaction" doesn't explicitly mention this, but the absence of "block_index" and "block_height" implies it's unconfirmed.

Witness:
  In the "Transaction" format, the witness is represented as an array of strings.
  In the "UnconfirmedTransaction" format, the witness is a single concatenated string.

 */
function unconfirmedToTransaction(unconfirmed: UnconfirmedTransaction): Transaction {
  return {
    txid: unconfirmed.hash,
    version: unconfirmed.ver,
    locktime: unconfirmed.lock_time,
    size: unconfirmed.size,
    weight: unconfirmed.weight,
    fee: unconfirmed.fee,
    status: {
      confirmed: !!(unconfirmed.block_index || unconfirmed.block_height)
    },
    vin: unconfirmed.inputs.map(input => ({
      txid: input.prev_out.tx_index.toString(),
      vout: input.prev_out.n,
      prevout: {
        scriptpubkey: input.prev_out.script,
        scriptpubkey_asm: '', // This can be derived if necessary
        scriptpubkey_type: '', // This can be derived if necessary
        scriptpubkey_address: input.prev_out.addr,
        value: input.prev_out.value
      },
      scriptsig: input.script,
      scriptsig_asm: '', // This can be derived if necessary
      witness: decodeWitness(input.witness || ''),
      is_coinbase: false, // Can't be a coinbase txn
      sequence: input.sequence
    })),
    vout: unconfirmed.out.map(output => ({
      scriptpubkey: output.script,
      scriptpubkey_asm: '', // This can be derived if necessary
      scriptpubkey_type: '', // This can be derived if necessary
      scriptpubkey_address: output.addr,
      value: output.value
    }))
  };
}


@Injectable({
  providedIn: 'root'
})
export class BlockchainApiService {

  private readonly baseUrl = 'https://blockchain.info';
  private readonly itemsPerPage = 500; // set based on API's maximum allowed value
  private readonly maxPagesToFetch = 20; // maximum number of pages to fetch


  constructor(
    private httpClient: HttpClient,
    private inscriptionFetcherService: InscriptionFetcherService) { }

  /**
   * Fetches unconfirmed transactions from blockchain.info API.
   * Hint: there is also a https://blockchain.info/q/unconfirmedcount
   *
   * @returns An observable of the list of unconfirmed transactions.
   */
  fetchFirstUnconfirmedTransactions(): Observable<Transaction[]> {
    return this.httpClient.get<UnconfirmedTransactionsResponse>(`${this.baseUrl}/unconfirmed-transactions?format=json`).pipe(
      map(response => response.txs.map(u => unconfirmedToTransaction(u)))
    );
  }

  /**
   * Iterates over all pages of unconfirmed transactions (up to MAX_PAGES pages) and caches them using the InscriptionFetcherService.
   */
  fetchAndCacheManyUnconfirmedTransactions(): void {
    let currentOffset = 0;
    let pagesFetched = 0;

    this.fetchPage(currentOffset, this.itemsPerPage).pipe(
      expand(response => {
        pagesFetched++;

        // Stop if we've fetched the desired number of pages or the length of transactions in the response is less than the limit
        if (pagesFetched >= this.maxPagesToFetch || response.txs.length < this.itemsPerPage) {
          return of(null); // End the observable stream by emitting null
        }

        // Update the offset for the next page
        currentOffset += this.itemsPerPage;
        return this.fetchPage(currentOffset, this.itemsPerPage);
      }),
      // filter out the final null value, if any
      filter(response => response !== null),
      map(response => response.txs.map(u => unconfirmedToTransaction(u)))
    ).subscribe(transactions => {
      this.inscriptionFetcherService.addTransactions(transactions);
    });
  }

  /**
   * Fetches a single page of unconfirmed transactions from the API.
   *
   * @param {number} offset - The offset value indicating the starting point from which records are fetched.
   * @param {number} limit - The number of records to fetch in a single API call.
   *
   * @returns {Observable<UnconfirmedTransactionsResponse>} An observable that emits the response from the API for the specified page.
   */
  private fetchPage(offset: number, limit: number): Observable<UnconfirmedTransactionsResponse> {
    return this.httpClient.get<UnconfirmedTransactionsResponse>(
      `${this.baseUrl}/unconfirmed-transactions?format=json&limit=${limit}&offset=${offset}`);
  }
}

