// The fetcher transitively imports ordpool-sdk's dist, which jest can't
// transform; mock the module so importing the component never loads it. The
// placement path under test never calls the fetcher.
jest.mock('@app/services/ordinals/digital-artifacts-fetcher.service', () => ({
  DigitalArtifactsFetcherService: class {
    fetchArtifacts() {
      return { pipe: () => ({}) };
    }
  },
}));

import { ChangeDetectorRef, NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DigitalArtifactsFetcherService } from '@app/services/ordinals/digital-artifacts-fetcher.service';
import { BlockOverviewTooltipComponent } from './block-overview-tooltip.component';

/**
 * The tooltip reaches its final height AFTER placement: the Digital Artifacts
 * inscription preview loads asynchronously and grows the tooltip downward. The
 * regression these tests pin: when that growth means the tooltip no longer fits
 * below a low cursor, re-placement must FLIP it above the cursor (where there is
 * room) instead of leaving it running off the bottom of the viewport.
 */
describe('BlockOverviewTooltipComponent placement', () => {
  let component: BlockOverviewTooltipComponent;
  let cdMock: { markForCheck: jest.Mock };

  /** A fake tooltip element whose natural content height (scrollHeight) we control. */
  function fakeTooltipEl(scrollHeight: number, width = 300) {
    return {
      nativeElement: {
        scrollHeight,
        getBoundingClientRect: () => ({ width, height: scrollHeight }),
      },
    } as any;
  }

  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: DigitalArtifactsFetcherService, useValue: { fetchArtifacts: () => ({ pipe: () => ({}) }) } },
      ],
    });

    // cd + zone are passed straight to the constructor as plain mocks; only the
    // field-level inject(DigitalArtifactsFetcherService) needs the injector
    // context (overriding NgZone/ChangeDetectorRef as providers would break
    // zone.js' test setup).
    cdMock = { markForCheck: jest.fn() };
    const zoneMock = { run: (fn: () => void) => fn() } as unknown as NgZone;
    component = TestBed.runInInjectionContext(
      () => new BlockOverviewTooltipComponent(cdMock as unknown as ChangeDetectorRef, zoneMock),
    );
  });

  it('places a short tooltip below the cursor, then flips it above once it grows', () => {
    // Viewport 1200x800, cursor low (y=600): room below is small (190), room
    // above is large (590).
    setViewport(1200, 800);
    (component as any).lastCursor = { x: 100, y: 600 };

    // Short content (150 px) fits below the cursor -> placed south.
    component.tooltipElement = fakeTooltipEl(150);
    (component as any).placeAgainstCursor();
    expect(component.tooltipPosition.y).toBe(610); // cursor.y + GAP

    // The inscription preview loads and the tooltip grows to 500 px, which no
    // longer fits below. Re-placement must flip it ABOVE the cursor.
    component.tooltipElement = fakeTooltipEl(500);
    (component as any).placeAgainstCursor();
    expect(component.tooltipPosition.y).toBe(90); // cursor.y - height - GAP = 600 - 500 - 10
    expect(component.tooltipPosition.y).toBeLessThan(600); // above the cursor
  });

  it('uses the natural scrollHeight (not the clamped box height) for the flip decision', () => {
    setViewport(1200, 800);
    (component as any).lastCursor = { x: 100, y: 600 };
    // getBoundingClientRect reports a clamped height (190, as if max-height were
    // applied), but scrollHeight reveals the real 500 px of content. The flip
    // must follow the natural height, or a clamped tooltip would never flip.
    component.tooltipElement = {
      nativeElement: {
        scrollHeight: 500,
        getBoundingClientRect: () => ({ width: 300, height: 190 }),
      },
    } as any;
    (component as any).placeAgainstCursor();
    expect(component.tooltipPosition.y).toBe(90); // flipped above, using scrollHeight
  });

  it('does not re-place when the recomputed position is unchanged (no ResizeObserver loop)', () => {
    setViewport(1200, 800);
    (component as any).lastCursor = { x: 100, y: 100 };
    component.tooltipElement = fakeTooltipEl(150);
    (component as any).placeAgainstCursor();
    cdMock.markForCheck.mockClear();
    // Same size, same cursor -> nothing changes -> no write, no change detection.
    (component as any).placeAgainstCursor();
    expect(cdMock.markForCheck).not.toHaveBeenCalled();
  });
});
