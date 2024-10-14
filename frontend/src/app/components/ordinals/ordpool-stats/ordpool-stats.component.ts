import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { map, startWith, switchMap, tap } from 'rxjs/operators';

import { OrdpoolApiService } from '../../../services/ordinals/ordpool-api.service';
import { SeoService } from '../../../services/seo.service';

@Component({
  selector: 'app-ordpool-stats',
  templateUrl: './ordpool-stats.component.html',
  styleUrls: ['./ordpool-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrdpoolStatsComponent  {

  loading = false;

  private route = inject(ActivatedRoute);
  private ordpoolApiService = inject(OrdpoolApiService);
  private seoService = inject(SeoService);

  statistics$ = this.route.paramMap.pipe(
    tap(() => this.loading = true),
    map(p => ({ 
      interval: p.get('interval') || '1h',
      aggregation: p.get('aggregation') || 'block'
    })),
    switchMap(({ interval, aggregation }) => this.ordpoolApiService.getOrdpoolStatistics$(interval, aggregation).pipe(
      startWith([]),
      map(stats => ({
        interval,
        aggregation,
        stats
      }))
    )),
    tap(() => this.loading = false)
  );

  constructor() {
    this.seoService.setTitle('Ordpool Stats: Ordinals related statistics');
    // this.seoService.setDescription($localize`:@@meta.description.bitcoin.graphs.mempool:See mempool size (in MvB) and transactions per second (in vB/s) visualized over time.`);
  }
}
