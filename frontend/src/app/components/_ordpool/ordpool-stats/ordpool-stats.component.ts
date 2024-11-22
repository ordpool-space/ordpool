import { AsyncPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EChartsOption } from 'echarts';
import { map, startWith, switchMap, tap } from 'rxjs/operators';

import { GraphsModule } from '../../../graphs/graphs.module';
import { OrdpoolApiService } from '../../../services/ordinals/ordpool-api.service';
import { SeoService } from '../../../services/seo.service';
import { SharedModule } from '../../../shared/shared.module';

@Component({
  selector: 'app-ordpool-stats',
  templateUrl: './ordpool-stats.component.html',
  styleUrls: ['./ordpool-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    UpperCasePipe,
    AsyncPipe,
    RouterLink,
    SharedModule,
    GraphsModule
  ]
})
export class OrdpoolStatsComponent {

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
    this.seoService.setTitle('Ordpool Stats: Ordinals and Runes related statistics');
    this.seoService.setDescription('All Bitcoin blocks, analysed for digitital assets by our independent Ordpool parser.');
  }

  chartInitOptions = {
    renderer: 'svg',
  };

  getChartOptions(statistics: any[]): EChartsOption {
    const categories = statistics.map(stat => `${stat.minHeight}-${stat.maxHeight}`);
    const inscriptionMints = statistics.map(stat => stat.inscriptionMints);
    const runeMints = statistics.map(stat => stat.runeMints);
    const brc20Mints = statistics.map(stat => stat.brc20Mints);

    const chartOptions: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        }
      },
      legend: {
        data: ['Inscriptions', 'Runes', 'BRC20']
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { rotate: 45, interval: 0 }
      },
      yAxis: {
        type: 'value'
      },
      series: [
        {
          name: 'Inscriptions',
          type: 'bar',
          stack: 'Total',
          data: inscriptionMints
        },
        {
          name: 'Runes',
          type: 'bar',
          stack: 'Total',
          data: runeMints
        },
        {
          name: 'BRC20',
          type: 'bar',
          stack: 'Total',
          data: brc20Mints
        }
      ]
    };

    return chartOptions;
  }

}
