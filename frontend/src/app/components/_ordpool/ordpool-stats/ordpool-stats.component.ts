import { AsyncPipe, UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EChartsOption } from 'echarts';
import { map, startWith, switchMap, tap } from 'rxjs/operators';

import {
  Aggregation,
  ChartType,
  Interval,
  isFeeStatistic,
  isInscriptionSizeStatistic,
  isMintStatistic,
  isNewTokenStatistic,
  OrdpoolStatisticResponse,
} from '../../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';
import { GraphsModule } from '../../../graphs/graphs.module';
import { OrdpoolApiService } from '../../../services/ordinals/ordpool-api.service';
import { SeoService } from '../../../services/seo.service';
import { SharedModule } from '../../../shared/shared.module';
import { CapitalizeFirstPipe } from '../digital-artifact-viewer/cat21-viewer/capitalize-first.pipe';

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
    GraphsModule,
    CapitalizeFirstPipe
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
      interval: p.get('interval') || '1h' as Interval,
      aggregation: p.get('aggregation') || 'block' as Aggregation
    })),
    switchMap(({ type, interval, aggregation }) => this.ordpoolApiService.getOrdpoolStatistics$(type, interval, aggregation).pipe(
      startWith([]),
      map(stats => ({
        type,
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

  getOptions(type: ChartType, statistics: OrdpoolStatisticResponse[]): EChartsOption {
    switch(type) {
      case 'mints': return this.getMintsOptions(statistics);
      case 'new-tokens': return this.getNewTokensOptions(statistics);
      case 'fees': return this.getFeesOptions(statistics);
      case 'inscription-sizes': return this.getInscriptionSizesOptions(statistics);
    } 
  }

  getMintsOptions(statistics: OrdpoolStatisticResponse[]): EChartsOption {
    const stats = statistics.filter(isMintStatistic);
  
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Inscriptions', 'Runes', 'BRC20', 'SRC20'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: stats.map(stat => `${stat.minHeight}-${stat.maxHeight}`), axisLabel: { rotate: 45, interval: 0, color: 'white' } },
      yAxis: { type: 'value' },
      series: [
        { name: 'Inscriptions', type: 'bar', data: stats.map(stat => +stat.inscriptionMints) },
        { name: 'Runes', type: 'bar', data: stats.map(stat => +stat.runeMints) },
        { name: 'BRC20', type: 'bar', data: stats.map(stat => +stat.brc20Mints) },
        { name: 'SRC20', type: 'bar', data: stats.map(stat => +stat.src20Mints) }
      ]
    };
  }
  
  getNewTokensOptions(statistics: OrdpoolStatisticResponse[]): EChartsOption {
    const stats = statistics.filter(isNewTokenStatistic);
  
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Rune Etchings', 'BRC20 Deploys', 'SRC20 Deploys'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: stats.map(stat => `${stat.minHeight}-${stat.maxHeight}`), axisLabel: { rotate: 45, interval: 0, color: 'white' } },
      yAxis: { type: 'value' },
      series: [
        { name: 'Rune Etchings', type: 'bar', data: stats.map(stat => +stat.runeEtchings) },
        { name: 'BRC20 Deploys', type: 'bar', data: stats.map(stat => +stat.brc20Deploys) },
        { name: 'SRC20 Deploys', type: 'bar', data: stats.map(stat => +stat.src20Deploys) }
      ]
    };
  }
  
  getFeesOptions(statistics: OrdpoolStatisticResponse[]): EChartsOption {
    const stats = statistics.filter(isFeeStatistic);
  
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Rune Mints', 'BRC20 Mints', 'SRC20 Mints', 'Inscriptions'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: stats.map(stat => `${stat.minHeight}-${stat.maxHeight}`), axisLabel: { rotate: 45, interval: 0, color: 'white' } },
      yAxis: { type: 'value' },
      series: [
        { name: 'Rune Mints', type: 'bar', data: stats.map(stat => +stat.feesRuneMints) },
        { name: 'BRC20 Mints', type: 'bar', data: stats.map(stat => +stat.feesBrc20Mints) },
        { name: 'SRC20 Mints', type: 'bar', data: stats.map(stat => +stat.feesSrc20Mints) },
        { name: 'Inscriptions', type: 'bar', data: stats.map(stat => +stat.feesInscriptionMints) }
      ]
    };
  }
  
  getInscriptionSizesOptions(statistics: OrdpoolStatisticResponse[]): EChartsOption {
    const stats = statistics.filter(isInscriptionSizeStatistic);

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Total Envelope', 'Total Content', 'Largest Envelope', 'Largest Content'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: stats.map(stat => `${stat.minHeight}-${stat.maxHeight}`), axisLabel: { rotate: 45, interval: 0, color: 'white' } }, 
      yAxis: { type: 'value' },
      series: [
        { name: 'Total Envelope', type: 'bar', data: stats.map(stat => +stat.totalEnvelopeSize) },
        { name: 'Total Content', type: 'bar', data: stats.map(stat => +stat.totalContentSize) },
        { name: 'Largest Envelope', type: 'bar', data: stats.map(stat => +stat.largestEnvelopeSize) },
        { name: 'Largest Content', type: 'bar', data: stats.map(stat => +stat.largestContentSize) }
      ]
    };
  }
}

