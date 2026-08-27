import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

import { PsbtExportPromptComponent } from './psbt-export-prompt.component';

describe('PsbtExportPromptComponent', () => {

  let activeModal: { close: jest.Mock; dismiss: jest.Mock };
  let component: PsbtExportPromptComponent;

  beforeEach(() => {
    activeModal = { close: jest.fn(), dismiss: jest.fn() };
    component = new PsbtExportPromptComponent(activeModal as unknown as NgbActiveModal);
  });

  it('starts with an empty unsigned placeholder', () => {
    expect(component.unsigned).toEqual({ base64: '', hex: '' });
  });

  it('submit resolves the modal with the trimmed signed PSBT', () => {
    component.signedPsbt = '  cHNidP-signed  ';
    component.submit();
    expect(activeModal.close).toHaveBeenCalledWith('cHNidP-signed');
  });

  it('submit does nothing when the signed PSBT is blank', () => {
    component.signedPsbt = '   ';
    component.submit();
    expect(activeModal.close).not.toHaveBeenCalled();
  });

  describe('download() writes a real binary PSBT', () => {

    // Capture the exact array `download()` hands to `new Blob([...])`, so we
    // can inspect the bytes without relying on jsdom's Blob (no arrayBuffer()).
    let blobParts: BlobPart[] | undefined;
    let blobType: string | undefined;
    const RealBlob = global.Blob;
    let origCreate: typeof URL.createObjectURL;
    let origRevoke: typeof URL.revokeObjectURL;
    let anchor: { href: string; download: string; click: jest.Mock };

    beforeEach(() => {
      blobParts = undefined;
      blobType = undefined;
      (global as unknown as { Blob: unknown }).Blob = class extends RealBlob {
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
          super(parts, opts);
          blobParts = parts;
          blobType = opts?.type;
        }
      };
      origCreate = URL.createObjectURL;
      origRevoke = URL.revokeObjectURL;
      URL.createObjectURL = jest.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL;
      anchor = { href: '', download: '', click: jest.fn() };
      jest.spyOn(document, 'createElement').mockReturnValue(anchor as unknown as HTMLAnchorElement);
    });

    afterEach(() => {
      (global as unknown as { Blob: unknown }).Blob = RealBlob;
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      (document.createElement as jest.Mock).mockRestore();
    });

    it('decodes the base64 PSBT to its raw bytes (magic 0x70736274ff), not base64 text', () => {
      // A minimal PSBT: magic "psbt\xff" + a couple of arbitrary bytes.
      const expected = [0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x2a];
      let binary = '';
      expected.forEach((b) => { binary += String.fromCharCode(b); });
      component.unsigned = { base64: btoa(binary), hex: '70736274ff012a' };

      component.download();

      expect(blobParts).toBeDefined();
      const bytes = blobParts![0] as Uint8Array;
      // Raw bytes (length 7), not the longer base64 TEXT (length 12).
      expect(Array.from(bytes)).toEqual(expected);
      expect(blobType).toBe('application/octet-stream');
      expect(anchor.download).toBe('cat21-mint-unsigned.psbt');
      expect(anchor.click).toHaveBeenCalled();
    });
  });
});
