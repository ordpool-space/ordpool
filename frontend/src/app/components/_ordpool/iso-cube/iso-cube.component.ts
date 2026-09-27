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
/**
 * The empty share of a cube's right face: the polygon above the fill level,
 * and where the level meets the centre edge (x=80) and the outer edge
 * (x=149.28), in the cube's 160-unit SVG space.
 */
export interface EmptyShare {
  points: string;
  centreY: number;
  outerY: number;
}

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
    this.ink = lifted.luminance > IsoCubeComponent.inkCrossover ? null : '#fff';
  }
  topColor: string | null = null;

  /**
   * How much of the block is used, against how much it could hold: a mined
   * block's weight against BLOCK_WEIGHT_UNITS, a projected block's vsize
   * against the block vsize. The same two quantities upstream's block
   * gradients are drawn from, so the cube carries the fullness the flat
   * block front did. Passed raw rather than as a ratio so a missing value
   * stays missing here, instead of becoming NaN or a false zero in the
   * host's template.
   */
  @Input() set filled(value: number | null | undefined) {
    this._filled = value ?? null;
    this.emptyFacePoints = IsoCubeComponent.emptyShare(this._filled, this._capacity);
  }
  @Input() set capacity(value: number | null | undefined) {
    this._capacity = value ?? null;
    this.emptyFacePoints = IsoCubeComponent.emptyShare(this._filled, this._capacity);
  }
  private _filled: number | null = null;
  private _capacity: number | null = null;
  /** The right face above the fill level and the level itself, or null when full or unknown. */
  emptyFacePoints: EmptyShare | null = null;

  /**
   * The empty share of the right face as SVG points. The face runs from
   * (80,80)-(149.28,40) at the top to (80,160)-(149.28,120) at the bottom,
   * 80 units tall at every x, so a level at fullness f sits 80·f above the
   * bottom edge and parallel to it. At or over one block's worth there is
   * no empty share: a merged projected block exceeds one block's vsize and
   * is simply full. Anything that is not a non-negative amount of a
   * positive capacity (null, NaN, a negative) is unknown and draws nothing,
   * rather than a false empty cube.
   */
  static emptyShare(filled: number | null, capacity: number | null): EmptyShare | null {
    // The null tests narrow the types; `>=` and `>` are false for NaN, so
    // they reject it along with negatives and a zero capacity.
    if (filled === null || capacity === null || !(filled >= 0) || !(capacity > 0)) {
      return null;
    }
    const fullness = filled / capacity;
    if (!(fullness < 1)) {
      return null;
    }
    const rise = 80 * fullness;
    const centreY = 160 - rise;
    const outerY = 120 - rise;
    return { points: `80,80 149.28,40 149.28,${outerY} 80,${centreY}`, centreY, outerY };
  }
  /** Top-label colour: null keeps the dark default, white on dark faces. */
  ink: string | null = null;

  /**
   * Face luminance at which the dark ink (`#1d1f31`, relative luminance
   * 0.0146) and white contrast equally against the face: solving
   * (L + 0.05) / 0.0646 = 1.05 / (L + 0.05) gives L = 0.2105. Above it the
   * dark ink wins, below it white does, so this is exactly where the label
   * should switch -- picking any other point hands one band of the palette
   * the worse of the two inks.
   */
  private static readonly inkCrossover = 0.2105;

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
