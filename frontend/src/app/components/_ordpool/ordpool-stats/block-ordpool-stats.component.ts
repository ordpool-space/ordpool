import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { OrdpoolStats } from 'ordpool-parser';

import { Price } from '../../../services/price.service';
import { SharedModule } from '../../../shared/shared.module';
import { MiniInscriptionViewerComponent } from '../digital-artifact-viewer/inscription-viewer/mini-inscription-viewer.component';

@Component({
  selector: 'app-block-ordpool-stats',
  templateUrl: './block-ordpool-stats.component.html',
  styleUrls: ['./block-ordpool-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SharedModule,
    MiniInscriptionViewerComponent
  ],
  host: {
    style: 'display: contents'
  }
})
export class BlockOrdpoolStatsComponent {

  @Input() ordpoolStats: OrdpoolStats | undefined = undefined;
  @Input() showSkeleton = false;
  @Input() blockConversion: Price;
  
}

