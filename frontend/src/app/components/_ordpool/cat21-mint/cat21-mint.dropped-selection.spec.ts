/**
 * @test-kind unit
 * Real:   Cat21MintComponent with its production template; ordpool-sdk loaded for real and wired the way app.module.ts wires it (Cat21MintOrchestrator, describeFundingPick, UtxoContentScanner, Cat21Service, Cat21ApiService, WalletService)
 * Faked:  fetch: electrs /api/address/:a/utxo (electrsConfirmedUtxoFixture, ordpool-sdk/testing, captured) and POST /api/tx (the txid as text, esplora API.md), ord and cat21-ord /output (the SDK's cleanOutputFixture); WalletService storage (a persisted LAST_CONNECTED_WALLET); Leather's window.LeatherProvider signPsbt (the { result: { hex } } shape the SDK's Leather signer reads, signing with the harness key); StateService.recommendedFees$ (the websocket feed) -> recommendedFeesFixture (ordpool-sdk); mempool's SeoService and relativeUrl pipe (upstream, not read by the funding panel)
 * Proves: "you picked this coin" shows only while the SDK still spends the pick; a pick the SDK drops (gone, or below the requirement at a raised fee rate) is named in a notice beside the coin the mint spends instead, and Mint spends that coin
 */
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import { cleanOutputFixture, recommendedFeesFixture, TxnOutput, WalletInfo } from 'ordpool-sdk';

import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';
import {
  electrsUtxo, FakeNetwork, inputOutpoint, installLeatherSigner, outpointOf, sdkProviders,
  separateAddressLeatherWallet, settle, textOf,
} from '../funding-panel.spec-harness';
import { Cat21MintComponent } from './cat21-mint.component';

/** mempool's router-prefix pipe; identity here, the funding panel only reads the link target. */
@Pipe({ name: 'relativeUrl' })
class RelativeUrlStubPipe implements PipeTransform {
  transform(url: string): string { return url; }
}

/** Covers the mint at the fixture's fee rate, not at {@link RAISED_RATE}; the best fit, so it is also the recommendation. */
const SMALL = 3_000;
/** Covers the mint at both rates. */
const LARGE = 40_000;
/** A fee rate at which {@link SMALL} no longer covers the mint and {@link LARGE} still does; both asserted, never assumed. */
const RAISED_RATE = '100';

