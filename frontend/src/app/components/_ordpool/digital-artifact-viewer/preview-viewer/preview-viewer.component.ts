import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { InscriptionPreviewService, ParsedInscription, PreviewInstructions } from 'ordpool-parser';


@Component({
  selector: 'app-preview-viewer',
  templateUrl: './preview-viewer.component.html',
  styleUrls: ['./preview-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreviewViewerComponent {

  cd = inject(ChangeDetectorRef);

  public previewInstructions: PreviewInstructions;

  @Input()
  public set parsedInscription(inscription: ParsedInscription | undefined) {
    (async () => {
      this.previewInstructions = await InscriptionPreviewService.getPreview(inscription);

      // because of the async wrapper
      this.cd.detectChanges();
    })();
  }
}
