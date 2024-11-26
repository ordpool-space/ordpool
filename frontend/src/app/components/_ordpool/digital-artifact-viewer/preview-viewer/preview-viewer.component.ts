import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { InscriptionPreviewService, ParsedInscription, PreviewInstructions } from 'ordpool-parser';

import { SafeHtmlPipe } from '../../safe-html.pipe';
import { SafeResourceUrlPipe } from '../../safe-url.pipe';

@Component({
  selector: 'app-preview-viewer',
  templateUrl: './preview-viewer.component.html',
  styleUrls: ['./preview-viewer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [SafeResourceUrlPipe, SafeHtmlPipe, AsyncPipe]
})
export class PreviewViewerComponent {

  cd = inject(ChangeDetectorRef);
  previewInstructions$: Promise<PreviewInstructions>;

  @Input()
  set parsedInscription(inscription: ParsedInscription | undefined) {
    this.previewInstructions$ = InscriptionPreviewService.getPreview(inscription);
  }
}