describe('Cat21MintComponent dropped selection (real ordpool-sdk)', () => {
  let net: FakeNetwork;
  let fixture: ComponentFixture<Cat21MintComponent>;
  let component: Cat21MintComponent;
  let wallet: WalletInfo;
  let leather: ReturnType<typeof installLeatherSigner>;
  const small = electrsUtxo('a', SMALL);
  const large = electrsUtxo('b', LARGE);
  const realFetch = globalThis.fetch;

  afterEach(() => {
    fixture?.destroy();
    leather?.uninstall();
    globalThis.fetch = realFetch;
  });

  /** Boot the page for a separate-address Leather wallet holding `coins`, all clean, and settle past scanning. */
  async function boot(coins: TxnOutput[]): Promise<void> {
    wallet = separateAddressLeatherWallet();
    leather = installLeatherSigner();
    net = new FakeNetwork();
    net.utxosByAddress.set(wallet.paymentAddress, coins);
    for (const c of coins) { net.scans.set(outpointOf(c), cleanOutputFixture()); }
    net.install();
    TestBed.configureTestingModule({
      declarations: [Cat21MintComponent],
      imports: [CommonModule, ReactiveFormsModule, FormsModule, RelativeUrlStubPipe],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        ...sdkProviders(wallet),
        { provide: StateService, useValue: { recommendedFees$: of(recommendedFeesFixture()) } },
        { provide: SeoService, useValue: { setTitle: () => undefined, setDescription: () => undefined } },
      ],
    }).overrideComponent(Cat21MintComponent, {
      set: { template: fs.readFileSync(path.join(__dirname, 'cat21-mint.component.html'), 'utf8') },
    });
    fixture = TestBed.createComponent(Cat21MintComponent);
    component = fixture.componentInstance;
    await settle(() => fixture.detectChanges(), () => component.fundingCta().kind === 'ready' && !component.utxoLoading());
  }

  const q = (sel: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(sel);
  const all = (sel: string): HTMLElement[] => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(sel));
  const mintButton = (): HTMLButtonElement => {
    const b = q('[data-testid="mint-cat-button"]');
    if (!(b instanceof HTMLButtonElement)) { throw new Error('mint button not rendered'); }
    return b;
  };

  /** The picker row of `coin`, found by the outpoint it prints. */
  function row(coin: TxnOutput): HTMLElement {
    const found = all('.shape-border').find((el) => textOf(el).includes(`UTXO ${outpointOf(coin)}`));
    if (!found) { throw new Error(`no picker row for ${outpointOf(coin)}`); }
    return found;
  }

  /** Click the Use button on `coin`'s row and let the SDK's recompute settle. */
  async function pick(coin: TxnOutput): Promise<void> {
    const use = Array.from(row(coin).querySelectorAll('button')).find((b) => textOf(b) === 'Use this UTXO');
    if (!use) { throw new Error(`no Use button on ${outpointOf(coin)}`); }
    use.click();
    await settle(() => fixture.detectChanges(), () => component.resolvedFundingCoin() !== null
      && outpointOf(component.resolvedFundingCoin() as TxnOutput) === outpointOf(coin));
  }

  /** Type `rate` into the fee input, as a person does. */
  function typeFeeRate(rate: string): void {
    const input = q('[data-testid="cat21-fee-rate"]');
    if (!(input instanceof HTMLInputElement)) { throw new Error('fee input not rendered'); }
    input.value = rate;
    input.dispatchEvent(new Event('input'));
  }

  /** The rows carrying the "you picked this coin" badge, by outpoint. */
  const pickedRows = (): string[] =>
    all('.shape-border').filter((el) => el.querySelector('[data-testid="utxo-picked"]')).map((el) => {
      const m = textOf(el).match(/UTXO ([0-9a-f]{64}:\d+)/);
      return m ? m[1] : '?';
    });

  describe('a pick the SDK still spends', () => {
    beforeEach(async () => {
      await boot([small, large]);
      await pick(large);
    });

    it('marks the picked row "you picked this coin", and only that row', () => {
      expect(pickedRows()).toEqual([outpointOf(large)]);
      expect(textOf(row(large).querySelector('[data-testid="utxo-picked"]'))).toBe('you picked this coin');
    });

    it('shows no dropped-selection notice', () => {
      expect(q('[data-testid="funding-dropped-selection"]')).toBeNull();
    });
  });

  describe('gone: the picked coin left the wallet', () => {
    beforeEach(async () => {
      await boot([small, large]);
      await pick(small);
      net.utxosByAddress.set(wallet.paymentAddress, [large]);
      component.retryFundingScan();
      await settle(() => fixture.detectChanges(), () => component.droppedSelection() !== null);
    });

    it('names the dropped coin, says it is no longer available, and names the coin the mint spends instead', () => {
      const notice = q('[data-testid="funding-dropped-selection"]');
      expect(notice?.getAttribute('data-reason')).toBe('gone');
      expect(textOf(notice)).toBe(
        `The coin you picked, ${outpointOf(small)}, is no longer available. Pick another coin under Choose a different funding source. ` +
        `Until you do, the mint spends ${outpointOf(large)} (40,000 sat).`,
      );
    });

    it('justifies the notice with the SDK\'s own record of the drop', () => {
      expect(component.droppedSelection()).toEqual({ txid: small.txid, vout: small.vout, reason: 'gone' });
      expect(textOf(q('[data-testid="funding-dropped-outpoint"]'))).toBe(outpointOf(small));
      expect(textOf(q('[data-testid="funding-resolved-outpoint"]'))).toBe(outpointOf(large));
    });

    it('marks no row "you picked this coin"', () => {
      expect(pickedRows()).toEqual([]);
    });

    it('a new pick clears the notice and marks the new coin', async () => {
      await pick(large);
      expect(q('[data-testid="funding-dropped-selection"]')).toBeNull();
      expect(pickedRows()).toEqual([outpointOf(large)]);
    });
  });

  describe('below-requirement: a raised fee rate leaves the picked coin short', () => {
    beforeEach(async () => {
      await boot([small, large]);
      await pick(small);
      expect(pickedRows()).toEqual([outpointOf(small)]);
      typeFeeRate(RAISED_RATE);
      await settle(() => fixture.detectChanges(), () => component.droppedSelection() !== null);
    });

    it('the raised rate is one at which the picked coin cannot fund the mint and the other coin can', () => {
      expect(row(small).querySelector('[data-testid="utxo-cant-fund"]')).not.toBeNull();
      expect(row(large).querySelector('[data-testid="utxo-cant-fund"]')).toBeNull();
    });

    it('names the dropped coin, says it no longer covers at this rate, and names the coin the mint spends instead', () => {
      const notice = q('[data-testid="funding-dropped-selection"]');
      expect(notice?.getAttribute('data-reason')).toBe('below-requirement');
      expect(textOf(notice)).toBe(
        `The coin you picked, ${outpointOf(small)}, no longer covers this mint at ${RAISED_RATE} sat/vB. ` +
        'Lower the fee rate, or pick another coin under Choose a different funding source. ' +
        `Until you do, the mint spends ${outpointOf(large)} (40,000 sat).`,
      );
    });

    it('marks no row "you picked this coin"', () => {
      expect(pickedRows()).toEqual([]);
    });

    it('lowering the rate again restores the pick: the notice goes, the badge returns', async () => {
      typeFeeRate(String(recommendedFeesFixture().fastestFee));
      await settle(() => fixture.detectChanges(), () => component.droppedSelection() === null);
      expect(q('[data-testid="funding-dropped-selection"]')).toBeNull();
      expect(pickedRows()).toEqual([outpointOf(small)]);
    });

    it('Mint spends the coin the notice names, not the dropped pick', async () => {
      expect(mintButton().disabled).toBe(false);
      mintButton().click();
      await settle(() => fixture.detectChanges(), () => net.broadcasts.length > 0 || component.mintCat21Error() !== '');

      expect(leather.requests.map((r) => inputOutpoint(r.psbt, r.signAtIndex))).toEqual([outpointOf(large)]);
      expect(net.broadcasts.length).toBe(1);
      const minted = btc.Transaction.fromRaw(hex.decode(net.broadcasts[0]));
      expect(`${hex.encode(minted.getInput(0).txid ?? new Uint8Array())}:${minted.getInput(0).index}`).toBe(outpointOf(large));
    });
  });
});
