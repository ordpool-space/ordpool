import {
  CapabilitySupport,
  KnownOrdinalWallets,
  KnownOrdinalWalletType,
  WalletCapability,
  WalletMatrixEntry,
  WalletPlatform,
  capabilityOf,
  walletMatrixEntry,
} from 'ordpool-sdk';

/**
 * Presentation layer over the SDK wallet-capability matrix.
 *
 * The SDK owns the wallet FACTS (support level, caveat, platform, note);
 * this file owns the user-facing WORDING for ordpool.space. The wording,
 * icon semantics, capability display names and popover structure here are
 * the binding shared spec (`wallet-picker-ux-shared.md`): identical
 * across cat21.space, ordpool.space and cubes, so an SDK matrix update
 * changes every site at once and never gets contradicted by a hardcoded
 * wallet fact in a template.
 */

/** Fixed display order for the "everything this wallet can do here" list. */
export const CAPABILITY_ORDER: readonly WalletCapability[] = [
  WalletCapability.Cat21Mint,
  WalletCapability.Cat21Transfer,
  WalletCapability.Cat21OfferCreate,
  WalletCapability.Cat21OfferAccept,
  WalletCapability.Inscription,
  WalletCapability.InscriptionParentChild,
  WalletCapability.SignMessage,
];

/** Capability -> user-facing action name (shared spec table). */
export const CAPABILITY_DISPLAY_NAME: Record<WalletCapability, string> = {
  [WalletCapability.Cat21Mint]: 'Mint a cat',
  [WalletCapability.Cat21Transfer]: 'Send a cat',
  [WalletCapability.Cat21OfferCreate]: 'Sell (create an offer)',
  [WalletCapability.Cat21OfferAccept]: 'Buy (accept an offer)',
  [WalletCapability.Inscription]: 'Inscribe',
  [WalletCapability.InscriptionParentChild]: 'Collections (parent/child)',
  [WalletCapability.SignMessage]: 'Sign a message',
};

/** Support level -> status glyph (shared spec table). */
export function supportIcon(support: CapabilitySupport): string {
  switch (support) {
    case CapabilitySupport.Proven:
      return '✓';
    case CapabilitySupport.Adapter:
      return '○';
    case CapabilitySupport.Unsupported:
      return '✕';
  }
}

/** Support level -> base wording (shared spec table). The caveat, when
 *  present, is rendered separately as a follow-on sentence. */
export function supportWording(support: CapabilitySupport): string {
  switch (support) {
    case CapabilitySupport.Proven:
      return 'Verified end-to-end on our test network';
    case CapabilitySupport.Adapter:
      return 'Supported, not yet verified end-to-end';
    case CapabilitySupport.Unsupported:
      return 'Not available with this wallet';
  }
}

/** signingMode -> one-line explanation (shared spec table). The example wallet
 *  list is a matrix fact (single source of truth: the xpub subLabel), never
 *  hardcoded here; only the sentence frame is ours. */
export function signingModeLine(mode: WalletMatrixEntry['signingMode']): string {
  if (mode !== 'watch-only') {
    return 'Signs in your browser';
  }
  const examples = KnownOrdinalWallets[KnownOrdinalWalletType.xpub].subLabel ?? '';
  return `You sign in your own wallet (${examples})`;
}

/** Platform enum values -> human badges, in Desktop, Mobile order. */
export function platformBadges(platforms: readonly WalletPlatform[]): string[] {
  const badges: string[] = [];
  if (platforms.includes(WalletPlatform.Desktop)) {
    badges.push('Desktop');
  }
  if (platforms.includes(WalletPlatform.Mobile)) {
    badges.push('Mobile');
  }
  return badges;
}

/** One capability's status for a wallet, ready to render. */
export interface CapabilityRow {
  capability: WalletCapability;
  /** User-facing action name. */
  name: string;
  /** Status glyph (✓ / ○ / ✕). */
  icon: string;
  support: CapabilitySupport;
  /** Base wording for the support level. */
  wording: string;
  /** Actionable constraint, if the matrix declares one. */
  caveat?: string;
}

/** Everything the info popover renders for one wallet, structure per the
 *  shared spec: header, this-action status, full capability list, footer. */
export interface WalletInfoPopover {
  label: string;
  platformBadges: string[];
  signingModeLine: string;
  /** The current page action's status (Cat21Mint on the mint page). */
  action: CapabilityRow;
  /** All seven capabilities in {@link CAPABILITY_ORDER}. */
  capabilities: CapabilityRow[];
  /** Wallet-level note, verbatim from the matrix. */
  note?: string;
}

/** Build one {@link CapabilityRow} for a wallet + capability. */
export function buildCapabilityRow(
  wallet: KnownOrdinalWalletType,
  capability: WalletCapability,
): CapabilityRow {
  const status = capabilityOf(wallet, capability);
  return {
    capability,
    name: CAPABILITY_DISPLAY_NAME[capability],
    icon: supportIcon(status.support),
    support: status.support,
    wording: supportWording(status.support),
    caveat: status.caveat,
  };
}

/**
 * Assemble the full info-popover view-model for a wallet, given the page's
 * current action. Returns null for a wallet the SDK ships no matrix row for
 * (nothing to explain).
 */
export function buildWalletInfoPopover(
  wallet: KnownOrdinalWalletType,
  action: WalletCapability,
): WalletInfoPopover | null {
  const entry = walletMatrixEntry(wallet);
  if (!entry) {
    return null;
  }
  return {
    label: entry.label,
    platformBadges: platformBadges(entry.platforms),
    signingModeLine: signingModeLine(entry.signingMode),
    action: buildCapabilityRow(wallet, action),
    capabilities: CAPABILITY_ORDER.map((c) => buildCapabilityRow(wallet, c)),
    note: entry.note,
  };
}
