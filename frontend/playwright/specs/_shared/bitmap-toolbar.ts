import { expect, Locator, Page, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The bitmap viewer's toolbar: three 36 px buttons in the bottom-right
 * corner of the stage, each carrying an ngbTooltip.
 *
 * Left to place itself, that tooltip lands beside the button it belongs to
 * -- which at the right edge of the stage means on top of the neighbouring
 * button, and hanging off the stage's own edge. On a touch screen it is
 * worse than useless: there is no hover, so it appears only after the tap
 * has already done the thing, and then sits over a control the reader can
 * no longer see.
 *
 * Driven through the E2E route with the bitmap endpoint stubbed, so this
 * asserts the chrome without depending on a particular inscription still
 * existing on mainnet.
 */

const HEIGHT = 500_000;

const fixture = () =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../fixtures/bitmap-${HEIGHT}.json`), 'utf8'));

export const mountViewer = async (page: Page): Promise<void> => {
  const body = fixture();
  await page.route(`**/api/v1/ordpool/bitmap/${HEIGHT}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  await page.addInitScript(`window.__bitmapViewerHeight = ${HEIGHT};`);
  await page.goto('/e2e/bitmap-3d');
  await expect(page.getByTestId('bitmap-viewer-e2e-host')).toBeAttached();
};

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

/** A bounding box, or a failure that names what had none. */
const boxOf = async (locator: Locator, what: string): Promise<Box> => {
  const box = await locator.boundingBox();
  if (!box) { throw new Error(`${what} has no bounding box`); }
  return box;
};

const toolbar = (page: Page) => page.locator('app-bitmap-viewer .bitmap-toolbar button');

/** The toolbar sits at the bottom of the stage, below the fold on this page. */
const reveal = async (page: Page) => {
  const buttons = toolbar(page);
  await expect(buttons.first()).toBeVisible();
  await buttons.last().scrollIntoViewIfNeeded();
  // Scrolling is animated, so the boxes measured below are only meaningful
  // once it has come to rest -- which is what being in the viewport says.
  await expect(buttons.last()).toBeInViewport();
};

export const bitmapToolbarSuite = (label: 'desktop' | 'mobile'): void => {
  test.describe(`bitmap toolbar (${label})`, () => {
    test('every button is the hit target at its own centre', async ({ page }) => {
      await mountViewer(page);
      await reveal(page);

      // Rect and hit-test are taken together inside the page: under mobile
      // emulation Playwright's boundingBox() and elementFromPoint() do not
      // share a coordinate system, and comparing across them reports a
      // perfectly reachable button as buried.
      const unreachable = await page.evaluate(() =>
        [...document.querySelectorAll('app-bitmap-viewer .bitmap-toolbar button')]
          .map((button, i) => {
            const r = button.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return hit && button.contains(hit)
              ? null
              : { i, label: button.getAttribute('aria-label'), covering: hit?.tagName ?? 'nothing' };
          })
          .filter(Boolean));

      expect(unreachable, 'toolbar buttons buried at their own centre').toEqual([]);
    });

    if (label === 'desktop') {
      test('a tooltip never covers a neighbouring button or leaves the stage', async ({ page }) => {
        await mountViewer(page);
        await reveal(page);
        const buttons = toolbar(page);
        const tooltip = page.locator('ngb-tooltip-window');
        const stage = await boxOf(page.locator('app-bitmap-viewer .bitmap-stage'), 'the stage');
        const count = await buttons.count();

        for (let i = 0; i < count; i++) {
          await buttons.nth(i).hover();
          await expect(tooltip, `button ${i} shows no tooltip on hover`).toBeVisible();
          const tip = await boxOf(tooltip.first(), `the tooltip of button ${i}`);
          expect(tip.x + tip.width, 'tooltip leaves the stage on the right')
            .toBeLessThanOrEqual(stage.x + stage.width + 1);

          for (let j = 0; j < count; j++) {
            if (j === i) { continue; }
            const other = await boxOf(buttons.nth(j), `button ${j}`);
            expect(overlaps(tip, other), `tooltip of button ${i} covers button ${j}`).toBe(false);
          }
          // Park the pointer away from the toolbar and let the tooltip go,
          // so the next iteration cannot measure this one.
          await page.mouse.move(2, 2);
          await expect(tooltip).toHaveCount(0);
        }
      });
    } else {
      test('a tap opens no tooltip, and the labels stay for assistive tech', async ({ page }) => {
        await mountViewer(page);
        await reveal(page);
        const buttons = toolbar(page);

        for (let i = 0; i < await buttons.count(); i++) {
          await expect(buttons.nth(i)).toHaveAttribute('aria-label', /\S/);
        }

        // One tap only: on a touch screen the tooltip would appear after the
        // action has already run, on top of a control the reader can then no
        // longer see. Tapping further buttons would change the toolbar under
        // the assertion, which is a different test.
        const box = await boxOf(buttons.last(), 'the view toggle');
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        // The tap lands on the 2D/3D toggle, so the renderer mounting is
        // proof the tap was delivered -- and by then a tooltip triggered by
        // the same tap (ng-bootstrap opens on focus too) would be on screen.
        await expect(page.locator('app-bitmap-3d-renderer')).toBeAttached();
        await expect(page.locator('ngb-tooltip-window')).toHaveCount(0);
      });
    }
  });
};
