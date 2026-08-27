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
});
