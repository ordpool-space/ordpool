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
    const categories = statistics.map(stat => `${stat.minHeight}-${stat.maxHeight}`);
  
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Inscriptions', 'Runes', 'BRC20', 'SRC20'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 45, interval: 0, color: 'white' } },
      yAxis: { type: 'value' },
      series: [
        { name: 'Inscriptions', type: 'bar', data: statistics.map(stat => +stat.inscriptionMints) },
        { name: 'Runes', type: 'bar', data: statistics.map(stat => +stat.runeMints) },
        { name: 'BRC20', type: 'bar', data: statistics.map(stat => +stat.brc20Mints) },
        { name: 'SRC20', type: 'bar', data: statistics.map(stat => +stat.src20Mints) }
      ]
    };
  }
  
  getNewTokensOptions(statistics: OrdpoolStatisticResponse[]): EChartsOption {
    const categories = statistics.map(stat => `${stat.minHeight}-${stat.maxHeight}`);
  
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Rune Etchings', 'BRC20 Deploys', 'SRC20 Deploys'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 45, interval: 0, color: 'white' } },
      yAxis: { type: 'value' },
      series: [
        { name: 'Rune Etchings', type: 'bar', data: statistics.map(stat => +stat.runeEtchings) },
        { name: 'BRC20 Deploys', type: 'bar', data: statistics.map(stat => +stat.brc20Deploys) },
        { name: 'SRC20 Deploys', type: 'bar', data: statistics.map(stat => +stat.src20Deploys) }
      ]
    };
  }
  
  getFeesOptions(statistics: OrdpoolStatisticResponse[]): EChartsOption {
    const categories = statistics.map(stat => `${stat.minHeight}-${stat.maxHeight}`);
  
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Rune Mints', 'BRC20 Mints', 'SRC20 Mints', 'Inscriptions'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 45, interval: 0, color: 'white' } },
      yAxis: { type: 'value' },
      series: [
        { name: 'Rune Mints', type: 'bar', data: statistics.map(stat => +stat.feesRuneMints) },
        { name: 'BRC20 Mints', type: 'bar', data: statistics.map(stat => +stat.feesBrc20Mints) },
        { name: 'SRC20 Mints', type: 'bar', data: statistics.map(stat => +stat.feesSrc20Mints) },
        { name: 'Inscriptions', type: 'bar', data: statistics.map(stat => +stat.feesInscriptionMints) }
      ]
    };
  }
  
  getInscriptionSizesOptions(statistics: OrdpoolStatisticResponse[]): EChartsOption {
    const categories = statistics.map(stat => `${stat.minHeight}-${stat.maxHeight}`);
  
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { data: ['Avg Envelope', 'Avg Content', 'Max Envelope', 'Max Content'], textStyle: { color: 'white' } },
      xAxis: { type: 'category', data: categories, axisLabel: { rotate: 45, interval: 0, color: 'white' } },
      yAxis: { type: 'value' },
      series: [
        { name: 'Avg Envelope', type: 'bar', data: statistics.map(stat => +stat.avgInscriptionsTotalEnvelopeSize) },
        { name: 'Avg Content', type: 'bar', data: statistics.map(stat => +stat.avgInscriptionsTotalContentSize) },
        { name: 'Max Envelope', type: 'bar', data: statistics.map(stat => +stat.maxInscriptionsTotalEnvelopeSize) },
        { name: 'Max Content', type: 'bar', data: statistics.map(stat => +stat.maxInscriptionsTotalContentSize) }
      ]
    };
  }
}

