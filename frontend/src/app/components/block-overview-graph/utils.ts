import { OrdpoolTransactionFlags, isFlagSet } from 'ordpool-parser';
import { feeLevels, defaultMempoolFeeColors, contrastMempoolFeeColors } from '../../app.constants';
import { Color } from './sprite-types';
import TxView from './tx-view';

export function hexToColor(hex: string): Color {
  return {
    r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255,
    b: parseInt(hex.slice(4, 6), 16) / 255,
    a: hex.length > 6 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
  };
}

export function desaturate(color: Color, amount: number): Color {
  const gray = (color.r + color.g + color.b) / 6;
  return {
    r: color.r + ((gray - color.r) * amount),
    g: color.g + ((gray - color.g) * amount),
    b: color.b + ((gray - color.b) * amount),
    a: color.a,
  };
}

export function darken(color: Color, amount: number): Color {
  return {
    r: color.r * amount,
    g: color.g * amount,
    b: color.b * amount,
    a: color.a,
  };
}

export function setOpacity(color: Color, opacity: number): Color {
  return {
    ...color,
    a: opacity
  };
}

interface ColorPalette {
  base: Color[],
  audit: Color[],
  marginal: Color[],
  baseLevel: (tx: TxView, rate: number, time: number) => number,
}

// precomputed colors
const defaultColors: { [key: string]: ColorPalette } = {
  fee: {
    base: defaultMempoolFeeColors.map(hexToColor),
    audit: [],
    marginal: [],
    baseLevel: (tx: TxView, rate: number) => feeLevels.findIndex((feeLvl) => Math.max(1, rate) < feeLvl) - 1
  },
}
for (const key in defaultColors) {
  const base = defaultColors[key].base;
  defaultColors[key].audit = base.map((color) => darken(desaturate(color, 0.3), 0.9));
  defaultColors[key].marginal = base.map((color) => darken(desaturate(color, 0.8), 1.1));
  defaultColors['unmatched' + key] = {
    base: defaultColors[key].base.map(c => setOpacity(c, 0.2)),
    audit: defaultColors[key].audit.map(c => setOpacity(c, 0.2)),
    marginal: defaultColors[key].marginal.map(c => setOpacity(c, 0.2)),
    baseLevel: defaultColors[key].baseLevel,
  };
}

export { defaultColors as defaultColors };

export const defaultAuditColors = {
  censored: hexToColor('f344df'),
  missing: darken(desaturate(hexToColor('f344df'), 0.3), 0.7),
  added: hexToColor('0099ff'),
  prioritized: darken(desaturate(hexToColor('0099ff'), 0.3), 0.7),
  accelerated: hexToColor('8f5ff6'),
};

export const ordpoolColors = {
  // censored color + a bit opacity
  cat21: setOpacity(hexToColor('f344df'), 0.7)
};

const contrastColors: { [key: string]: ColorPalette } = {
  fee: {
    base: contrastMempoolFeeColors.map(hexToColor),
    audit: [],
    marginal: [],
    baseLevel: (tx: TxView, rate: number) => feeLevels.findIndex((feeLvl) => Math.max(1, rate) < feeLvl) - 1
  },
}
for (const key in contrastColors) {
  const base = contrastColors[key].base;
  contrastColors[key].audit = base.map((color) => darken(desaturate(color, 0.3), 0.9));
  contrastColors[key].marginal = base.map((color) => darken(desaturate(color, 0.8), 1.1));
  contrastColors['unmatched' + key] = {
    base: contrastColors[key].base.map(c => setOpacity(c, 0.2)),
    audit: contrastColors[key].audit.map(c => setOpacity(c, 0.2)),
    marginal: contrastColors[key].marginal.map(c => setOpacity(c, 0.2)),
    baseLevel: contrastColors[key].baseLevel,
  };
}

export { contrastColors as contrastColors };

export const contrastAuditColors = {
  censored: hexToColor('ffa8ff'),
  missing: darken(desaturate(hexToColor('ffa8ff'), 0.3), 0.7),
  added: hexToColor('00bb98'),
  prioritized: darken(desaturate(hexToColor('00bb98'), 0.3), 0.7),
  accelerated: hexToColor('8f5ff6'),
};

