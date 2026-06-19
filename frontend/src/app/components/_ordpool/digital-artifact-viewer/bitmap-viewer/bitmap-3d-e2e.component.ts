import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Playwright E2E mount point for the bitmap 3D renderer.
 *
 * Skips the BitmapApiService chain entirely: Playwright sets
 * `window.__bitmap3dFixture = { sizes: number[] }` via `addInitScript`
 * before navigation, this component picks the sizes up synchronously and
 * mounts the renderer with deterministic input.
 *
 * Test-only buttons (data-testid attributes) drive the cinematic state
 * machine (iso -> PFP -> iso) without faking clicks on the real bitmap
 * toolbar.
 *
 * Registered only when environment.testHooks === true. The production
 * route table doesn't reference this component; the chunk falls out of
 * the bundle via tree-shaking.
 */
@Component({
  selector: 'app-bitmap-3d-e2e',
  template: `
    <div class="e2e-controls">
      <button type="button" data-testid="e2e-enter-pfp" (click)="enterPfp()">Enter PFP</button>
      <button type="button" data-testid="e2e-exit-pfp" (click)="exitPfp()">Exit PFP</button>
      <span data-testid="e2e-sizes-len">{{ sizes?.length ?? 0 }}</span>
    </div>
    <div class="e2e-host" data-testid="bitmap-3d-e2e-host">
      <app-bitmap-3d-renderer
        *ngIf="sizes"
        [sizes]="sizes"
        [pfp]="pfp"
        [exit]="exit"
        (exitDone)="onExitDone()"
        data-testid="bitmap-3d-renderer">
      </app-bitmap-3d-renderer>
      <div *ngIf="!sizes" data-testid="bitmap-3d-e2e-missing-fixture">
        No fixture: set window.__bitmap3dFixture before navigation.
      </div>
    </div>
  `,
  styles: [`
    .e2e-host { display: block; width: 600px; height: 600px; }
    .e2e-controls { display: flex; gap: 8px; padding: 8px; }
    .e2e-controls button { padding: 4px 12px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class Bitmap3dE2EComponent {
  // OnPush + (click) bindings — Angular runs CD on the bound event, so
  // these setters don't need an explicit markForCheck.
  sizes: number[] | null = ((window as unknown as { __bitmap3dFixture?: { sizes: number[] } })
    .__bitmap3dFixture?.sizes) ?? null;
  pfp = false;
  exit = false;

  enterPfp(): void { this.pfp = true; this.exit = false; }
  exitPfp(): void { this.exit = true; }
  onExitDone(): void { this.pfp = false; this.exit = false; }
}
