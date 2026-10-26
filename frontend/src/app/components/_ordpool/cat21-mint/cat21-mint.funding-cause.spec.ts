/**
 * @test-kind unit
 * Real:   Cat21MintComponent with its production template; ordpool-sdk loaded for real and wired the way app.module.ts wires it (Cat21MintOrchestrator, UtxoContentScanner, Cat21Service, Cat21ApiService, WalletService, recommendFunding, expertRequiredCause)
 * Faked:  fetch: electrs /api/address/:a/utxo (electrsConfirmedUtxoFixture, ordpool-sdk/testing, captured) and POST /api/tx (the txid as text, esplora API.md), ord and cat21-ord /output (the SDK's inscribedOutputFixture / cleanOutputFixture, or HTTP 503 for a failed scan); WalletService storage (a persisted LAST_CONNECTED_WALLET); Leather's window.LeatherProvider signPsbt (the { result: { hex } } shape the SDK's Leather signer reads, signing with the harness key); StateService.recommendedFees$ (the websocket feed) -> recommendedFeesFixture (ordpool-sdk); the `fundingContentScan` port, in the unnamed-assets cases only, answering the bare 'has-assets' a ContentScanPort may return (ports.ts UtxoClassification) and the real scanner never does; mempool's SeoService and relativeUrl pipe (upstream, not read by the funding panel)
 * Proves: the expert-required warning says which of the SDK's three causes blocks the mint while the CTA stays disabled; the recommended badge and the total line appear only for a recommendation the mint may spend; on asset-notice, Mint spends the recommended asset coin the notice names
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

import { cleanOutputFixture, ContentScanPort, inscribedOutputFixture, recommendedFeesFixture, TxnOutput, WalletInfo } from 'ordpool-sdk';

import { fundingContentScan } from '@app/services/ordinals/sdk-tokens';
import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';
import {
  CoinScan, electrsUtxo, FakeNetwork, inputOutpoint, installLeatherSigner, oneAddressWallet, outpointOf, sdkProviders,
  separateAddressLeatherWallet, separateAddressWallet, settle, textOf,
} from '../funding-panel.spec-harness';
import { Cat21MintComponent } from './cat21-mint.component';

/** mempool's router-prefix pipe; identity here, the funding panel only reads the link target. */
@Pipe({ name: 'relativeUrl' })
class RelativeUrlStubPipe implements PipeTransform {
  transform(url: string): string { return url; }
}

const INSCRIPTION_ID = 'c'.repeat(64) + 'i0';

/** The three warning texts, as a reader sees them. */
const NAMED_ASSETS_TEXT =
  'We found funds, but every coin big enough to cover the fee also carries an asset ' +
  '(an inscription, rune, rare sat, or cat). Minting with one would send that asset to the ' +
  "miner as fee, so we won't auto-select it. The best fit carries: " +
  `Inscription: ${INSCRIPTION_ID} ` +
  "Open Choose a different funding source below and pick a coin yourself if you're sure it is safe to spend. 😼";
const UNNAMED_ASSETS_TEXT =
  'We found funds, but a coin that covers the fee carries something the scan could not ' +
  "identify. Minting with it could send that to the miner as fee, so we won't auto-select it. " +
  "Open Choose a different funding source below and pick a coin yourself if you're sure it is safe to spend. 😼";
const UNKNOWN_CONTENT_TEXT =
  "We found funds, but we couldn't check what the coins big enough to cover the fee are " +
  'carrying, because the scan got no answer. An unchecked coin can hold an inscription, rune, ' +
  'rare sat, or cat, and minting with it would send that to the miner as fee, so we won\'t ' +
  'auto-select it. Retry scan, or open Choose a different funding source ' +
  "below and pick a coin yourself if you're sure it is safe to spend. 😼";

/**
 * The total line for a priced coin. The figure is the SDK's simulation; the
 * fiat half is mempool's <app-fiat>, not rendered in this harness. Angular
 * drops whitespace-only text between elements, so figure and unit touch in
 * textContent.
 */
const TOTAL_LINE = /^You'll pay \d+sat \(\) in total: miner fees plus the 546 sat your cat lives on\.$/;

/** Covers the mint at the fixture's fee rate, and is at or below the auto-scan ceiling, so the row is scanned too. */
const COVERING_SCANNED = 20_000;
/** Covers the mint and is above the auto-scan ceiling, so only the funding port classifies it. */
const COVERING_UNSCANNED = 60_000;

