import {
  CHART_METRICS,
  getLiveSelectClause,
  getRollupSelectClause,
  getSatelliteRollupRead,
  isRollupChart,
  rollupGroupBy,
  rollupTableDdl,
  satelliteRollupDdls,
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

describe('ordpool-stats-daily satellite rollups', () => {

  it('creates one rollup table per satellite chart (discriminator PK for breakdowns, day PK for totals)', () => {
    const ddls = satelliteRollupDdls();
    expect(ddls).toHaveLength(3);

    const atomical = ddls.find((d) => d.includes('ordpool_stats_atomical_op_daily')) ?? '';
    expect(atomical).toContain('`operation` VARCHAR(16) NOT NULL');
    expect(atomical).toContain('`count` BIGINT');
    expect(atomical).toContain('PRIMARY KEY (`day`, `operation`)');

    const ots = ddls.find((d) => d.includes('ordpool_stats_ots_daily')) ?? '';
    expect(ots).toContain('PRIMARY KEY (`day`)');
    expect(ots).not.toContain('operation');
  });

  it('breakdown read groups by bucket + discriminator and SUMs the daily counts', () => {
    const sql = getSatelliteRollupRead('atomical-ops', '1 YEAR', 'day') ?? '';
    expect(sql).toContain('FROM ordpool_stats_atomical_op_daily d');
    expect(sql).toContain('d.operation AS operation');
    expect(sql).toContain('SUM(d.count) AS count');
    expect(sql).toContain('GROUP BY d.day, d.operation');
  });

  it('counterparty read aliases message_type -> messageType and buckets by month', () => {
    const sql = getSatelliteRollupRead('counterparty-messages', '1 YEAR', 'month') ?? '';
    expect(sql).toContain('d.message_type AS messageType');
    expect(sql).toContain('GROUP BY YEAR(d.day), MONTH(d.day), d.message_type');
  });

  it('total (ots) read has no discriminator', () => {
    const sql = getSatelliteRollupRead('ots', '1 YEAR', 'day') ?? '';
    expect(sql).toContain('FROM ordpool_stats_ots_daily d');
    expect(sql).toContain('SUM(d.count) AS count');
    expect(sql).not.toContain('operation');
    expect(sql).toContain('GROUP BY d.day');
  });

  it('returns null for a non-satellite chart', () => {
    expect(getSatelliteRollupRead('mints', '1 YEAR', 'day')).toBeNull();
  });
});
