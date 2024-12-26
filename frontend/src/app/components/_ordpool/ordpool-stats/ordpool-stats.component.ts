import { AsyncPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EChartsOption } from 'echarts';
import { map, startWith, switchMap, tap } from 'rxjs/operators';

import {
  Aggregation,
  ChartType,
  Interval,
  OrdpoolStatisticResponse,
} from '../../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';
import { GraphsModule } from '../../../graphs/graphs.module';
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
      type: (p.get('type') || 'mints') as ChartType,
      interval: (p.get('interval') || '1h') as Interval,
      aggregation: (p.get('aggregation') || 'block') as Aggregation
    })),
    switchMap(({ type, interval, aggregation }) => this.ordpoolApiService.getOrdpoolStatistics$(type, interval, aggregation).pipe(
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
    tap(() => this.loading = false)
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
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const dataIndex = params[0]?.dataIndex;
          const stat = statistics[dataIndex];
          return getTooltipContent(type, stat);
        },
      },
      legend: {
        show: true, // Ensure the legend is visible
        orient: 'horizontal', // Layout direction: 'horizontal' or 'vertical'
        top: 'top', // Position of the legend
        textStyle: {
          color: 'white', // Set legend text color
        },
      },

      xAxis: {
        type: 'time', // Use the time axis type for intelligent formatting
        axisLabel: {
          formatter: (value: number, index: number) => {
            const date = new Date(value);
            return date.toLocaleString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }); // Adjust based on preferred locale
          },
          rotate: 45, // Rotate labels for better readability
          color: 'white',
        },
        axisTick: {
          show: true, // Enables axis ticks
        },
        splitLine: {
          show: true, // Optional: Adds grid lines for clarity
        },
      },
      
      yAxis: {
        type: 'value',
      },
      series: getSeriesData(type, statistics),
    };
  }
}