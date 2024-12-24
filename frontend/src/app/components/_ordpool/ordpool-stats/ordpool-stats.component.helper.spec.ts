import {
  ChartType,
  FeeStatistic,
  InscriptionSizeStatistic,
  MintStatistic,
  NewTokenStatistic,
} from '../../../../../../backend/src/api/explorer/_ordpool/ordpool-statistics-interface';

import { formatTimestamp, getSeriesData, getTooltipContent }  from './ordpool-stats.component.helper'

describe('getSeriesData', () => {
  const baseStat = {
    minHeight: 1000,
    maxHeight: 2000,
    minTime: '2024-12-20T10:00:00Z',
    maxTime: '2024-12-20T11:00:00Z',
  };

  const mintStats: MintStatistic[] = [
    { ...baseStat, cat21Mints: 5, inscriptionMints: 10, runeMints: 15, brc20Mints: 20, src20Mints: 25 },
  ];

  const newTokenStats: NewTokenStatistic[] = [
    { ...baseStat, runeEtchings: 30, brc20Deploys: 40, src20Deploys: 50 },
  ];

  const feeStats: FeeStatistic[] = [
    {
      ...baseStat,
      feesCat21Mints: 1000,
      feesInscriptionMints: 2000,
      feesRuneMints: 3000,
      feesNonUncommonRuneMints: 4000,
      feesBrc20Mints: 5000,
      feesSrc20Mints: 6000,
    },
  ];

  const inscriptionSizeStats: InscriptionSizeStatistic[] = [
    {
      ...baseStat,
      totalEnvelopeSize: 7000,
      totalContentSize: 8000,
      largestEnvelopeSize: 9000,
      largestContentSize: 10000,
      avgEnvelopeSize: 1100,
      avgContentSize: 1200,
    },
  ];

  it('should generate correct series data for mints', () => {
    const result = getSeriesData('mints', mintStats);
    expect(result).toEqual([
      { name: 'CAT-21', type: 'line', data: [5] },
      { name: 'Inscriptions', type: 'line', data: [10] },
      { name: 'Runes', type: 'line', data: [15] },
      { name: 'BRC-20', type: 'line', data: [20] },
      { name: 'SRC-20', type: 'line', data: [25] },
    ]);
  });

  it('should generate correct series data for new-tokens', () => {
    const result = getSeriesData('new-tokens', newTokenStats);
    expect(result).toEqual([
      { name: 'Rune Etchings', type: 'line', data: [30] },
      { name: 'BRC-20 Deploys', type: 'line', data: [40] },
      { name: 'SRC-20 Deploys', type: 'line', data: [50] },
    ]);
  });

  it('should generate correct series data for fees', () => {
    const result = getSeriesData('fees', feeStats);
    expect(result).toEqual([
      { name: 'CAT-21', type: 'line', data: [1000] },
      { name: 'Inscriptions', type: 'line', data: [2000] },
      { name: 'Runes', type: 'line', data: [3000] },
      { name: 'Runes (excluding ⧉ UNCOMMON•GOODS)', type: 'line', data: [4000] },
      { name: 'BRC-20', type: 'line', data: [5000] },
      { name: 'SRC-20', type: 'line', data: [6000] },
    ]);
  });

  it('should generate correct series data for inscription-sizes', () => {
    const result = getSeriesData('inscription-sizes', inscriptionSizeStats);
    expect(result).toEqual([
      { name: 'Total Envelope Size', type: 'line', data: [7000] },
      { name: 'Total Content Size', type: 'line', data: [8000] },
      { name: 'Largest Envelope Size', type: 'line', data: [9000] },
      { name: 'Largest Content Size', type: 'line', data: [10000] },
      { name: 'Average Envelope Size', type: 'line', data: [1100] },
      { name: 'Average Content Size', type: 'line', data: [1200] },
    ]);
  });

  it('should throw an error for unsupported chart type', () => {
    expect(() => {
      getSeriesData('unsupported-type' as ChartType, []);
    }).toThrow('Unsupported chart type: unsupported-type');
  });

  it('should handle empty statistics gracefully', () => {
    const result = getSeriesData('mints', []);
    expect(result).toEqual([
      { name: 'CAT-21', type: 'line', data: [] },
      { name: 'Inscriptions', type: 'line', data: [] },
      { name: 'Runes', type: 'line', data: [] },
      { name: 'BRC-20', type: 'line', data: [] },
      { name: 'SRC-20', type: 'line', data: [] },
    ]);
  });
});

