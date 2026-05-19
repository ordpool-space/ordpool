import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import {
  ALKANES_PROTOCOL_TAG,
  ParsedProtostone,
  ParsedRunestone,
  decodeProtostones,
} from 'ordpool-parser';
import { Observable } from 'rxjs';
import { AlkaneMetadata, AlkanesApiService } from '../../../../services/ordinals/alkanes-api.service';

/** Renders the Alkanes protostones (protocol_tag = 1) from a Runestone. */
@Component({
  selector: 'app-alkanes-viewer',
  templateUrl: './alkanes-viewer.component.html',
  styleUrls: ['./alkanes-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AlkanesViewerComponent {

  private alkanesApi = inject(AlkanesApiService);

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

  getAlkaneDetails(block: bigint, tx: bigint): Observable<AlkaneMetadata | null> {
    return this.alkanesApi.getAlkaneDetails(block, tx);
  }

  formatAlkaneId(block: bigint, tx: bigint): string {
    return `${block}:${tx}`;
  }
}
