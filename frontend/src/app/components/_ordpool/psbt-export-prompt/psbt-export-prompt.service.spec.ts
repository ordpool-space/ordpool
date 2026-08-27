import { TestBed } from '@angular/core/testing';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { firstValueFrom } from 'rxjs';

import { PsbtExportPromptComponent } from './psbt-export-prompt.component';
import { PsbtExportPromptService } from './psbt-export-prompt.service';

describe('PsbtExportPromptService', () => {

  it('opens the export dialog with the unsigned PSBT and resolves with the pasted signed PSBT', async () => {
    const ref = { componentInstance: {} as { unsigned?: unknown }, result: Promise.resolve('signed-psbt') };
    const modal = { open: jest.fn(() => ref) };
    TestBed.configureTestingModule({
      providers: [
        PsbtExportPromptService,
        { provide: NgbModal, useValue: modal },
      ],
    });

    const service = TestBed.inject(PsbtExportPromptService);
    const unsigned = { base64: 'cHNidP-unsigned', hex: '70736274ff-unsigned' };

    const signed = await firstValueFrom(service.promptForSignedPsbt(unsigned));

    expect(modal.open).toHaveBeenCalledWith(PsbtExportPromptComponent, expect.objectContaining({ backdrop: 'static' }));
    expect(ref.componentInstance.unsigned).toEqual(unsigned);
    expect(signed).toBe('signed-psbt');
  });

  it('propagates a dismissed dialog as an error (the mint fails, not silently succeeds)', async () => {
    const ref = { componentInstance: {} as { unsigned?: unknown }, result: Promise.reject(new Error('cancelled')) };
    const modal = { open: jest.fn(() => ref) };
    TestBed.configureTestingModule({
      providers: [
        PsbtExportPromptService,
        { provide: NgbModal, useValue: modal },
      ],
    });

    const service = TestBed.inject(PsbtExportPromptService);
    await expect(
      firstValueFrom(service.promptForSignedPsbt({ base64: 'x', hex: 'y' })),
    ).rejects.toThrow('cancelled');
  });
});