export function defaultColorFunction(
  tx: TxView,
  colors: { base: Color[], audit: Color[], marginal: Color[], baseLevel: (tx: TxView, rate: number, time: number) => number } = defaultColors.fee,
  auditColors: { [status: string]: Color } = defaultAuditColors,
  relativeTime?: number,
): Color {
  const rate = tx.fee / tx.vsize; // color by simple single-tx fee rate
  const levelIndex = colors.baseLevel(tx, rate, relativeTime || (Date.now() / 1000));
  const levelColor = colors.base[levelIndex] || colors.base[defaultMempoolFeeColors.length - 1];
  // Normal mode
  if (!tx.scene?.highlightingEnabled) {
    if (tx.acc) {
      return auditColors.accelerated;
    } else {
      return levelColor;
    }
    return levelColor;
  }
  
  // Block audit
  switch(tx.status) {
    case 'censored':
      return auditColors.censored;
    case 'missing':
    case 'sigop':
    case 'rbf':
      return colors.marginal[levelIndex] || colors.marginal[defaultMempoolFeeColors.length - 1];
    case 'fresh':
    case 'freshcpfp':
      return auditColors.missing;
    case 'added':
      return auditColors.added;
    case 'prioritized':
      return auditColors.prioritized;
    case 'selected':
      return colors.marginal[levelIndex] || colors.marginal[defaultMempoolFeeColors.length - 1];
    case 'accelerated':
      return auditColors.accelerated;
    case 'found':
      if (tx.context === 'projected') {
        return colors.audit[levelIndex] || colors.audit[defaultMempoolFeeColors.length - 1];
      } else {
        return levelColor;
      }
    default:
      if (tx.acc) {
        return auditColors.accelerated;
      } else {
        return levelColor;
      }
  }
}

export function contrastColorFunction(
  tx: TxView,
  colors: { base: Color[], audit: Color[], marginal: Color[], baseLevel: (tx: TxView, rate: number, time: number) => number } = contrastColors.fee,
  auditColors: { [status: string]: Color } = contrastAuditColors,
  relativeTime?: number,
): Color {
  return defaultColorFunction(tx, colors, auditColors, relativeTime);
}

export function ageColorFunction(
  tx: TxView,
  colors: { base: Color[], audit: Color[], marginal: Color[], baseLevel: (tx: TxView, rate: number, time: number) => number } = defaultColors.fee,
  auditColors: { [status: string]: Color } = defaultAuditColors,
  relativeTime?: number,
  theme?: string,
): Color {
  if (tx.acc || tx.status === 'accelerated') {
    return auditColors.accelerated;
  }

  const color = theme !== 'contrast' && theme !== 'bukele' ? defaultColorFunction(tx, colors, auditColors, relativeTime) : contrastColorFunction(tx, colors, auditColors, relativeTime);

  const ageLevel = (!tx.time ? 0 : (0.8 * Math.tanh((1 / 15) * Math.log2((Math.max(1, 0.6 * ((relativeTime - tx.time) - 60)))))));
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    a: color.a * (1 - ageLevel)
  };
}

// HACK -- ordpoolColorFunction
export function ordpoolColorFunction(
  tx: TxView,
  relativeTime: number,
  hasMatch: boolean
): Color {

  // we have a cat!!!
  if (isFlagSet(tx, OrdpoolTransactionFlags.ordpool_cat21)) {
    return ordpoolColors.cat21;
  }

  if (hasMatch) {

    // derive the cat colors from feeRate, by @Ethspresso & @HausHoppe
    // const saturationSeed = 100;
    // const { rgb, saturation } = feeRateToColor(feeRate, saturationSeed);
    // const colors = derivePalette(rgb[0], rgb[1], rgb[2], saturation);
    // const primaryColor = colors[3].replace('#', '');
    // const catColor = hexToColor(primaryColor);
    // // catColor.a = 0.8;
    // return catColor;

    // defaultColors.unmatchedfee
    const colors = defaultColors.fee;

    // Mempool colors
    const rate = tx.fee / tx.vsize; // color by simple single-tx fee rate
    const levelIndex = colors.baseLevel(tx, rate, relativeTime || (Date.now() / 1000));
    const levelColor = colors.base[levelIndex] || colors.base[defaultMempoolFeeColors.length - 1];
    return levelColor;
  }

  // return darker gray (no artifact found)
  return { r: 0.8, g: 0.8, b: 0.8, a: 0.3 };


}