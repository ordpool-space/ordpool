import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { InscriptionPreviewService, ParsedInscription, PreviewInstructions } from 'ordpool-parser';

import { SafeHtmlPipe } from '../../safe-html.pipe';
import { SafeResourceUrlPipe } from '../../safe-url.pipe';
import { renderInscriptionViaBackend } from '../render-inscription-via-backend';

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

  // Media / rich content is served by the backend `/preview/<id>` route
  // (renderViaBackend). Inert content renders client-side from
  // previewInstructions.previewContent, which we only build in that case.
  renderViaBackend = false;
  inscriptionId: string | undefined;
  previewInstructions$: Promise<PreviewInstructions> | undefined;

  @Input()
  set parsedInscription(inscription: ParsedInscription | undefined) {
    this.renderViaBackend = renderInscriptionViaBackend(inscription?.contentType);
    this.inscriptionId = inscription?.inscriptionId;
    this.previewInstructions$ = (this.renderViaBackend || !inscription)
      ? undefined
      : InscriptionPreviewService.getPreview(inscription);
  }
}
