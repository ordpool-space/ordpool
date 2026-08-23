import {
  CHART_METRICS,
  getLiveSelectClause,
  getRollupSelectClause,
  isRollupChart,
  rollupGroupBy,
  rollupTableDdl,
} from './ordpool-stats-daily';

const BASE_ALIASES = ['minHeight', 'maxHeight', 'minTime', 'maxTime'];
const metricAliases = (sql: string): string[] =>
  [...sql.matchAll(/AS (\w+)/g)].map((m) => m[1]).filter((a) => !BASE_ALIASES.includes(a)).sort();

describe('ordpool-stats-daily rollup SQL generation', () => {

  it('DDL: day PK + a sum/cnt pair for AVG metrics, a bare column for SUM/MAX/MIN', () => {
    const ddl = rollupTableDdl();
    expect(ddl).toContain('`day` DATE NOT NULL PRIMARY KEY');
    // AVG -> _sum + _cnt (never a bare avg column, which could not roll up)
    expect(ddl).toContain('`cat21_avg_fee_rate_sum` DOUBLE');
    expect(ddl).toContain('`cat21_avg_fee_rate_cnt` BIGINT');
    expect(ddl).toContain('`inscriptions_average_envelope_size_sum` BIGINT');
    expect(ddl).not.toMatch(/`cat21_avg_fee_rate` /);
    // SUM/MAX/MIN -> bare column; fee-rate columns are DOUBLE, counts BIGINT
    expect(ddl).toContain('`amounts_cat21_mint` BIGINT');
    expect(ddl).toContain('`cat21_max_fee_rate` DOUBLE');
    expect(ddl).toContain('`cat21_min_fee_rate` DOUBLE');
  });

  it('live select aggregates ordpool_stats columns with the chart-declared function', () => {
    const mints = getLiveSelectClause('mints');
    expect(mints).toContain('MIN(b.height) AS minHeight');
    expect(mints).toContain('SUM(bos.amounts_cat21_mint) AS cat21Mints');
    const sizes = getLiveSelectClause('inscription-sizes');
    expect(sizes).toContain('MAX(bos.inscriptions_largest_envelope_size) AS largestEnvelopeSize');
    expect(sizes).toContain('AVG(bos.inscriptions_average_envelope_size) AS avgEnvelopeSize');
  });

  it('rollup select rolls SUM/MAX/MIN directly and reconstructs AVG via sum/cnt', () => {
    const mints = getRollupSelectClause('mints');
    expect(mints).toContain('SUM(d.amounts_cat21_mint) AS cat21Mints');
    const cat = getRollupSelectClause('cat21-stats');
    expect(cat).toContain('SUM(d.cat21_avg_fee_rate_sum) / NULLIF(SUM(d.cat21_avg_fee_rate_cnt), 0) AS cat21AvgFeeRate');
    expect(cat).toContain('MIN(d.cat21_min_fee_rate) AS cat21MinFeeRate');
    expect(cat).toContain('MAX(d.cat21_max_fee_rate) AS cat21MaxFeeRate');
  });

  it('live and rollup expose EXACTLY the CHART_METRICS aliases per chart (no drift)', () => {
    for (const type of Object.keys(CHART_METRICS)) {
      const declared = CHART_METRICS[type].map((m) => m.alias).sort();
      expect(metricAliases(getLiveSelectClause(type as never))).toEqual(declared);
      expect(metricAliases(getRollupSelectClause(type as never))).toEqual(declared);
    }
  });

  it('rollupGroupBy buckets week/month/year, day by default', () => {
    expect(rollupGroupBy('week')).toContain('WEEK(d.day)');
    expect(rollupGroupBy('month')).toContain('MONTH(d.day)');
    expect(rollupGroupBy('year')).toBe('GROUP BY YEAR(d.day)');
    expect(rollupGroupBy('day')).toBe('GROUP BY d.day');
    expect(rollupGroupBy('block')).toBe('GROUP BY d.day');
  });

  it('isRollupChart excludes the satellite charts', () => {
    expect(isRollupChart('mints')).toBe(true);
    expect(isRollupChart('rune-activity')).toBe(true);
    expect(isRollupChart('atomical-ops')).toBe(false);
    expect(isRollupChart('counterparty-messages')).toBe(false);
    expect(isRollupChart('ots')).toBe(false);
  });

  it('throws on an unknown chart type', () => {
    expect(() => getLiveSelectClause('nope' as never)).toThrow('Invalid chart type');
    expect(() => getRollupSelectClause('nope' as never)).toThrow('Invalid chart type');
  });
});
