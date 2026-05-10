import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CounterpartyMessageType, ParsedCounterparty } from 'ordpool-parser';

/**
 * Test cases:
 * https://ordpool.space/tx/4a412b0a71439ad5eaf5f8a91878f8cf7c895037bc6b59ba93fd3d954eb4788e (mpma -- multi-party multi-asset send via 1-of-3 multisig)
 */
@Component({
  selector: 'app-counterparty-viewer',
  templateUrl: './counterparty-viewer.component.html',
  styleUrls: ['./counterparty-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class CounterpartyViewerComponent {

  _parsed: ParsedCounterparty | undefined;
  messageHex: string | undefined;
  messageLength = 0;

  @Input() showDetails = false;

  @Input()
  set parsedCounterparty(p: ParsedCounterparty | undefined) {
    if (this._parsed?.uniqueId === p?.uniqueId) {
      return;
    }
    this._parsed = p;
    if (!p) {
      this.messageHex = undefined;
      this.messageLength = 0;
      return;
    }
    const data = p.getMessageData();
    this.messageLength = data.length;
    this.messageHex = bytesToHex(data);
  }

  /**
   * One-line description for each message type. Counterparty has 22+
   * message types; the parser surfaces them as enum strings, the user
   * sees both the name and a short explanation.
   */
  get description(): string {
    return MESSAGE_TYPE_DESCRIPTIONS[this._parsed?.messageType ?? 'unknown'];
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

const MESSAGE_TYPE_DESCRIPTIONS: Record<CounterpartyMessageType, string> = {
  send:               'Classic asset send (v1 encoding)',
  enhanced_send:      'Asset send with attached memo',
  mpma:               'Multi-Party Multi-Asset send -- one tx, multiple recipients, multiple assets',
  sweep:              'Transfer all assets from one address to another',
  order:              'DEX order',
  btcpay:             'BTC payment for a matched DEX order',
  dispenser:          'Vending machine for tokens',
  dispense:           'Auto-triggered dispense',
  issuance:           'Create or modify an asset',
  issuance_subasset:  'Create a subasset',
  broadcast:          'Publish data or oracle feed',
  bet:                'Betting contract',
  dividend:           'Pay dividends to holders',
  burn:               'Proof-of-burn that minted XCP (Jan-Feb 2014 only)',
  cancel:             'Cancel an open order or bet',
  rps:                'Rock-Paper-Scissors move',
  rps_resolve:        'Reveal a Rock-Paper-Scissors choice',
  fairminter:         'Create a fair-mint token',
  fairmint:           'Mint from a fair minter',
  utxo:               'UTXO attach/detach (legacy)',
  attach:             'Bind a token to a UTXO',
  detach:             'Unbind a token from a UTXO',
  destroy:            'Permanently destroy tokens',
  unknown:            'Unrecognised Counterparty message type',
};
