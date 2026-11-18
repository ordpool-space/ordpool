/**
 * @test-kind unit
 * Real:   InscribeMintComponent with its production template; ordpool-sdk loaded for real and wired the way app.module.ts wires it (InscribeMintOrchestrator, describeFundingPick, UtxoContentScanner, Cat21Service, Cat21ApiService, WalletService)
 * Faked:  fetch: electrs /api/address/:a/utxo (electrsConfirmedUtxoFixture, ordpool-sdk/testing, captured), ord and cat21-ord /output (the SDK's cleanOutputFixture); WalletService storage (a persisted LAST_CONNECTED_WALLET); Leather's window.LeatherProvider signPsbt (the { result: { hex } } shape the SDK's Leather signer reads, signing with the harness key); StateService.recommendedFees$ (the websocket feed) -> recommendedFeesFixture (ordpool-sdk); mempool's SeoService and relativeUrl pipe (upstream, not read by the funding panel)
 * Proves: "you picked this coin" shows only while the SDK still spends the pick; a pick the SDK drops (gone, or below the requirement at a raised fee rate) is named in a notice beside the coin the inscription spends instead; the first Inscribe click on a dropped pick is refused with nothing signed and the refusal shown, the pick is released, and the next click has the wallet sign a commit funded by the coin the panel names
 */
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import { cleanOutputFixture, inscribedOutputFixture, recommendedFeesFixture, TxnOutput, UtxoContentScanner, WalletInfo } from 'ordpool-sdk';

import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';
import {
  electrsUtxo, FakeNetwork, inputOutpoint, installLeatherSigner, outpointOf, sdkProviders,
  separateAddressLeatherWallet, settle, textOf,
} from '../funding-panel.spec-harness';
import { InscribeMintComponent } from './inscribe-mint.component';
import { FundingAssetListComponent } from '../funding-asset-list/funding-asset-list.component';

/** mempool's router-prefix pipe; identity here, the funding panel only reads the link target. */
@Pipe({ name: 'relativeUrl' })
class RelativeUrlStubPipe implements PipeTransform {
  transform(url: string): string { return url; }
}

/** Covers the inscription at the fixture's fee rate, not at {@link RAISED_RATE}; the best fit, so it is also the recommendation. */
const SMALL = 3_000;
/** Covers the inscription at both rates. */
const LARGE = 40_000;
/** A fee rate at which {@link SMALL} no longer covers the inscription and {@link LARGE} still does; both asserted, never assumed. */
const RAISED_RATE = '100';

