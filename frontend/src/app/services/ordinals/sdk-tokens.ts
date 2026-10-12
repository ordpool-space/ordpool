import { inject, InjectionToken } from '@angular/core';
import { Cat21SdkConfig, ContentScanPort, Network, UtxoContentScanner } from 'ordpool-sdk';

/**
 * App-local DI tokens for the SDK's runtime config + network.
 *
 * The SDK is framework-agnostic — its services are plain classes taking
 * their config in the constructor. These tokens are ordpool's OWN wiring:
 * they carry the config values (provided in `app.module.ts`) so components
 * can `inject()` them like anything else, and the service factory
 * providers read them to construct the SDK classes.
 */
export const cat21Config = new InjectionToken<Cat21SdkConfig>('cat21Config');
export const bitcoinNetwork = new InjectionToken<Network>('bitcoinNetwork');

/**
 * The `ContentScanPort` the mint and inscribe orchestrators classify funding
 * coins with. Resolves to the root `UtxoContentScanner`, so the orchestrator's
 * force-scan and the picker's row badges share one per-outpoint cache and hit
 * our ord instances once per coin. A port of its own because the orchestrators
 * take any `ContentScanPort`, and a spec drives the answers the scanner cannot
 * produce (a bare `'has-assets'`) through it.
 */
export const fundingContentScan = new InjectionToken<ContentScanPort>('fundingContentScan', {
  providedIn: 'root',
  factory: () => inject(UtxoContentScanner),
});
