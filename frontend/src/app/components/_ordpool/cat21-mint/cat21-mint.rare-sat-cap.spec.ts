/**
 * @test-kind unit
 * Real:   Cat21MintComponent with its production template; ordpool-sdk loaded for real and wired the way app.module.ts wires it (Cat21MintOrchestrator, UtxoContentScanner, Cat21Service, Cat21ApiService, WalletService)
 * Faked:  fetch: electrs /api/address/:a/utxo (electrsConfirmedUtxoFixture, ordpool-sdk/testing, captured), ord and cat21-ord /output (the SDK's cleanOutputFixture with its ord sat_ranges replaced by N common-sat ranges); WalletService storage; Leather's window.LeatherProvider; StateService.recommendedFees$ -> recommendedFeesFixture (ordpool-sdk); mempool's SeoService and relativeUrl pipe
 * Proves: through ordpool's own wiring of the pinned SDK, a clean coin with RARE_SAT_MAX_RANGES (500) sat ranges still funds the mint quietly, and the same coin with one range more is unknown content: the mint is not funded from it and the CTA stays disabled
 *
 * Seam for the SDK's rare-sat cap (audit B3). The SDK's own classifier spec
 * proves the classification; this proves what ordpool.space DOES with it on the
 * money path, which only a consumer can show. Load-bearing: do not drop it as a
 * duplicate of the SDK test.
 */
import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import { RARE_SAT_MAX_RANGES, cleanOutputFixture, recommendedFeesFixture, WalletInfo } from 'ordpool-sdk';

import { SeoService } from '../../../services/seo.service';
import { StateService } from '../../../services/state.service';
import {
  electrsUtxo, FakeNetwork, installLeatherSigner, outpointOf, sdkProviders, separateAddressLeatherWallet, settle,
} from '../funding-panel.spec-harness';
import { Cat21MintComponent } from './cat21-mint.component';
import { FundingAssetListComponent } from '../funding-asset-list/funding-asset-list.component';

/** mempool's router-prefix pipe; identity here, the funding panel only reads the link target. */
@Pipe({ name: 'relativeUrl' })
class RelativeUrlStubPipe implements PipeTransform {
  transform(url: string): string { return url; }
}

/**
 * The clean fixture with `n` one-sat ranges. They start one sat after the
 * fixture's own range, in the middle of a block (around block 200), so no
 * range holds a block's first sat: every sat is common, and the only thing
 * that changes between the two cases is the range count.
 */
function cleanCoinWithRanges(n: number) {
  const fixture = cleanOutputFixture();
  const base = fixture.ord.sat_ranges[0][0] + 1;
  fixture.ord.sat_ranges = Array.from({ length: n }, (_, i) => [base + i * 3, base + i * 3 + 1] as [number, number]);
  return fixture;
}

describe('Cat21MintComponent rare-sat cap (real ordpool-sdk)', () => {
  let net: FakeNetwork;
  let fixture: ComponentFixture<Cat21MintComponent>;
  let component: Cat21MintComponent;
  let wallet: WalletInfo;
  let leather: ReturnType<typeof installLeatherSigner>;
  const coin = electrsUtxo('c', 40_000);
  const realFetch = globalThis.fetch;

  afterEach(() => {
    fixture?.destroy();
    leather?.uninstall();
    globalThis.fetch = realFetch;
  });

  /** Boot the page for a separate-address Leather wallet holding one coin with `ranges` sat ranges; settle past scanning. */
  async function boot(ranges: number): Promise<void> {
    wallet = separateAddressLeatherWallet();
    leather = installLeatherSigner();
    net = new FakeNetwork();
    net.utxosByAddress.set(wallet.paymentAddress, [coin]);
    net.scans.set(outpointOf(coin), cleanCoinWithRanges(ranges));
    net.install();
    TestBed.configureTestingModule({
      declarations: [Cat21MintComponent, FundingAssetListComponent],
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
    await settle(() => fixture.detectChanges(), () => component.fundingCta().kind !== 'scanning' && !component.utxoLoading());
  }

  const mintButton = (): HTMLButtonElement => {
    const b = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="mint-cat-button"]');
    if (!(b instanceof HTMLButtonElement)) { throw new Error('mint button not rendered'); }
    return b;
  };

  it('the cap the boundary is drawn at is the SDK constant this spec names', () => {
    expect(RARE_SAT_MAX_RANGES).toBe(500);
  });

  it('a clean coin with exactly RARE_SAT_MAX_RANGES ranges funds the mint quietly: ready, CTA enabled', async () => {
    await boot(RARE_SAT_MAX_RANGES);
    expect(component.fundingCta().kind).toBe('ready');
    expect(mintButton().disabled).toBe(false);
  });

  it('the same coin with one range more is unknown content: never ready, CTA disabled', async () => {
    await boot(RARE_SAT_MAX_RANGES + 1);
    expect(component.fundingCta().kind).toBe('warning');
    expect(component.hasFundingSource()).toBe(false);
    expect(mintButton().disabled).toBe(true);
  });
});
