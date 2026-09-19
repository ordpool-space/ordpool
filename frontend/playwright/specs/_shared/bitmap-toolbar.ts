import { expect, Page, test } from '@playwright/test';
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

const overlaps = (a: Box, b: Box) =>
  !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

type Box = { x: number; y: number; width: number; height: number };

const toolbar = (page: Page) => page.locator('app-bitmap-viewer .bitmap-toolbar button');

/** The toolbar sits at the bottom of the stage, below the fold on this page. */
const reveal = async (page: Page) => {
  const buttons = toolbar(page);
  await expect(buttons.first()).toBeVisible();
  await buttons.last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
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
        const stage = (await page.locator('app-bitmap-viewer .bitmap-stage').boundingBox())!;
        const count = await buttons.count();

        for (let i = 0; i < count; i++) {
          await buttons.nth(i).hover();
          const tip = (await page.locator('ngb-tooltip-window').first().boundingBox())!;
          expect(tip, `button ${i} shows no tooltip on hover`).not.toBeNull();
          expect(tip.x + tip.width, 'tooltip leaves the stage on the right')
            .toBeLessThanOrEqual(stage.x + stage.width + 1);

          for (let j = 0; j < count; j++) {
            if (j === i) { continue; }
            const other = (await buttons.nth(j).boundingBox())!;
            expect(overlaps(tip, other), `tooltip of button ${i} covers button ${j}`).toBe(false);
          }
          await page.mouse.move(2, 2);
          await page.waitForTimeout(250);
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
        const box = (await buttons.last().boundingBox())!;
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(600);
        await expect(page.locator('ngb-tooltip-window')).toHaveCount(0);
      });
    }
  });
};
