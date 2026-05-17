import { Injectable, OnDestroy } from '@angular/core';
import { fromEvent, Subscription, timer } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '@environments/environment';

import {
  OtsLocalStamp,
  OtsStoreService,
  bytesToBase64,
} from './ots-store.service';

/*
Test cases:
- Tab visible with 1 queued stamp: GET /timestamp/<hash> for each calendar
  every 60s, until any one returns 200; mark stamp as 'ready'.
- Tab hidden: polling pauses; resumes immediately on visibilitychange.
- Stamp older than 48h, still no calendar published: marked as 'failed',
  polling stops for that stamp.
- 3 calendars, alice publishes first: stamp flips to 'ready' immediately,
  poller keeps probing bob/finney for ~60s for multi-anchor redundancy.
*/

const POLL_INTERVAL_MS = 60_000;
const MULTI_ANCHOR_GRACE_MS = 90_000;     // after first publish, keep polling siblings this long
const STUCK_TIMEOUT_MS = 48 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class OtsPollerService implements OnDestroy {

  private tickSub: Subscription | null = null;
  private visibilitySub: Subscription | null = null;
  private inflight = new Set<string>();    // stamp.id|calendar.uri keys we're currently fetching

  constructor(private store: OtsStoreService) {
    if (typeof document !== 'undefined') {
      this.visibilitySub = fromEvent(document, 'visibilitychange')
        .pipe(filter(() => document.visibilityState === 'visible'))
        .subscribe(() => this.tick());
    }
    this.start();
  }

  ngOnDestroy(): void {
    this.tickSub?.unsubscribe();
    this.visibilitySub?.unsubscribe();
  }

  private start(): void {
    this.tickSub?.unsubscribe();
    this.tickSub = timer(0, POLL_INTERVAL_MS).subscribe(() => this.tick());
  }

  private tick(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const now = Date.now();
    for (const stamp of this.store.snapshot()) {
      this.advanceStamp(stamp, now);
    }
  }

  private advanceStamp(stamp: OtsLocalStamp, now: number): void {
    if (stamp.status === 'failed') return;

    // 48h stuck check: not ready AND no successful calendar AND past timeout.
    if (stamp.status === 'queued' && now - stamp.submittedAt > STUCK_TIMEOUT_MS) {
      this.store.update(stamp.id, s => ({ ...s, status: 'failed' }));
      return;
    }

    // Multi-anchor grace: stop polling siblings ~90s after first publish.
    const inGrace =
      stamp.status === 'ready' &&
      stamp.readyAt !== null &&
      now - stamp.readyAt < MULTI_ANCHOR_GRACE_MS;

    if (stamp.status === 'ready' && !inGrace) return;

    for (const cal of stamp.calendars) {
      if (cal.upgradedBase64) continue;
      const key = stamp.id + '|' + cal.uri;
      if (this.inflight.has(key)) continue;
      this.inflight.add(key);
      this.upgradeOne(stamp, cal.uri).finally(() => this.inflight.delete(key));
    }
  }

  /**
   * GET /timestamp/<hex_hash> on the given calendar. 200 => calendar has
   * published its batch and the response body is the upgraded subtree;
   * splice it into the stamp and possibly mark the stamp as ready.
   * 404 / 5xx => still pending or transient error; just record the result.
   */
  private async upgradeOne(stamp: OtsLocalStamp, calendarUri: string): Promise<void> {
    // Hit our backend proxy instead of the calendar directly: public OTS
    // calendars don't send Access-Control-Allow-Origin on /timestamp/<hash>,
    // so a browser GET would be blocked. The backend just forwards the bytes
    // and the upstream status code.
    //
    // CRUCIAL: the lookup key is the commitment (msg at the PendingAttestation
    // node), NOT the file hash. Calendars index their batches by commitment;
    // querying by file hash 404s forever.
    const cal = stamp.calendars.find(c => c.uri === calendarUri);
    if (!cal || !cal.commitmentHex) return;
    const apiBase = environment.apiBaseUrl || '';
    const calendarHost = (() => {
      try { return new URL(calendarUri).hostname; } catch { return ''; }
    })();
    const url = `${apiBase}/api/v1/ordpool/ots/upgrade/${calendarHost}/${cal.commitmentHex}`;
    let bodyB64: string | null = null;
    let result: 'pending' | 'published' | 'error' = 'error';
    let errorMessage: string | null = null;
    try {
      const resp = await fetch(url, { method: 'GET' });
      // Backend proxy always returns 200; we distinguish by Content-Type so
      // Chrome's devtools doesn't log "Failed to load resource: 404" every
      // minute while a stamp is still pending. JSON body = pending, binary
      // = upgraded.
      const ct = resp.headers.get('content-type') || '';
      if (resp.status === 200 && ct.includes('json')) {
        result = 'pending';
      } else if (resp.status === 200) {
        const buf = new Uint8Array(await resp.arrayBuffer());
        bodyB64 = bytesToBase64(buf);
        result = 'published';
      } else {
        errorMessage = 'HTTP ' + resp.status;
      }
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : 'fetch failed';
    }

    const now = Date.now();
    let firedReadyNotification = false;
    this.store.update(stamp.id, s => {
      const calendars = s.calendars.map(c =>
        c.uri === calendarUri
          ? {
              ...c,
              upgradedBase64: bodyB64 ?? c.upgradedBase64,
              lastCheckedAt: now,
              lastResult: result,
              errorMessage,
            }
          : c
      );
      const anyPublished = calendars.some(c => !!c.upgradedBase64);
      const justBecameReady = anyPublished && s.status === 'queued';
      if (justBecameReady) firedReadyNotification = true;
      return {
        ...s,
        calendars,
        status: anyPublished ? 'ready' : s.status,
        readyAt: justBecameReady ? now : s.readyAt,
      };
    });
    if (firedReadyNotification) this.notifyReady(stamp.filename);
  }

  /**
   * Browser notification when a stamp transitions to 'ready'. Best-effort:
   * if permission was denied or not requested yet we silently skip; the
   * tab title and queue UI carry the same signal anyway.
   */
  private notifyReady(filename: string): void {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('Your timestamp is ready', {
        body: `"${filename}" is now anchored to Bitcoin. Download the receipt now.`,
        icon: '/resources/mempool-cube-logo.png',
        tag: 'ots-ready-' + filename,   // tag so multi-stamp doesn't spam
      });
    } catch {
      // Some browsers throw on background-tab notifications; ignore.
    }
  }
}
