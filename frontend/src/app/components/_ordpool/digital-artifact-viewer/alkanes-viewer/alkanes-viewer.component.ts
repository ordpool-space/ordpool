import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import {
  ALKANES_PROTOCOL_TAG,
  ALKANE_SELECTOR_LABELS,
  ParsedProtostone,
  ParsedRunestone,
  decodeProtostones,
} from 'ordpool-parser';
import { AlkanesApiService } from '../../../../services/ordinals/alkanes-api.service';

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

  selectorLabel(selector: bigint): string | null {
    return ALKANE_SELECTOR_LABELS[selector.toString()] ?? null;
  }
}
