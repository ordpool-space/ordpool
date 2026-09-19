import { TestBed } from '@angular/core/testing';

import { defaultMempoolFeeColors } from '@app/app.constants';
import { ThemeService } from '@app/services/theme.service';
import { IsoCubeComponent } from './iso-cube.component';

/**
 * The cube's colour maths: the fee-palette lookup, the OKLab lift that
 * brightens a palette colour for the sun-lit top face, and the ink the
 * label is set in.
 */
describe('IsoCubeComponent colour', () => {

  const setup = (palette: string[] = defaultMempoolFeeColors) => {
    TestBed.configureTestingModule({
      providers: [{ provide: ThemeService, useValue: { mempoolFeeColors: palette } }],
    });
    return TestBed.runInInjectionContext(() => new IsoCubeComponent(TestBed.inject(ThemeService)));
  };

  /** WCAG relative luminance of an `#rrggbb` string. */
  const luminance = (hex: string): number => {
    const channel = (i: number) => {
      const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  };

  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** The ink the component leaves to the stylesheet default. */
  const darkInk = '#1d1f31';

  it('keeps the brand orange when no fee rate is given', () => {
    const cube = setup();
    cube.feeRate = null;

    expect(cube.topColor).toBeNull();
    expect(cube.ink).toBeNull();
  });

  it('brightens the palette colour for the top face', () => {
    const cube = setup();
    // 2000 sat/vB is the top fee level, the last colour in the palette.
    cube.feeRate = 2000;

    const raw = '#' + defaultMempoolFeeColors[defaultMempoolFeeColors.length - 1];
    expect(cube.topColor).not.toBe(raw);
    expect(luminance(cube.topColor)).toBeGreaterThan(luminance(raw));
  });

  it('picks the ink with the better contrast on a light face', () => {
    const cube = setup();
    cube.feeRate = 2000;

    // The whole default palette lifts above the crossover, so the label is
    // the dark ink -- and it has to be, or it is the worse of the two.
    expect(cube.ink).toBeNull();
    expect(contrast(cube.topColor, darkInk)).toBeGreaterThan(contrast(cube.topColor, '#ffffff'));
  });

  it('picks the ink with the better contrast on a dark face', () => {
    // A palette dark enough to cross over, which the light theme's lower
    // half does; one entry is enough to pin the branch.
    const cube = setup(['241b5e']);
    cube.feeRate = 1;

    expect(cube.ink).toBe('#fff');
    expect(contrast(cube.topColor, '#ffffff')).toBeGreaterThan(contrast(cube.topColor, darkInk));
  });
});
