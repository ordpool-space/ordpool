import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import {
  ALKANES_PROTOCOL_TAG,
  ALKANE_SELECTOR_LABELS,
  ParsedProtostone,
  ParsedRunestone,
  decodeProtostones,
} from 'ordpool-parser';
import { AlkanesApiService } from '../../../../services/ordinals/alkanes-api.service';

/**
 * Renders the Alkanes-specific parts of a Runestone: the protostone(s)
 * tagged with protocol_tag = 1, including target contract, function
 * selector, arguments, edicts, and the burn / pointer / refund / from
 * optionals. Sibling of runestone-viewer; the rune-only fields
 * (etching / mint / pointer / cenotaph) stay on that component.
 */
@Component({
  selector: 'app-alkanes-viewer',
  templateUrl: './alkanes-viewer.component.html',
  styleUrls: ['./alkanes-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AlkanesViewerComponent {

  alkanesApi = inject(AlkanesApiService);

  private _runestone: ParsedRunestone | undefined;
  protostones: ParsedProtostone[] = [];
  transactionId: string | undefined;

  @Input() showDetails = false;

  @Input()
  public set parsedRunestone(parsedRunestone: ParsedRunestone | undefined) {
    if (this._runestone?.uniqueId === parsedRunestone?.uniqueId) {
      return;
    }
    this._runestone = parsedRunestone;

    if (!parsedRunestone) {
      this.protostones = [];
      this.transactionId = undefined;
      return;
    }

    this.transactionId = parsedRunestone.transactionId;
    const protocol = parsedRunestone.runestone?.protocol ?? [];
    this.protostones = decodeProtostones(protocol)
      .filter(p => p.protocolTag === ALKANES_PROTOCOL_TAG);
  }

  formatAlkaneId(block: bigint, tx: bigint): string {
    return `${block}:${tx}`;
  }

  // Common opcodes from the alkanes-runtime MessageDispatch / Token traits.
  // The genesis-alkane template uses 0/1/77/78; every fungible derived from
  // the Token trait uses 99/100/101. Real contracts may override these,
  // hence the tooltip + always-show-the-number rule.
  selectorLabel(selector: bigint): string | null {
    return ALKANE_SELECTOR_LABELS[selector.toString()] ?? null;
  }
}
