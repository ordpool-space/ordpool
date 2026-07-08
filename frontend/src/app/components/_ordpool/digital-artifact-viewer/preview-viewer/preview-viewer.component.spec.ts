import { TestBed } from '@angular/core/testing';
import { InscriptionPreviewService, ParsedInscription, PreviewInstructions } from 'ordpool-parser';

import { PreviewViewerComponent } from './preview-viewer.component';

describe('PreviewViewerComponent', () => {
  let component: PreviewViewerComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PreviewViewerComponent],
    }).overrideComponent(PreviewViewerComponent, { set: { template: '' } });
    component = TestBed.createComponent(PreviewViewerComponent).componentInstance;
  });

  const inscription = (contentType: string): ParsedInscription =>
    ({ contentType, inscriptionId: 'deadbeefi0', uniqueId: 'deadbeefi0' } as ParsedInscription);

  it('serves a media inscription from the backend and builds no client-side preview', () => {
    component.parsedInscription = inscription('image/png');

    expect(component.renderViaBackend).toBe(true);
    expect(component.inscriptionId).toBe('deadbeefi0');
    expect(component.previewInstructions$).toBeUndefined();
  });

  it('builds the client-side preview for inert text', async () => {
    const sentinel = { previewContent: 'SENTINEL', renderDirectly: false, instructionsFor: 'deadbeefi0' } as PreviewInstructions;
    jest.spyOn(InscriptionPreviewService, 'getPreview').mockResolvedValue(sentinel);

    component.parsedInscription = inscription('text/plain');

    expect(component.renderViaBackend).toBe(false);
    await expect(component.previewInstructions$).resolves.toBe(sentinel);
  });

  it('builds nothing for an undefined inscription', () => {
    component.parsedInscription = undefined;

    expect(component.renderViaBackend).toBe(false);
    expect(component.inscriptionId).toBeUndefined();
    expect(component.previewInstructions$).toBeUndefined();
  });
});
