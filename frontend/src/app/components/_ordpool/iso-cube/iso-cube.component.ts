import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from '@angular/core';
import { feeLevels } from '@app/app.constants';
import { ThemeService } from '@app/services/theme.service';

/**
 * Isometric corner-on cube (the Ordpool brand cube) as an overlay for a
 * `.bitcoin-block` timeline block, or inline (`class="inline"`) as the
 * logo. Three rhombus faces meet at the centre and each one is a content
 * slot:
 *
 *   <app-iso-cube [feeRate]="medianFee">
 *     <ng-container ngProjectAs="[iso-top]">...</ng-container>    upright label on the top face
 *     <ng-container ngProjectAs="[iso-left]">...</ng-container>   projected onto the left face
 *     <ng-container ngProjectAs="[iso-right]">...</ng-container>  projected onto the right face
 *   </app-iso-cube>
 *
 * As an overlay the host element is absolutely positioned over its block
 * and 30 % larger than it. Global rules in styles-ordpool-overrides2.scss
 * hide upstream's flat front, Necker depth faces and `.block-body`
 * whenever this element is present, so the upstream bindings stay in the
 * DOM for tooltips, data-cy hooks and click targets.
 */
@Component({
  selector: 'app-iso-cube',
  templateUrl: './iso-cube.component.html',
  styleUrls: ['./iso-cube.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  host: { '[style.--iso-top]': 'topColor', '[style.--iso-ink]': 'ink' },
})
export class IsoCubeComponent {
  private static nextUid = 0;
  /** Suffix for this instance's SVG gradient ids (SVG ids are document-global). */
  uid = IsoCubeComponent.nextUid++;

  /**
   * Median fee rate (sat/vB) that colours the cube, through the same
   * fee-level palette the block-overview graph and upstream's projected
   * block gradient use, so a cube reads like every other fee indicator on
   * the site. The palette is tuned for flat fills and sits dark, so the
   * colour is lifted in OKLCH for the sun-lit top face: lightness up,
   * chroma up a little, hue untouched. That brightens without washing
   * out, unlike mixing with white. Left undefined, the cube keeps the
   * brand orange.
   */
  @Input() set feeRate(rate: number | undefined | null) {
    if (rate == null) {
      this.topColor = null;
      this.ink = null;
      return;
    }
    const lifted = IsoCubeComponent.lift(this.feeColor(rate));
    this.topColor = lifted.hex;
    this.ink = lifted.luminance > 0.35 ? null : '#fff';
  }
  topColor: string | null = null;
  /** Top-label colour: null keeps the dark default, white on dark faces. */
  ink: string | null = null;

  /** OKLCH lightness added to a palette colour (0..1 scale). */
  private static readonly liftLightness = 0.15;
  /** OKLCH chroma gain on a palette colour. */
  private static readonly chromaGain = 1.2;

  constructor(private themeService: ThemeService) {}

  private feeColor(rate: number): string {
    // fee-level lookup as in mempool-blocks.component.ts getStyleForMempoolBlock
    const reversedIndex = feeLevels.slice().reverse().findIndex((level) => rate >= level);
    const index = reversedIndex >= 0 ? feeLevels.length - reversedIndex : reversedIndex;
    const colors = this.themeService.mempoolFeeColors;
    return '#' + (colors[index - 1] || colors[colors.length - 1]);
  }

  /**
   * Lifts `#rrggbb` in OKLab (Ottosson's sRGB <-> OKLab matrices), clips
   * back into the sRGB gamut and returns the result with its WCAG relative
   * luminance, which picks the label ink.
   */
  private static lift(hex: string): { hex: string; luminance: number } {
    const linear = [0, 1, 2].map((i) => {
      const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const [r, g, b] = linear;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = Math.min(1, 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s + IsoCubeComponent.liftLightness);
    const A = (1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s) * IsoCubeComponent.chromaGain;
    const B = (0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s) * IsoCubeComponent.chromaGain;
    const l2 = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
    const m2 = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
    const s2 = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
    const out = [
      4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
      -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
      -0.0041960863 * l2 - 0.7034186147 * m2 + 1.7076147010 * s2,
    ].map((c) => Math.min(1, Math.max(0, c)));
    const toHex = (c: number) => {
      const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(v * 255).toString(16).padStart(2, '0');
    };
    return {
      hex: '#' + out.map(toHex).join(''),
      luminance: 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2],
    };
  }
}
