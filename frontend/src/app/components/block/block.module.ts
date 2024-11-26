import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule } from '@angular/router';
import { BlockComponent } from './block.component';
import { SharedModule } from '../../shared/shared.module';
import { MiniInscriptionViewerComponent } from '../_ordpool/digital-artifact-viewer/inscription-viewer/mini-inscription-viewer.component';


const routes: Routes = [
  {
    path: ':id',
    component: BlockComponent,
    data: {
      ogImage: true
    }
  }
];

@NgModule({
  imports: [
    RouterModule.forChild(routes)
  ],
  exports: [
    RouterModule
  ]
})
export class BlockRoutingModule { }

@NgModule({
  imports: [
    CommonModule,
    BlockRoutingModule,
    SharedModule,
    MiniInscriptionViewerComponent
  ],
  declarations: [
    BlockComponent,
  ]
})
export class BlockModule { }