describe('getTooltipContent', () => {
  const baseStat = {
    minHeight: 1000,
    maxHeight: 2000,
    minTime: '2024-12-20T10:00:00Z',
    maxTime: '2024-12-20T11:00:00Z',
  };

  const mintStat: MintStatistic = {
    ...baseStat,
    cat21Mints: 5,
    inscriptionMints: 10,
    runeMints: 15,
    brc20Mints: 20,
    src20Mints: 25,
  };

  const newTokenStat: NewTokenStatistic = {
    ...baseStat,
    runeEtchings: 30,
    brc20Deploys: 40,
    src20Deploys: 50,
  };

  const feeStat: FeeStatistic = {
    ...baseStat,
    feesCat21Mints: 1000,
    feesInscriptionMints: 2000,
    feesRuneMints: 3000,
    feesNonUncommonRuneMints: 4000,
    feesBrc20Mints: 5000,
    feesSrc20Mints: 6000,
  };

  const inscriptionSizeStat: InscriptionSizeStatistic = {
    ...baseStat,
    totalEnvelopeSize: 7000,
    totalContentSize: 8000,
    largestEnvelopeSize: 9000,
    largestContentSize: 10000,
    avgEnvelopeSize: 1100,
    avgContentSize: 1200,
  };

  it('should generate correct tooltip content for mints', () => {
    const result = getTooltipContent('mints', mintStat);
    expect(result).toContain('CAT-21: 5');
    expect(result).toContain('Inscriptions: 10');
    expect(result).toContain('Runes: 15');
    expect(result).toContain('BRC-20: 20');
    expect(result).toContain('SRC-20: 25');
  });

  it('should generate correct tooltip content for new-tokens', () => {
    const result = getTooltipContent('new-tokens', newTokenStat);
    expect(result).toContain('Rune Etchings: 30');
    expect(result).toContain('BRC-20 Deploys: 40');
    expect(result).toContain('SRC-20 Deploys: 50');
  });

  it('should generate correct tooltip content for fees', () => {
    const result = getTooltipContent('fees', feeStat);
    expect(result).toContain('CAT-21: 1000');
    expect(result).toContain('Inscriptions: 2000');
    expect(result).toContain('Runes: 3000');
    expect(result).toContain('Runes (excluding ⧉ UNCOMMON•GOODS): 4000');
    expect(result).toContain('BRC-20: 5000');
    expect(result).toContain('SRC-20: 6000');
  });

  it('should generate correct tooltip content for inscription-sizes', () => {
    const result = getTooltipContent('inscription-sizes', inscriptionSizeStat);
    expect(result).toContain('Total Envelope Size: 7000');
    expect(result).toContain('Total Content Size: 8000');
    expect(result).toContain('Largest Envelope Size: 9000');
    expect(result).toContain('Largest Content Size: 10000');
    expect(result).toContain('Average Envelope Size: 1100');
    expect(result).toContain('Average Content Size: 1200');
  });

  it('should throw an error for unsupported chart type', () => {
    expect(() => getTooltipContent('unsupported-type' as ChartType, mintStat)).toThrow(
      'Unsupported chart type: unsupported-type'
    );
  });
});

describe('formatTimestamp', () => {
  it('should format a valid ISO timestamp correctly', () => {
    const input = '2024-12-22T15:03:22.454Z';
    const output = '2024-12-22 15:03:22';
    expect(formatTimestamp(input)).toBe(output);
  });

  it('should handle timestamps without milliseconds', () => {
    const input = '2024-12-22T15:03:22Z';
    const output = '2024-12-22 15:03:22';
    expect(formatTimestamp(input)).toBe(output);
  });
});
