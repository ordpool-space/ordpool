import * as fs from 'fs';
import * as path from 'path';

/**
 * Structural invariant tests for the _ordpoolFlags pre-enrichment HACK.
 *
 * The HACK pattern (see backend/.claude/CLAUDE.md → "_ordpoolFlags pre-enrichment"):
 *   await DigitalArtifactAnalyserService.analyseTransaction(tx, 0n);
 *   tx.flags = Common.getTransactionFlags(tx);
 *
 * `analyseTransaction` sets `tx._ordpoolFlags` as a side effect; `getTransactionFlags`
 * (sync, called many places downstream) ORs that into the returned flags. If the order
 * is reversed — or if `analyseTransaction` is missing entirely — every tx going through
 * that code path reaches its consumer with zero ordpool bits, and the frontend stops
 * showing inscription/rune/CAT-21/etc. badges.
 *
 * That's exactly the bug we hit on 2026-05-04: the original refactor wired up only ONE
 * of three new-tx code paths in mempool.ts. The other two delivered tx objects with
 * `tx.flags` set but no upper-48 bits, and nobody noticed for hours because the error
 * was silent — the pipeline produced VALID flags numbers, just always missing ordpool.
 *
 * These tests don't run code; they read source files and assert that every call site
 * to `Common.getTransactionFlags(<var>)` has a matching `analyseTransaction(<var>` call
 * within the immediately preceding ~10 lines. Cheap, brittle in a useful way: they fail
 * loudly when someone adds a new code path that forgets the hook.
 */

interface FlagAssignment {
  lineNumber: number;       // 1-based, for human-readable error messages
  rawLine: string;
  varName: string;          // the tx variable being assigned: `tx.flags = ...` -> `tx`
}

/**
 * Find every line that assigns `<something>.flags = Common.getTransactionFlags(<varname>...)`
 * — that's the consumer of the pre-enrichment HACK. The tx whose `.flags` is being set is
 * the one that needs `analyseTransaction` called on it first.
 *
 * Match shape: `<lhs>.flags = Common.getTransactionFlags(<varname>`
 *   - `<lhs>` may be a chain like `this.mempoolCache[txid]` — captured as match[1] but unused
 *   - `<varname>` is captured as match[2] and is what we need to verify
 */
