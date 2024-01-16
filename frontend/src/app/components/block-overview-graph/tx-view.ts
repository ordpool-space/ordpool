import TxSprite from './tx-sprite';
import { FastVertexArray } from './fast-vertex-array';
import { SpriteUpdateParams, Square, Color, ViewUpdateParams } from './sprite-types';
import { hexToColor } from './utils';
import BlockScene from './block-scene';
import { TransactionStripped } from '../../interfaces/node-api.interface';
import { DigitalArtifactsFetcherService } from '../../services/ordinals/digital-artifacts-fetcher.service';
import { DigitalArtifact, ParsedInscription } from 'ordpool-parser';

const hoverTransitionTime = 300;
const defaultHoverColor = hexToColor('1bd8f4');
const defaultHighlightColor = hexToColor('800080');

// convert from this class's update format to TxSprite's update format
function toSpriteUpdate(params: ViewUpdateParams): SpriteUpdateParams {
  return {
    start: (params.start || performance.now()) + (params.delay || 0),
    duration: params.duration,
    minDuration: params.minDuration,
    ...params.display.position,
    ...params.display.color,
    adjust: params.adjust
  };
}

export default class TxView implements TransactionStripped {
  txid: string;
  fee: number;
  vsize: number;
  value: number;
  feerate: number;
  acc?: boolean;
  rate?: number;
  bigintFlags?: bigint | null = 0b00000100_00000000_00000000_00000000n;
  status?: 'found' | 'missing' | 'sigop' | 'fresh' | 'freshcpfp' | 'added' | 'censored' | 'selected' | 'rbf' | 'accelerated';
  context?: 'projected' | 'actual';
  scene?: BlockScene;

  initialised: boolean;
  vertexArray: FastVertexArray;
  hover: boolean;
  highlight: boolean;
  sprite: TxSprite;
  hoverColor: Color | void;
  highlightColor: Color | void;

  screenPosition: Square;
  gridPosition: Square | void;

  dirty: boolean;

  // HACK
  digitalArtifacts: DigitalArtifact[] | undefined;
  digitalArtifactsFetcher: DigitalArtifactsFetcherService;

  constructor(tx: TransactionStripped, scene: BlockScene, ) {
    this.scene = scene;
    this.context = tx.context;
    this.txid = tx.txid;
    this.fee = tx.fee;
    this.vsize = tx.vsize;
    this.value = tx.value;
    this.feerate = tx.rate || (tx.fee / tx.vsize); // sort by effective fee rate where available
    this.acc = tx.acc;
    this.rate = tx.rate;
    this.status = tx.status;
    this.bigintFlags = tx.flags ? BigInt(tx.flags) : 0n;
    this.initialised = false;
    this.vertexArray = scene.vertexArray;

    this.hover = false;

    this.screenPosition = { x: 0, y: 0, s: 0 };

    this.dirty = true;

    // HACK: forward from BlockScene > TxView
    this.digitalArtifactsFetcher = this.scene.digitalArtifactsFetcher;
    this.fetchInscription();
  }

  destroy(): void {
    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
      this.initialised = false;
    }

