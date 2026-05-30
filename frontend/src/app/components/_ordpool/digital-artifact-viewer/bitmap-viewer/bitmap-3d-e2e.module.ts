import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SharedModule } from '@app/shared/shared.module';
import { Bitmap3dE2EComponent } from './bitmap-3d-e2e.component';

const routes: Routes = [
  { path: '', component: Bitmap3dE2EComponent },
];

@NgModule({
  imports: [CommonModule, SharedModule, RouterModule.forChild(routes)],
  declarations: [Bitmap3dE2EComponent],
})
export class Bitmap3dE2EModule {}