describe('Cat21MintComponent funding causes (real ordpool-sdk)', () => {
  let net: FakeNetwork;
  let fixture: ComponentFixture<Cat21MintComponent>;
  let component: Cat21MintComponent;
  const realFetch = globalThis.fetch;

  afterEach(() => {
    fixture?.destroy();
    globalThis.fetch = realFetch;
  });

  /**
   * Boot the page for `wallet` holding one `coin` whose two `/output` reads
   * answer `scan`, registered before the page reads anything, and settle the
   * funding panel past scanning. `scanPort` replaces the orchestrator's
   * funding port for the unnamed-assets cases.
   */
  async function boot(wallet: WalletInfo, coin: TxnOutput, scan: CoinScan | null, scanPort?: ContentScanPort): Promise<void> {
    net = new FakeNetwork();
    net.utxosByAddress.set(wallet.paymentAddress, [coin]);
    if (scan) { net.scans.set(outpointOf(coin), scan); }
    net.install();
    TestBed.configureTestingModule({
      declarations: [Cat21MintComponent],
      imports: [CommonModule, ReactiveFormsModule, FormsModule, RelativeUrlStubPipe],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        ...sdkProviders(wallet),
        ...(scanPort ? [{ provide: fundingContentScan, useValue: scanPort }] : []),
        { provide: StateService, useValue: { recommendedFees$: of(recommendedFeesFixture()) } },
        { provide: SeoService, useValue: { setTitle: () => undefined, setDescription: () => undefined } },
      ],
    }).overrideComponent(Cat21MintComponent, {
      set: { template: fs.readFileSync(path.join(__dirname, 'cat21-mint.component.html'), 'utf8') },
    });
    fixture = TestBed.createComponent(Cat21MintComponent);
    component = fixture.componentInstance;
    await settle(() => fixture.detectChanges(), () => component.fundingCta().kind !== 'scanning' && !component.utxoLoading());
  }

  const q = (sel: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(sel);
  const mintButton = (): HTMLButtonElement => {
    const b = q('[data-testid="mint-cat-button"]');
    if (!(b instanceof HTMLButtonElement)) { throw new Error('mint button not rendered'); }
    return b;
  };

  // A port that only knows yes-or-no: valid per the SDK's UtxoClassification,
  // and the only way an asset coin reaches the policy without its names.
  const bareHasAssetsPort = (outpoint: string): ContentScanPort => ({
    classify: async (o: string) => {
      if (o !== outpoint) { throw new Error(`unexpected classify(${o})`); }
      return 'has-assets';
    },
  });

  describe('named-assets: a one-address wallet whose only covering coin carries a named inscription', () => {
    beforeEach(async () => {
      await boot(oneAddressWallet(), electrsUtxo('a', COVERING_SCANNED), inscribedOutputFixture(INSCRIPTION_ID));
    });

    it('renders the named-assets warning, naming the inscription, with the CTA disabled', () => {
      const warning = q('[data-testid="funding-warning"]');
      expect(warning?.getAttribute('data-cause')).toBe('named-assets');
      expect(textOf(warning)).toBe(NAMED_ASSETS_TEXT);
      expect(mintButton().disabled).toBe(true);
    });

    it('justifies the block: the warning names what the coin carries', () => {
      expect(textOf(q('[data-testid="funding-warning-assets"]'))).toBe(`Inscription: ${INSCRIPTION_ID}`);
    });

    it('does not mark the blocked coin as recommended, nor price it as the total', () => {
      expect(q('[data-testid="utxo-recommended"]')).toBeNull();
      expect(q('[data-testid="mint-total-cost"]')).toBeNull();
      expect(textOf(q('.utxo-bucket-badge'))).toBe('⚠ asset found');
    });
  });

  describe('unnamed-assets: the port says has-assets and names nothing', () => {
    it('renders the unnamed-assets warning with the CTA disabled, on a separate-address wallet', async () => {
      const coin = electrsUtxo('b', COVERING_UNSCANNED);
      await boot(separateAddressWallet(), coin, null, bareHasAssetsPort(outpointOf(coin)));
      const warning = q('[data-testid="funding-warning"]');
      expect(warning?.getAttribute('data-cause')).toBe('unnamed-assets');
      expect(textOf(warning)).toBe(UNNAMED_ASSETS_TEXT);
      expect(mintButton().disabled).toBe(true);
    });

    it('justifies the block: the warning says the scan could not identify what the coin carries', async () => {
      const coin = electrsUtxo('b', COVERING_UNSCANNED);
      await boot(oneAddressWallet(), coin, null, bareHasAssetsPort(outpointOf(coin)));
      expect(textOf(q('[data-testid="funding-warning"]'))).toContain('carries something the scan could not identify');
    });

    it('does not mark the blocked coin as recommended, nor price it as the total', async () => {
      const coin = electrsUtxo('b', COVERING_UNSCANNED);
      await boot(separateAddressWallet(), coin, null, bareHasAssetsPort(outpointOf(coin)));
      expect(q('[data-testid="utxo-recommended"]')).toBeNull();
      expect(q('[data-testid="mint-total-cost"]')).toBeNull();
    });
  });

  describe('unknown-content: the only covering coin\'s scan fails', () => {
    it('blocks a SEPARATE-address wallet too: unknown-content warning, CTA disabled', async () => {
      const coin = electrsUtxo('d', COVERING_SCANNED);
      await boot(separateAddressWallet(), coin, 'ord-unavailable');
      const warning = q('[data-testid="funding-warning"]');
      expect(warning?.getAttribute('data-cause')).toBe('unknown-content');
      expect(textOf(warning)).toBe(UNKNOWN_CONTENT_TEXT);
      expect(mintButton().disabled).toBe(true);
    });

    it('renders the same warning on a one-address wallet', async () => {
      const coin = electrsUtxo('d', COVERING_SCANNED);
      await boot(oneAddressWallet(), coin, 'ord-unavailable');
      expect(textOf(q('[data-testid="funding-warning"]'))).toBe(UNKNOWN_CONTENT_TEXT);
      expect(mintButton().disabled).toBe(true);
    });

    it('justifies the block: the warning says the scan got no answer and offers the retry', async () => {
      const coin = electrsUtxo('d', COVERING_SCANNED);
      await boot(separateAddressWallet(), coin, 'ord-unavailable');
      expect(textOf(q('[data-testid="funding-warning"]'))).toContain('because the scan got no answer');
      expect(textOf(q('[data-testid="funding-warning-retry"]'))).toBe('Retry scan');
    });

    it('does not mark the blocked coin as recommended, nor price it as the total', async () => {
      const coin = electrsUtxo('d', COVERING_SCANNED);
      await boot(separateAddressWallet(), coin, 'ord-unavailable');
      expect(q('[data-testid="utxo-recommended"]')).toBeNull();
      expect(q('[data-testid="mint-total-cost"]')).toBeNull();
      expect(textOf(q('.utxo-bucket-badge'))).toBe('scan failed');
    });

    it('Retry scan re-decides once ord answers: the coin is clean, recommended, priced, and the CTA enables', async () => {
      const coin = electrsUtxo('d', COVERING_SCANNED);
      await boot(separateAddressWallet(), coin, 'ord-unavailable');
      net.scans.set(outpointOf(coin), cleanOutputFixture());
      const retry = q('[data-testid="funding-warning-retry"]');
      if (!retry) { throw new Error('Retry scan not rendered in the warning'); }
      retry.click();
      await settle(() => fixture.detectChanges(), () => component.fundingCta().kind === 'ready');
      expect(mintButton().disabled).toBe(false);
      expect(textOf(q('[data-testid="utxo-recommended"]'))).toBe('recommended');
      expect(textOf(q('[data-testid="mint-total-cost"]'))).toMatch(TOTAL_LINE);
    });
  });

  describe('an actionable recommendation keeps its marker and its total', () => {
    it('auto: a clean covering coin is marked recommended and priced, CTA enabled, no warning', async () => {
      const coin = electrsUtxo('e', COVERING_SCANNED);
      await boot(oneAddressWallet(), coin, cleanOutputFixture());
      expect(component.fundingCta().kind).toBe('ready');
      expect(textOf(q('[data-testid="utxo-recommended"]'))).toBe('recommended');
      expect(q('[data-testid="utxo-recommended"]')?.getAttribute('title'))
        .toBe("The safest, best-fit coin we'd pay with automatically. You can still pick another.");
      expect(textOf(q('[data-testid="mint-total-cost"]'))).toMatch(TOTAL_LINE);
      expect(mintButton().disabled).toBe(false);
    });

    it('asset-notice: a named-asset coin on a separate-address wallet is marked recommended and priced, CTA enabled', async () => {
      const coin = electrsUtxo('f', COVERING_SCANNED);
      await boot(separateAddressWallet(), coin, inscribedOutputFixture(INSCRIPTION_ID));
      expect(component.fundingCta().kind).toBe('notice');
      expect(textOf(q('[data-testid="utxo-recommended"]'))).toBe('recommended');
      expect(textOf(q('[data-testid="mint-total-cost"]'))).toMatch(TOTAL_LINE);
      expect(mintButton().disabled).toBe(false);
    });
  });

  describe('asset-notice proceeds: Mint spends the coin the notice names', () => {
    let leather: ReturnType<typeof installLeatherSigner>;
    afterEach(() => leather.uninstall());

    it('a separate-address wallet whose only covering coin carries a named inscription signs and broadcasts a mint spending that coin', async () => {
      leather = installLeatherSigner();
      const coin = electrsUtxo('f', COVERING_SCANNED);
      await boot(separateAddressLeatherWallet(), coin, inscribedOutputFixture(INSCRIPTION_ID));
      expect(component.fundingCta().kind).toBe('notice');
      expect(textOf(q('.alert.alert-warning'))).toContain(`Inscription: ${INSCRIPTION_ID}`);

      mintButton().click();
      await settle(() => fixture.detectChanges(), () => net.broadcasts.length > 0 || component.mintCat21Error() !== '');

      expect(leather.requests.map((r) => inputOutpoint(r.psbt, r.signAtIndex))).toEqual([outpointOf(coin)]);
      expect(net.broadcasts.length).toBe(1);
      const minted = btc.Transaction.fromRaw(hex.decode(net.broadcasts[0]));
      expect(`${hex.encode(minted.getInput(0).txid ?? new Uint8Array())}:${minted.getInput(0).index}`).toBe(outpointOf(coin));
      expect(minted.lockTime).toBe(21);
      await settle(() => fixture.detectChanges(), () => component.mintCat21Success() !== undefined);
      expect(component.mintCat21Success()).toEqual({ txId: minted.id });
      expect(textOf(q('.alert.alert-success'))).toContain('Your CAT-21 transaction has now been submitted to the mempool.');
    });
  });
});
