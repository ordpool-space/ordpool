import { Component, OnInit, LOCALE_ID, Inject, ViewChild, ElementRef, inject, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { UntypedFormGroup, UntypedFormBuilder, FormGroup, FormBuilder } from '@angular/forms';
import { of, merge} from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { OptimizedMempoolStats } from '../../../interfaces/node-api.interface';
import { WebsocketService } from '../../../services/websocket.service';
import { ApiService } from '../../../services/api.service';

import { OrdpoolApiService } from '../../../services/ordinals/ordpool-api.service'; 
import { StateService } from '../../../services/state.service';
import { SeoService } from '../../../services/seo.service';
import { StorageService } from '../../../services/storage.service';

@Component({
  selector: 'app-ordpool-stats',
  templateUrl: './ordpool-stats.component.html',
  styleUrls: ['./ordpool-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrdpoolStatsComponent  {

  spinnerLoading = false;
  radioGroupForm: FormGroup;
  graphWindowPreference: string;

  private formBuilder = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  private ordpoolApiService = inject(OrdpoolApiService);
  public stateService = inject(StateService);
  private seoService = inject(SeoService);
  private storageService = inject(StorageService);

  constructor() {

    this.graphWindowPreference = this.storageService.getValue('graphWindowPreference') ? 
                                  this.storageService.getValue('graphWindowPreference') : '2h';


    this.seoService.setTitle('Ordpool Stats: Ordinals related statistics');
    // this.seoService.setDescription($localize`:@@meta.description.bitcoin.graphs.mempool:See mempool size (in MvB) and transactions per second (in vB/s) visualized over time.`);

    this.radioGroupForm = this.formBuilder.group({
      dateSpan: this.graphWindowPreference
    });

    // Handle URL fragment (for adjusting dateSpan based on fragment)
    this.route.fragment.subscribe((fragment) => {
      const validFragments = ['1h', '24h', '1w', '1m', '3m', '6m', '1y', '2y', '3y', '4y', 'all'];
      if (validFragments.indexOf(fragment) > -1) {
        this.radioGroupForm.controls.dateSpan.setValue(fragment, { emitEvent: false });
      } else {
        this.radioGroupForm.controls.dateSpan.setValue('1h', { emitEvent: false });
      }
    });

    merge(
      of(''),
      this.radioGroupForm.controls.dateSpan.valueChanges
    )
    .pipe(
      switchMap(() => {
        this.spinnerLoading = true;
        if (this.radioGroupForm.controls.dateSpan.value === '2h') {
          return this.apiService.list2HStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '24h') {
          return this.apiService.list24HStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '1w') {
          return this.apiService.list1WStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '1m') {
          return this.apiService.list1MStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '3m') {
          return this.apiService.list3MStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '6m') {
          return this.apiService.list6MStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '1y') {
          return this.apiService.list1YStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '2y') {
          return this.apiService.list2YStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '3y') {
          return this.apiService.list3YStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === '4y') {
          return this.apiService.list4YStatistics$();
        }
        if (this.radioGroupForm.controls.dateSpan.value === 'all') {
          return this.apiService.listAllTimeStatistics$();
        }
      })
    )
    .subscribe((mempoolStats: any) => {
      this.spinnerLoading = false;
    });
  }

  saveGraphPreference() {
    this.storageService.setValue('graphWindowPreference', this.radioGroupForm.controls.dateSpan.value);
  }

  isMobile() {
    return (window.innerWidth <= 767.98);
  }
}
