import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { SafeResourceUrlPipe } from '../../safe-url.pipe';


@Component({
  selector: 'app-mini-inscription-viewer',
  templateUrl: './mini-inscription-viewer.component.html',
  styleUrls: ['./mini-inscription-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [SafeResourceUrlPipe]
})
export class MiniInscriptionViewerComponent {

  @Input()
  inscriptionId: string | undefined;
}
