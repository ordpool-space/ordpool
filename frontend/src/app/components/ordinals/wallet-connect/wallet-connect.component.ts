import { ChangeDetectionStrategy, Component, inject, TemplateRef, ViewChild } from '@angular/core';
import { NgbModal, NgbModalRef, NgbPopover } from '@ng-bootstrap/ng-bootstrap';

import { KnownOrdinalWallet, KnownOrdinalWallets, KnownOrdinalWalletType, WalletService } from '../../../services/ordinals/wallet.service';


@Component({
  selector: 'app-wallet-connect',
  templateUrl: './wallet-connect.component.html',
  styleUrls: ['./wallet-connect.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletConnectComponent {

  connectButtonDisabled = false;

  modalService = inject(NgbModal);
  walletService = inject(WalletService);

  installedWallets$ = this.walletService.wallets$;
  connectedWallet$ = this.walletService.connectedWallet$;

  knownOrdinalWallets = KnownOrdinalWallets;

  modalRef: NgbModalRef;

  open(content: TemplateRef<any>): void {
    this.modalRef = this.modalService.open(content, {
      ariaLabelledBy: 'modal-basic-title',
      centered: true
    });
  }

  disconnect(popover: NgbPopover): void {
    // Close the popover
    popover.close();

    this.walletService.disconnectWallet();
  }

  connectWallet(key: KnownOrdinalWalletType): void {

    // Unisat docs:
    // https://docs.unisat.io/dev/unisat-developer-service/unisat-wallet
    // 1. You should only initiate a connection request in response to direct user action, such as clicking a button.
    // 2. You should always disable the "connect" button while the connection request is pending.
    // 3. You should never initiate a connection request on page load.
    this.connectButtonDisabled = true;

    const done = (): void => {
      this.modalRef.close();
      this.connectButtonDisabled = false;
    };

    this.walletService.connectWallet(key).subscribe({
      next: () => done(),
      error: () => done()
    });
  }
}