describe('InscribeMintComponent dropped selection (real ordpool-sdk)', () => {
  let net: FakeNetwork;
  let fixture: ComponentFixture<InscribeMintComponent>;
  let component: InscribeMintComponent;
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
      declarations: [InscribeMintComponent, FundingAssetListComponent],
      imports: [CommonModule, ReactiveFormsModule, FormsModule, RelativeUrlStubPipe],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        ...sdkProviders(wallet),
        { provide: StateService, useValue: { recommendedFees$: of(recommendedFeesFixture()) } },
        { provide: SeoService, useValue: { setTitle: () => undefined, setDescription: () => undefined } },
      ],
    }).overrideComponent(InscribeMintComponent, {
      set: { template: fs.readFileSync(path.join(__dirname, 'inscribe-mint.component.html'), 'utf8') },
    });
    fixture = TestBed.createComponent(InscribeMintComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    pickFile();
    await settle(() => fixture.detectChanges(), () => component.fundingCta().kind === 'ready' && !component.utxoLoading());
  }

  /**
   * Choose a small PNG through the page's own file input: the inscribe funding
   * requirement is derived from the content, so there is no verdict before it.
   * jsdom's File has no arrayBuffer() and its input has no settable `files`, so
   * both are supplied here.
   */
  function pickFile(): void {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new File([bytes], 'cat.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(0) });
    const input = q('[data-testid="inscribe-file-input"]');
    if (!(input instanceof HTMLInputElement)) { throw new Error('file input not rendered'); }
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
  }

  const q = (sel: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(sel);
  /** The outpoint of the coin the SDK will spend, or null when there is none. */
  const resolvedOutpoint = (): string | null => {
    const c = component.resolvedFundingCoin();
    return c ? outpointOf(c) : null;
  };
  const all = (sel: string): HTMLElement[] => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(sel));
  const inscribeButton = (): HTMLButtonElement => {
    const b = q('[data-testid="inscribe-btn"]');
    if (!(b instanceof HTMLButtonElement)) { throw new Error('inscribe button not rendered'); }
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
    await settle(() => fixture.detectChanges(), () => resolvedOutpoint() === outpointOf(coin));
  }

  /** Type `rate` into the fee input, as a person does. */
  function typeFeeRate(rate: string): void {
    const input = q('[data-testid="inscribe-fee-rate"]');
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

  describe('the total line prices the coin the inscription spends', () => {
    it('shows before any pick, for the recommendation the SDK will spend', async () => {
      await boot([small, large]);
      const spends = component.resolvedFundingCoin();
      expect(`${spends?.txid}:${spends?.vout}`).toBe(outpointOf(small));
      expect(textOf(q('[data-testid="inscribe-total-cost"]'))).toMatch(/^You'll pay [\d,]+sat \(\) in total: miner fees plus the 546 sats your inscription lives on\.$/);
    });
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

    it('names the dropped coin, says it is no longer available, and names the coin the inscription spends instead', () => {
      const notice = q('[data-testid="funding-dropped-selection"]');
      expect(notice?.getAttribute('data-reason')).toBe('gone');
      expect(textOf(notice)).toBe(
        `The coin you picked, ${outpointOf(small)}, is no longer available. Pick another coin under Choose a different funding source. ` +
        `Until you do, the inscription spends ${outpointOf(large)} (40,000 sat).`,
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

    // The harness serves no package endpoint, so a signing flow ends at the
    // transport's first request; the pin is the coin the wallet signs away.
    it('Inscribe refuses the first click unsigned, releases the pick, and the next click signs the coin the panel names', async () => {
      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => component.fundingReconfirm() !== null && component.droppedSelection() === null);

      expect(leather.requests).toEqual([]);
      expect(textOf(q('[data-testid="inscribe-funding-reconfirm"]'))).toContain(`The selected funding UTXO ${outpointOf(small)} is no longer available.`);
      expect(q('[data-testid="funding-dropped-selection"]')).toBeNull();
      expect(resolvedOutpoint()).toBe(outpointOf(large));

      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => net.requested.includes('http://electrs.test/api/txs/test'));
      expect(leather.requests.map((r) => inputOutpoint(r.psbt, r.signAtIndex))).toEqual([outpointOf(large)]);
      expect(q('[data-testid="inscribe-funding-reconfirm"]')).toBeNull();
    });
  });

  // The recommendation is ord's best fit, the SMALLEST covering coin, so a
  // largest-first short list cuts it off first. The picker must show it and let
  // the reader pick it (audit F1, HQ money path: the picker shows the
  // recommendation and allows any override).
  describe('a wallet with more covering coins than a short list holds', () => {
    const many = Array.from({ length: 12 }, (_, i) => electrsUtxo(i.toString(16), 3_000 + i * 1_000));
    const shownOutpoints = (): string[] => all('.shape-border').map((el) => (textOf(el).match(/UTXO ([0-9a-f]{64}:\d+)/) ?? [])[1]);

    beforeEach(async () => { await boot(many); });

    it('the recommendation is the smallest coin, and its row is shown, badged and pickable', async () => {
      expect(resolvedOutpoint()).toBe(outpointOf(many[0]));
      expect(row(many[0]).querySelector('[data-testid="utxo-recommended"]')).not.toBeNull();
      await pick(many[0]);
      expect(pickedRows()).toEqual([outpointOf(many[0])]);
    });

    it('every covering coin is a row', () => {
      expect(shownOutpoints().sort()).toEqual(many.map(outpointOf).sort());
    });
  });

  // A pin is honoured only while its coin carries what was shown when it was
  // picked (SDK drop reason 'contents-changed'). The page names the drop and
  // why, and a click must not spend the coin until the reader picks again.
  describe('contents-changed: the picked coin now carries something that was not shown', () => {
    beforeEach(async () => {
      await boot([small, large]);
      await pick(small);
      expect(pickedRows()).toEqual([outpointOf(small)]);
      net.scans.set(outpointOf(small), inscribedOutputFixture());
      TestBed.inject(UtxoContentScanner).reset();
      component.retryFundingScan();
      await settle(() => fixture.detectChanges(), () => component.droppedSelection()?.reason === 'contents-changed');
    });

    it('names the dropped coin and says it now carries something that was not shown', () => {
      const notice = q('[data-testid="funding-dropped-selection"]');
      expect(notice?.getAttribute('data-reason')).toBe('contents-changed');
      expect(textOf(notice)).toBe(
        `The coin you picked, ${outpointOf(small)}, now carries something that was not shown when you picked it. ` +
        'Look at what it carries and pick a coin again under Choose a different funding source. ' +
        `Until you do, the inscription spends ${outpointOf(large)} (40,000 sat).`,
      );
    });

    it('Inscribe refuses the first click unsigned and says why, and the next click signs the coin the panel names', async () => {
      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => component.fundingReconfirm() !== null && component.droppedSelection() === null);
      expect(leather.requests).toEqual([]);

      expect(textOf(q('[data-testid="inscribe-funding-reconfirm"]'))).toContain(
        `The selected funding UTXO ${outpointOf(small)} now carries assets that were not shown when it was selected.`,
      );
      expect(resolvedOutpoint()).toBe(outpointOf(large));

      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => net.requested.includes('http://electrs.test/api/txs/test'));
      expect(leather.requests.map((r) => inputOutpoint(r.psbt, r.signAtIndex))).toEqual([outpointOf(large)]);
    });
  });

  // A coin pinned while its scan had failed, whose row "Retry scan" then finds
  // an inscription. The picker's own scan must make the orchestrator decide
  // again; a stale 'failed' verdict would keep honouring the pin, and the click
  // could spend an inscription nobody was shown.
  describe('a pinned coin whose failed scan is retried from its row', () => {
    /** The labelled button on coin's row, or undefined while the row is not rendered (the picker hides during a UTXO re-read). */
    const rowButton = (coin: TxnOutput, label: string): HTMLButtonElement | undefined => {
      const el = all('.shape-border').find((r) => textOf(r).includes(`UTXO ${outpointOf(coin)}`));
      return el ? Array.from(el.querySelectorAll('button')).find((b) => textOf(b) === label) : undefined;
    };

    beforeEach(async () => {
      await boot([small, large]);
      net.scans.set(outpointOf(small), 'ord-unavailable');
      TestBed.inject(UtxoContentScanner).reset();
      component.retryFundingScan();
      await settle(() => fixture.detectChanges(), () => rowButton(small, 'Retry scan') !== undefined);
      await pick(small);
      expect(pickedRows()).toEqual([outpointOf(small)]);

      net.scans.set(outpointOf(small), inscribedOutputFixture());
      const retry = rowButton(small, 'Retry scan');
      if (!retry) { throw new Error('no Retry scan on the pinned coin'); }
      retry.click();
      await settle(() => fixture.detectChanges(), () => component.droppedSelection()?.reason === 'contents-changed');
    });

    it('drops the pin as contents-changed and names it', () => {
      expect(q('[data-testid="funding-dropped-selection"]')?.getAttribute('data-reason')).toBe('contents-changed');
      expect(textOf(q('[data-testid="funding-dropped-outpoint"]'))).toBe(outpointOf(small));
      expect(pickedRows()).toEqual([]);
    });

    it('the next click signs nothing and asks again', async () => {
      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => component.fundingReconfirm() !== null);
      expect(leather.requests).toEqual([]);

      expect(textOf(q('[data-testid="inscribe-funding-reconfirm"]'))).toContain(
        `The selected funding UTXO ${outpointOf(small)} now carries assets that were not shown when it was selected.`,
      );
    });
  });

  // SEAM TEST, load-bearing: the SDK re-checks a pinned coin on a fresh scan
  // right before it asks for a signature (assertPinnedContentFresh). The SDK's
  // own suite proves that against its own scan port; only this page proves it
  // holds through ordpool's UtxoContentScanner wiring. The reader never retries
  // here: the pin was taken on a failed scan, ord now finds an inscription, and
  // the click itself must refuse.
  describe('a pinned coin whose failed scan is never retried, clicked while ord now finds an inscription', () => {
    beforeEach(async () => {
      await boot([small, large]);
      net.scans.set(outpointOf(small), 'ord-unavailable');
      TestBed.inject(UtxoContentScanner).reset();
      component.retryFundingScan();
      await settle(() => fixture.detectChanges(), () =>
        all('.shape-border').some((r) => textOf(r).includes(`UTXO ${outpointOf(small)}`) && textOf(r).includes('Retry scan')));
      await pick(small);
      expect(pickedRows()).toEqual([outpointOf(small)]);
      net.scans.set(outpointOf(small), inscribedOutputFixture());
    });

    it('the click signs and broadcasts nothing, says why, and the panel names the drop', async () => {
      expect(component.droppedSelection()).toBeNull();
      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => component.fundingReconfirm() !== null);

      expect(leather.requests).toEqual([]);
      expect(net.broadcasts).toEqual([]);
      expect(textOf(q('[data-testid="inscribe-funding-reconfirm"]'))).toContain(
        `The selected funding UTXO ${outpointOf(small)} now carries assets that were not shown when it was selected.`,
      );
      expect(resolvedOutpoint()).not.toBe(outpointOf(small));
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

    it('the raised rate is one at which the picked coin cannot fund the inscription and the other coin can', () => {
      expect(row(small).querySelector('[data-testid="utxo-cant-fund"]')).not.toBeNull();
      expect(row(large).querySelector('[data-testid="utxo-cant-fund"]')).toBeNull();
    });

    it('names the dropped coin, says it no longer covers at this rate, and names the coin the inscription spends instead', () => {
      const notice = q('[data-testid="funding-dropped-selection"]');
      expect(notice?.getAttribute('data-reason')).toBe('below-requirement');
      expect(textOf(notice)).toBe(
        `The coin you picked, ${outpointOf(small)}, no longer covers this inscription at ${RAISED_RATE} sat/vB. ` +
        'Lower the fee rate, or pick another coin under Choose a different funding source. ' +
        `Until you do, the inscription spends ${outpointOf(large)} (40,000 sat).`,
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

    // The SDK refuses a click while the dropped pick is still pinned
    // (FundingSelectionChangedError), so nothing is signed for a coin the reader
    // never confirmed. The page releases the pin; the wallet then signs a commit
    // funded by the coin the notice names, and never by the dropped pick.
    it('Inscribe refuses the first click unsigned, releases the pick, and the next click signs the coin the notice names', async () => {
      expect(inscribeButton().disabled).toBe(false);
      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => component.fundingReconfirm() !== null && component.droppedSelection() === null);

      expect(leather.requests).toEqual([]);
      expect(textOf(q('[data-testid="inscribe-funding-reconfirm"]'))).toContain(
        `The selected funding UTXO ${outpointOf(small)} no longer covers this action at the current fee rate.`,
      );
      expect(resolvedOutpoint()).toBe(outpointOf(large));

      inscribeButton().click();
      await settle(() => fixture.detectChanges(), () => net.requested.includes('http://electrs.test/api/txs/test'));
      expect(leather.requests.map((r) => inputOutpoint(r.psbt, r.signAtIndex))).toEqual([outpointOf(large)]);
    });
  });
});
