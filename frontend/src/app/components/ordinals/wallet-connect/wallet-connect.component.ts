import { ChangeDetectionStrategy, Component, inject, TemplateRef, ViewChild } from '@angular/core';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

import { KnownOrdinalWallet, KnownOrdinalWallets, KnownOrdinalWalletType, WalletService } from '../../../services/ordinals/wallet.service';


@Component({
  selector: 'app-wallet-connect',
  templateUrl: './wallet-connect.component.html',
  styleUrls: ['./wallet-connect.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletConnectComponent {

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

  connectWallet(key: KnownOrdinalWalletType): void {

    this.walletService.connectWallet(key).subscribe({
      next: () => this.modalRef.close(),
      error: () => this.modalRef.close()
    });
  }
}

