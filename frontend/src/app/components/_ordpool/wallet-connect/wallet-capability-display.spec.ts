/**
 * Unit tests for the wallet-capability display layer.
 *
 * The SUT is this presentation helper; its collaborator is the SDK matrix
 * (`capabilityOf` / `walletMatrixEntry` + the enums). We mock that module
 * boundary with a small controlled matrix so the tests pin the MAPPING
 * (support -> icon / wording, capability ordering, caveat + note
 * pass-through, the null branch) deterministically, independent of the
 * real curated data (which the SDK's own wallet-capabilities.spec covers).
 * Mocking the collaborator also dodges the sats-connect ESM chain the real
 * bundle pulls in, exactly as the sibling cat21-mint spec does.
 */

jest.mock('ordpool-sdk', () => {
  const CapabilitySupport = {
    Proven: 'proven',
    Adapter: 'adapter',
    Unsupported: 'unsupported',
  } as const;
  const WalletCapability = {
    Cat21Mint: 'cat21-mint',
    Cat21Transfer: 'cat21-transfer',
    Cat21OfferCreate: 'cat21-offer-create',
    Cat21OfferAccept: 'cat21-offer-accept',
    Inscription: 'inscription',
    InscriptionParentChild: 'inscription-parent-child',
    SignMessage: 'sign-message',
  } as const;
  const WalletPlatform = { Desktop: 'desktop', Mobile: 'mobile' } as const;
  const KnownOrdinalWalletType = {
    xverse: 'xverse',
    alby: 'alby',
    xpub: 'xpub',
  } as const;

  const all = (support: string) => ({
    'cat21-mint': { support },
    'cat21-transfer': { support },
    'cat21-offer-create': { support },
    'cat21-offer-accept': { support },
    inscription: { support },
    'inscription-parent-child': { support },
    'sign-message': { support },
  });

  const MATRIX: Record<string, any> = {
    xverse: {
      wallet: 'xverse',
      label: 'Xverse',
      platforms: ['desktop', 'mobile'],
      signingMode: 'injected',
      capabilities: { ...all('proven'), 'sign-message': { support: 'adapter' } },
      note: 'xverse note',
    },
    alby: {
      wallet: 'alby',
      label: 'Alby',
      platforms: ['desktop'],
      signingMode: 'injected',
      capabilities: {
        'cat21-mint': { support: 'proven' },
        'cat21-transfer': { support: 'proven' },
        'cat21-offer-create': { support: 'unsupported', caveat: 'signs every input' },
        'cat21-offer-accept': { support: 'unsupported', caveat: 'signs every input' },
        inscription: { support: 'proven' },
        'inscription-parent-child': { support: 'unsupported', caveat: 'no per-input selection' },
        'sign-message': { support: 'unsupported' },
      },
      note: 'alby note',
    },
    xpub: {
      wallet: 'xpub',
      label: 'Watch-only (xpub)',
      platforms: ['desktop', 'mobile'],
      signingMode: 'watch-only',
      capabilities: { ...all('proven'), 'sign-message': { support: 'unsupported' } },
      note: 'xpub note',
    },
  };

  return {
    CapabilitySupport,
    WalletCapability,
    WalletPlatform,
    KnownOrdinalWalletType,
    // F2 single source of truth for the watch-only example wallet list.
    KnownOrdinalWallets: { xpub: { subLabel: 'Sparrow, Coldcard, Ledger, …' } },
    walletMatrixEntry: (w: string) => MATRIX[w],
    capabilityOf: (w: string, c: string) =>
      MATRIX[w]?.capabilities?.[c] ?? { support: 'unsupported' },
  };
});

import { CapabilitySupport, KnownOrdinalWalletType, WalletCapability, WalletPlatform } from 'ordpool-sdk';
import {
  buildCapabilityRow,
  buildWalletInfoPopover,
  CAPABILITY_DISPLAY_NAME,
  CAPABILITY_ORDER,
  platformBadges,
  signingModeLine,
  supportIcon,
  supportWording,
} from './wallet-capability-display';

