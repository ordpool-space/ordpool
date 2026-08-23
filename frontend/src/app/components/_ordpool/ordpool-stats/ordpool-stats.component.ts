import { AsyncPipe, DecimalPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EChartsOption } from 'echarts';
import { echarts } from '../../../graphs/echarts';

import { map, share, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';

import {
  Aggregation,
  ChartType,
  Interval,
  OrdpoolStatisticResponse,
} from '../../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';
import { GraphsModule } from '../../../graphs/graphs.module';
import { IndexerProgressService } from '../../../services/ordinals/indexer-progress.service';
import { OrdpoolApiService } from '../../../services/ordinals/ordpool-api.service';
import { SeoService } from '../../../services/seo.service';
import { SharedModule } from '../../../shared/shared.module';
import {
  formatChartDescription,
  formatChartHeading,
  getSeriesData,
  getTooltipContent,
} from './ordpool-stats.component.helper';

@Component({
  selector: 'app-ordpool-stats',
  templateUrl: './ordpool-stats.component.html',
  styleUrls: ['./ordpool-stats.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    UpperCasePipe,
    AsyncPipe,
    DecimalPipe,
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
  private indexerProgress = inject(IndexerProgressService);

  /** Live indexer-progress payload, polled once per minute. The template
   *  reads this with the async pipe to render the lag/skip banner. */
  indexerProgress$ = this.indexerProgress.progress$;

  statistics$ = this.route.paramMap.pipe(
    tap(() => this.loading = true),
    map(p => ({
      type: (p.get('type') || 'mints') as ChartType,
      interval: (p.get('interval') || '1h') as Interval,
      aggregation: (p.get('aggregation') || 'block') as Aggregation
    })),
    switchMap(({ type, interval, aggregation }) => this.ordpoolApiService.getOrdpoolStatistics$(type, interval, aggregation).pipe(
      tap(() => this.loading = false),
      startWith([]),
      map(stats => ({
        type,
        interval,
        aggregation,
        stats,
        heading: formatChartHeading(type),
        description: formatChartDescription(type, interval, aggregation)
      }))
    )),
    // Two async pipes in the template consume statistics$; without a shared
    // terminal each opens its own subscription and fires the stats API twice
    // per navigation.
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  constructor() {
    this.seoService.setTitle('Ordpool Stats: Ordinals and Runes related statistics');
    this.seoService.setDescription('All Bitcoin blocks, analyzed for digital assets by our independent Ordpool parser.');
  }

  chartInitOptions = {
    renderer: 'svg',
  };

  /**
   * Generate ECharts options dynamically based on statistics type and data.
   * @param type The chart type (e.g., 'mints', 'fees', etc.)
   * @param statistics The statistics data to visualize.
   */
  getChartOptions(type: ChartType, statistics: OrdpoolStatisticResponse[]): EChartsOption {
    
    // Convert UNIX seconds to milliseconds for ECharts
    statistics = statistics.map(stat => ({
      ...stat,
      minTime: stat.minTime * 1000, // Convert seconds to milliseconds
      maxTime: stat.maxTime * 1000, // Convert seconds to milliseconds
    }));

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line'
        },
        backgroundColor: 'rgba(17, 19, 31, 1)',
        borderRadius: 4,
        shadowColor: 'rgba(0, 0, 0, 0.5)',
        textStyle: {
          color: '#b1b1b1',
          align: 'left',
        },
        borderColor: '#FF9900',
        formatter: (params: any) => {
          const stat = statistics[params[0]?.dataIndex];
          return getTooltipContent(type, stat);
        },
      },
      legend: {
        show: true,
        orient: 'horizontal',
        top: 'top',
        textStyle: {
          color: 'white'
        },
      },
      xAxis: {
        type: 'time',
        splitNumber: this.isMobile() ? 5 : 10,
        axisLabel: {
          hideOverlap: true,
        }
      },
      yAxis: {
        type: 'value'
      },
      series: getSeriesData(type, statistics).map(x => ({ 
        ...x, 

        showSymbol: false,
        symbol: 'circle',
        symbolSize: 8,
        areaStyle: {
          opacity: 0.3,
        },
        // triggerLineEvent: true,
        smooth: false,
        step: 'start'
      })),
    };
  }

  onChartInit(_chartInstance) {
    // ECharts init hook wired via the template's (chartInit) output. No click
    // behaviour is attached: the tooltip already surfaces the hovered stat.
  }

  isMobile() {
    return (window.innerWidth <= 767.98);
  }
}