    // HACK
    this.digitalArtifactsFetcher.cancelFetchInscriptions(this.txid);
  }

  private fetchInscription(): void {
    this.digitalArtifactsFetcher.fetchArtifacts(this.txid).subscribe({
      next: (artifacts) => this.updateArtifacts(artifacts),
      error: error => {
        // console.error('TxView: Failed to fetch inscription:', error);
      }
    });
  }

  private updateArtifacts(digitalArtifacts: DigitalArtifact[]): void {

    this.digitalArtifacts = digitalArtifacts;

    // Mark the view as dirty to trigger re-rendering
    this.dirty = true;

    // i have absolutely no clue what I'm doing here, but when I call both functions, then it works...
    setTimeout(() => {

      // this can happen when we change pages but still proccess this code
      if (!this.sprite) {
        return;
      }

      this.sprite.update({
        ...this.getColor()
      });

      this.scene.applyTxUpdate(this, {
        display: {
          color: this.getColor()
        }
      });
    }, 0);
  }

  applyGridPosition(position: Square): void {
    if (!this.gridPosition) {
      this.gridPosition = { x: 0, y: 0, s: 0 };
    }
    if (this.gridPosition.x !== position.x || this.gridPosition.y !== position.y || this.gridPosition.s !== position.s) {
      this.gridPosition.x = position.x;
      this.gridPosition.y = position.y;
      this.gridPosition.s = position.s;
      this.dirty = true;
    }
  }

  /*
    display: defines the final appearance of the sprite
        position: { x, y, s } (coordinates & size)
        color: { r, g, b, a} (color channels & alpha)
    duration: of the tweening animation from the previous display state
    start: performance.now() timestamp, when to start the transition
    delay: additional milliseconds to wait before starting
    jitter: if set, adds a random amount to the delay,
    adjust: if true, modify an in-progress transition instead of replacing it

    returns minimum transition end time
  */
  update(params: ViewUpdateParams): number {
    if (params.jitter) {
      params.delay += (Math.random() * params.jitter);
    }

    if (!this.initialised || !this.sprite) {
      this.initialised = true;
      this.sprite = new TxSprite(
        toSpriteUpdate(params),
        this.vertexArray
      );
      // apply any pending hover event
      if (this.hover) {
        params.duration = Math.max(params.duration, hoverTransitionTime);
        this.sprite.update({
          ...this.hoverColor,
          duration: hoverTransitionTime,
          adjust: false,
          temp: true
        });
      }
    } else {
      this.sprite.update(
        toSpriteUpdate(params)
      );
    }
    this.dirty = false;
    return (params.start || performance.now()) + (params.delay || 0) + (params.duration || 0);
  }

  // Temporarily override the tx color
  // returns minimum transition end time
  setHover(hoverOn: boolean, color: Color | void = defaultHoverColor): number {
    if (hoverOn) {
      this.hover = true;
      this.hoverColor = color;

      this.sprite.update({
        ...this.hoverColor,
        duration: hoverTransitionTime,
        adjust: false,
        temp: true
      });
    } else {
      this.hover = false;
      this.hoverColor = null;
      if (this.highlight) {
        this.setHighlight(true, this.highlightColor);
      } else {
        if (this.sprite) {
          this.sprite.resume(hoverTransitionTime);
        }
      }
    }
    this.dirty = false;
    return performance.now() + hoverTransitionTime;
  }

  // Temporarily override the tx color
  // returns minimum transition end time
  setHighlight(highlightOn: boolean, color: Color | void = defaultHighlightColor): number {
    if (highlightOn) {
      this.highlight = true;
      this.highlightColor = color;

      this.sprite.update({
        ...this.highlightColor,
        duration: hoverTransitionTime,
        adjust: false,
        temp: true
      });
    } else {
      this.highlight = false;
      this.highlightColor = null;
      if (this.hover) {
        this.setHover(true, this.hoverColor);
      } else {
        if (this.sprite) {
          this.sprite.resume(hoverTransitionTime);
        }
      }
    }
    this.dirty = false;
    return performance.now() + hoverTransitionTime;
  }

  /*
  getColor(): Color {
    const rate = this.fee / this.vsize; // color by simple single-tx fee rate
    const feeLevelIndex = feeLevels.findIndex((feeLvl) => Math.max(1, rate) < feeLvl) - 1;
    const feeLevelColor = feeColors[feeLevelIndex] || feeColors[mempoolFeeColors.length - 1];
    // Normal mode
    if (!this.scene?.highlightingEnabled) {
      if (this.acc) {
        return auditColors.accelerated;
      } else {
        return feeLevelColor;
      }
      return feeLevelColor;
    }
    // Block audit
    switch(this.status) {
      case 'censored':
        return auditColors.censored;
      case 'missing':
      case 'sigop':
      case 'rbf':
        return marginalFeeColors[feeLevelIndex] || marginalFeeColors[mempoolFeeColors.length - 1];
      case 'fresh':
      case 'freshcpfp':
        return auditColors.missing;
      case 'added':
        return auditColors.added;
      case 'selected':
        return marginalFeeColors[feeLevelIndex] || marginalFeeColors[mempoolFeeColors.length - 1];
      case 'accelerated':
        return auditColors.accelerated;
      case 'found':
        if (this.context === 'projected') {
          return auditFeeColors[feeLevelIndex] || auditFeeColors[mempoolFeeColors.length - 1];
        } else {
          return feeLevelColor;
        }
      default:
        if (this.acc) {
          return auditColors.accelerated;
        } else {
          return feeLevelColor;
        }
    }
    */
  }
}