describe('wallet-capability-display', () => {

  it('CAPABILITY_ORDER lists all seven capabilities, mint first, each with a display name', () => {
    expect(CAPABILITY_ORDER).toHaveLength(7);
    expect(CAPABILITY_ORDER[0]).toBe(WalletCapability.Cat21Mint);
    expect(new Set(CAPABILITY_ORDER).size).toBe(7);
    for (const c of CAPABILITY_ORDER) {
      expect(CAPABILITY_DISPLAY_NAME[c]).toBeTruthy();
    }
  });

  it('supportIcon maps each level to the shared-spec glyph', () => {
    expect(supportIcon(CapabilitySupport.Proven)).toBe('✓');
    expect(supportIcon(CapabilitySupport.Adapter)).toBe('○');
    expect(supportIcon(CapabilitySupport.Unsupported)).toBe('✕');
  });

  it('supportWording maps each level to the shared-spec wording', () => {
    expect(supportWording(CapabilitySupport.Proven)).toBe('Verified end-to-end on our test network');
    expect(supportWording(CapabilitySupport.Adapter)).toBe('Supported, not yet verified end-to-end');
    expect(supportWording(CapabilitySupport.Unsupported)).toBe('Not available with this wallet');
  });

  it('signingModeLine distinguishes injected from watch-only', () => {
    expect(signingModeLine('injected')).toBe('Signs in your browser');
    expect(signingModeLine('watch-only')).toContain('You sign in your own wallet');
  });

  it('platformBadges renders Desktop before Mobile', () => {
    expect(platformBadges([WalletPlatform.Mobile, WalletPlatform.Desktop])).toEqual(['Desktop', 'Mobile']);
    expect(platformBadges([WalletPlatform.Desktop])).toEqual(['Desktop']);
    expect(platformBadges([])).toEqual([]);
  });

  it('buildCapabilityRow carries icon, wording, support and caveat', () => {
    const mint = buildCapabilityRow(KnownOrdinalWalletType.xverse, WalletCapability.Cat21Mint);
    expect(mint).toMatchObject({ name: 'Mint a cat', icon: '✓', support: CapabilitySupport.Proven });
    expect(mint.caveat).toBeUndefined();

    const albyOffer = buildCapabilityRow(KnownOrdinalWalletType.alby, WalletCapability.Cat21OfferCreate);
    expect(albyOffer.icon).toBe('✕');
    expect(albyOffer.support).toBe(CapabilitySupport.Unsupported);
    expect(albyOffer.caveat).toBe('signs every input');
  });

  it('buildWalletInfoPopover assembles the full structure for an injected wallet', () => {
    const vm = buildWalletInfoPopover(KnownOrdinalWalletType.xverse, WalletCapability.Cat21Mint);
    expect(vm).not.toBeNull();
    expect(vm?.label).toBe('Xverse');
    expect(vm?.platformBadges).toEqual(['Desktop', 'Mobile']);
    expect(vm?.signingModeLine).toBe('Signs in your browser');
    expect(vm?.action.capability).toBe(WalletCapability.Cat21Mint);
    expect(vm?.action.icon).toBe('✓');
    expect(vm?.capabilities).toHaveLength(7);
    expect(vm?.capabilities.map((c) => c.capability)).toEqual([...CAPABILITY_ORDER]);
    expect(vm?.note).toBe('xverse note');
  });

  it('surfaces an Unsupported capability with its caveat in the full list', () => {
    const vm = buildWalletInfoPopover(KnownOrdinalWalletType.alby, WalletCapability.Cat21Mint);
    expect(vm?.action.icon).toBe('✓'); // Alby CAN mint
    const offer = vm?.capabilities.find((c) => c.capability === WalletCapability.Cat21OfferCreate);
    expect(offer?.icon).toBe('✕');
    expect(offer?.caveat).toBe('signs every input');
  });

  it('renders the watch-only signing line for the xpub row', () => {
    const vm = buildWalletInfoPopover(KnownOrdinalWalletType.xpub, WalletCapability.Cat21Mint);
    expect(vm?.signingModeLine).toContain('You sign in your own wallet');
    expect(vm?.action.icon).toBe('✓');
  });

  it('returns null for a wallet the SDK ships no matrix row for', () => {
    expect(buildWalletInfoPopover('nope' as KnownOrdinalWalletType, WalletCapability.Cat21Mint)).toBeNull();
  });
});
