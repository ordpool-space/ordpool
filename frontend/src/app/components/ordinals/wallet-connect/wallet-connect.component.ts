import { ChangeDetectionStrategy, Component, inject, TemplateRef, ViewChild } from '@angular/core';
import { NgbModal, NgbModalRef, NgbPopover } from '@ng-bootstrap/ng-bootstrap';

import { KnownOrdinalWallets, KnownOrdinalWalletType, WalletService } from '../../../services/ordinals/wallet.service';


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
  walletConnectRequested$ = this.walletService.walletConnectRequested$;

  knownOrdinalWallets = KnownOrdinalWallets;

  @ViewChild('connect') connectTemplateRef: TemplateRef<any>;
  modalRef: NgbModalRef;

  constructor() {
    this.walletConnectRequested$.subscribe(() => this.open());

  }

  open(): void {
    this.connectButtonDisabled = false;

    this.modalRef = this.modalService.open(this.connectTemplateRef, {
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

    if (key !== KnownOrdinalWalletType.leather) { // leather has no cancel event
      this.connectButtonDisabled = true;
    }

    const done = (): void => {
      this.modalRef.close();
      this.connectButtonDisabled = false;
    };

    this.walletService.connectWallet(key).subscribe({
      next: () => done(),
      error: (err) => { console.log('*** Error while connecting ***', err); done(); }
    });
  }
}