function findFlagAssignments(source: string): FlagAssignment[] {
  const flagAssignmentRegex = /^\s*([\w[\]\.]+)\.flags\s*=\s*Common\.getTransactionFlags\(\s*(\w+(?:\.\w+|\[\w+\])*)/;
  return source.split('\n').reduce<FlagAssignment[]>((acc, line, idx) => {
    const match = line.match(flagAssignmentRegex);
    if (match) {
      acc.push({ lineNumber: idx + 1, rawLine: line, varName: match[2] });
    }
    return acc;
  }, []);
}

/**
 * Look backward N lines from the flag-assignment line for an `analyseTransaction(<varName>` call.
 * 10 lines is enough room for surrounding HACK comments + maybe a Redis cache write between
 * the analyse call and the flags assignment.
 */
function hasPreEnrichmentWithin(source: string, flagAssignment: FlagAssignment, lookback = 10): boolean {
  const lines = source.split('\n');
  const start = Math.max(0, flagAssignment.lineNumber - 1 - lookback);
  const end = flagAssignment.lineNumber - 1; // exclude the assignment line itself
  const window = lines.slice(start, end).join('\n');
  // Match any access pattern that ends in .analyseTransaction(<varName> — covers
  // both bare `analyseTransaction(tx` and namespaced `Service.analyseTransaction(tx`.
  // Lookahead is `[,)\s]` rather than `\b` because varnames like
  // `this.mempoolCache[txid]` end in `]`, a non-word char, where `\b` won't fire.
  const escapedVar = flagAssignment.varName.replace(/[.[\]]/g, '\\$&');
  const pattern = new RegExp(`analyseTransaction\\(\\s*${escapedVar}(?=[,)\\s])`);
  return pattern.test(window);
}

const FILES_UNDER_INVARIANT = [
  // Files where flag assignments are expected to follow the pre-enrichment HACK pattern.
  // When a new file joins this list, add it here. The test will auto-discover all
  // assignments in the file and check each.
  path.join(__dirname, '..', 'api', 'mempool.ts'),
];

describe('Ordpool pre-enrichment invariant — structural lint', () => {
  describe.each(FILES_UNDER_INVARIANT)('%s', (filePath) => {

    let source: string;
    let assignments: FlagAssignment[];

    beforeAll(() => {
      source = fs.readFileSync(filePath, 'utf8');
      assignments = findFlagAssignments(source);
    });

    it('contains at least one tx.flags = Common.getTransactionFlags(...) call (sanity check the regex)', () => {
      // If this fails, either the file genuinely has zero assignments now (unexpected) or
      // the regex got out of sync with the codebase shape. Either way, the test below
      // would produce false-green silence.
      expect(assignments.length).toBeGreaterThan(0);
    });

    it('every flag assignment has analyseTransaction(<sameVar>) within 10 lines above', () => {
      const violations: string[] = [];
      for (const a of assignments) {
        if (!hasPreEnrichmentWithin(source, a)) {
          violations.push(
            `  line ${a.lineNumber}: ${a.rawLine.trim()}\n` +
            `    expected: 'await DigitalArtifactAnalyserService.analyseTransaction(${a.varName}, 0n);' within the 10 lines above`
          );
        }
      }
      if (violations.length > 0) {
        throw new Error(
          `Pre-enrichment invariant violated in ${path.basename(filePath)}:\n` +
          violations.join('\n') +
          `\n\nWithout pre-enrichment, getTransactionFlags() reads tx._ordpoolFlags === undefined ` +
          `and the resulting flags are missing all upper-48 ordpool bits. Frontend will show no ` +
          `inscription/rune/CAT-21 badges for txs that flow through this path.\n` +
          `See backend/.claude/CLAUDE.md → "_ordpoolFlags pre-enrichment".`
        );
      }
    });
  });
});

/**
 * Smoke test for the regex itself, so we know it actually matches the patterns we care about
 * (and rejects shapes that aren't real flag assignments).
 */
describe('findFlagAssignments — regex sanity', () => {
  it('matches direct tx.flags assignment', () => {
    const src = `      transaction.flags = Common.getTransactionFlags(transaction);`;
    const out = findFlagAssignments(src);
    expect(out).toHaveLength(1);
    expect(out[0].varName).toBe('transaction');
  });

  it('matches indexed cache assignment (mempool.ts pattern)', () => {
    const src = `      this.mempoolCache[txid].flags = Common.getTransactionFlags(this.mempoolCache[txid]);`;
    const out = findFlagAssignments(src);
    expect(out).toHaveLength(1);
    expect(out[0].varName).toBe('this.mempoolCache[txid]');
  });

  it('matches with height argument', () => {
    const src = `      tx.flags = Common.getTransactionFlags(tx, blockHeight);`;
    const out = findFlagAssignments(src);
    expect(out).toHaveLength(1);
    expect(out[0].varName).toBe('tx');
  });

  it('does NOT match a bare getTransactionFlags() call without an assignment', () => {
    const src = `      const flags = Common.getTransactionFlags(tx);`;
    const out = findFlagAssignments(src);
    expect(out).toHaveLength(0);
  });

  it('does NOT match a comment that mentions the pattern', () => {
    const src = `      // tx.flags = Common.getTransactionFlags(tx) is set elsewhere`;
    const out = findFlagAssignments(src);
    expect(out).toHaveLength(0);
  });
});

describe('hasPreEnrichmentWithin — window matching', () => {
  it('returns true when analyseTransaction precedes the assignment', () => {
    const src = [
      `await DigitalArtifactAnalyserService.analyseTransaction(tx, 0n);`,
      `tx.flags = Common.getTransactionFlags(tx);`,
    ].join('\n');
    const [a] = findFlagAssignments(src);
    expect(hasPreEnrichmentWithin(src, a)).toBe(true);
  });

  it('returns false when analyseTransaction is missing (the bug we just fixed)', () => {
    const src = [
      `// pre-enrichment forgotten here`,
      `tx.flags = Common.getTransactionFlags(tx);`,
    ].join('\n');
    const [a] = findFlagAssignments(src);
    expect(hasPreEnrichmentWithin(src, a)).toBe(false);
  });

  it('returns false when analyseTransaction is on a different variable', () => {
    const src = [
      `await DigitalArtifactAnalyserService.analyseTransaction(otherTx, 0n);`,
      `tx.flags = Common.getTransactionFlags(tx);`,
    ].join('\n');
    const [a] = findFlagAssignments(src);
    expect(hasPreEnrichmentWithin(src, a)).toBe(false);
  });

  it('returns false when analyseTransaction is too far above (> 10 lines)', () => {
    const src = [
      `await DigitalArtifactAnalyserService.analyseTransaction(tx, 0n);`,
      ...Array(12).fill('// filler line'),
      `tx.flags = Common.getTransactionFlags(tx);`,
    ].join('\n');
    const [a] = findFlagAssignments(src);
    expect(hasPreEnrichmentWithin(src, a)).toBe(false);
  });

  it('handles indexed-access varname (this.mempoolCache[txid])', () => {
    const src = [
      `await DigitalArtifactAnalyserService.analyseTransaction(this.mempoolCache[txid], 0n);`,
      `this.mempoolCache[txid].flags = Common.getTransactionFlags(this.mempoolCache[txid]);`,
    ].join('\n');
    const [a] = findFlagAssignments(src);
    expect(hasPreEnrichmentWithin(src, a)).toBe(true);
  });
});
