import { InjectionToken } from '@angular/core';
import { Cat21SdkConfig, Network } from 'ordpool-sdk';

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
