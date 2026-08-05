const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  formatCoverageEmoji,
  parseLcovSummary,
  parseLcovList,
  formatSummaryTable,
  formatFilesTable,
  parseThresholds,
} = require('../src/format');

test('formatCoverageEmoji returns green for >= 90%', () => {
  assert.equal(formatCoverageEmoji(90), '🟢');
  assert.equal(formatCoverageEmoji(100), '🟢');
});

test('formatCoverageEmoji returns yellow for 70-89%', () => {
  assert.equal(formatCoverageEmoji(70), '🟡');
  assert.equal(formatCoverageEmoji(89.9), '🟡');
});

test('formatCoverageEmoji returns red for < 70%', () => {
  assert.equal(formatCoverageEmoji(69.9), '🔴');
  assert.equal(formatCoverageEmoji(0), '🔴');
});

test('formatCoverageEmoji returns white for no data / dash / null', () => {
  assert.equal(formatCoverageEmoji('no data found'), '⚪');
  assert.equal(formatCoverageEmoji('-'), '⚪');
  assert.equal(formatCoverageEmoji(null), '⚪');
  assert.equal(formatCoverageEmoji(undefined), '⚪');
});

test('formatCoverageEmoji honors custom thresholds', () => {
  const thresholds = [95, 80];

  assert.equal(formatCoverageEmoji(95, thresholds), '🟢');
  assert.equal(formatCoverageEmoji(90, thresholds), '🟡');
  assert.equal(formatCoverageEmoji(79.9, thresholds), '🔴');
});

test('parseThresholds returns the default [90, 70] when unset', () => {
  assert.deepEqual(parseThresholds(''), [90, 70]);
  assert.deepEqual(parseThresholds(undefined), [90, 70]);
});

test('parseThresholds parses a comma-separated string', () => {
  assert.deepEqual(parseThresholds('95,80'), [95, 80]);
  assert.deepEqual(parseThresholds(' 95 , 80 '), [95, 80]);
});

test('parseThresholds parses a bracketed array-like string', () => {
  assert.deepEqual(parseThresholds('[95, 80]'), [95, 80]);
});

test('parseThresholds rejects malformed input', () => {
  assert.throws(() => parseThresholds('not-a-number,80'), /Invalid "thresholds" input/);
  assert.throws(() => parseThresholds('70,90'), /Invalid "thresholds" input/); // not descending
  assert.throws(() => parseThresholds('90,80,70'), /Invalid "thresholds" input/); // wrong length
});

test('parseLcovSummary parses lines, functions and branches', () => {
  const input = [
    'Summary coverage rate:',
    '  lines......: 92.6% (25 of 27 lines)',
    '  functions..: 100.0% (5 of 5 functions)',
    '  branches...: 80.0% (8 of 10 branches)',
  ].join('\n');

  const result = parseLcovSummary(input);

  assert.deepEqual(result, {
    lines: { percentage: 92.6, covered: 25, total: 27 },
    functions: { percentage: 100, covered: 5, total: 5 },
    branches: { percentage: 80, covered: 8, total: 10 },
  });
});

test('parseLcovSummary handles "no data found" branches', () => {
  const input = [
    'Summary coverage rate:',
    '  lines......: 92.6% (25 of 27 lines)',
    '  functions..: no data found',
    '  branches...: no data found',
  ].join('\n');

  const result = parseLcovSummary(input);

  assert.deepEqual(result.functions, { percentage: null, covered: null, total: null });
  assert.deepEqual(result.branches, { percentage: null, covered: null, total: null });
});

test('parseLcovList parses per-file rows', () => {
  const input = [
    '  |Lines       |Functions  |Branches    ',
    '  Filename                                       |Rate     Num|Rate    Num|Rate     Num',
    '  ================================================================================',
    '  lib/main.dart                                  |92.6%      27|-       0|-       0',
    '  lib/other.dart                                 |50.0%      10|100.0%   2|75.0%    4',
  ].join('\n');

  const result = parseLcovList(input);

  assert.deepEqual(result, [
    {
      filename: 'lib/main.dart',
      lines: { percentage: 92.6, total: 27 },
      functions: { percentage: null, total: 0 },
      branches: { percentage: null, total: 0 },
    },
    {
      filename: 'lib/other.dart',
      lines: { percentage: 50, total: 10 },
      functions: { percentage: 100, total: 2 },
      branches: { percentage: 75, total: 4 },
    },
  ]);
});

test('parseLcovList returns an empty array for the n/a case', () => {
  assert.deepEqual(parseLcovList(' n/a'), []);
  assert.deepEqual(parseLcovList('n/a'), []);
});

test('formatSummaryTable renders a markdown table with emojis', () => {
  const summary = {
    lines: { percentage: 92.6, covered: 25, total: 27 },
    functions: { percentage: null, covered: null, total: null },
    branches: { percentage: null, covered: null, total: null },
  };

  const table = formatSummaryTable(summary);

  assert.match(table, /### 📊 Summary Coverage/);
  assert.match(table, /\| 📈 Lines \| 🟢 92\.6% \| 25 \/ 27 lines \|/);
  assert.match(table, /\| 🔧 Functions \| ⚪ N\/A \| no data found \|/);
  assert.match(table, /\| 🌿 Branches \| ⚪ N\/A \| no data found \|/);
});

test('formatSummaryTable honors custom thresholds', () => {
  const summary = {
    lines: { percentage: 92.6, covered: 25, total: 27 },
    functions: { percentage: null, covered: null, total: null },
    branches: { percentage: null, covered: null, total: null },
  };

  const table = formatSummaryTable(summary, [95, 80]);

  assert.match(table, /\| 📈 Lines \| 🟡 92\.6% \| 25 \/ 27 lines \|/);
});

test('formatFilesTable renders a markdown table with per-file rows', () => {
  const rows = [
    {
      filename: 'lib/main.dart',
      lines: { percentage: 92.6, total: 27 },
      functions: { percentage: null, total: 0 },
      branches: { percentage: null, total: 0 },
    },
  ];

  const table = formatFilesTable(rows);

  assert.match(table, /### 📁 Files Changed Coverage/);
  assert.match(table, /\| `lib\/main\.dart` \| 🟢 92\.6% \(27\) \| ⚪ – \(0\) \| ⚪ – \(0\) \|/);
});

test('formatFilesTable renders a fallback row when there are no changed files', () => {
  const table = formatFilesTable([]);

  assert.match(table, /No coverage data for changed files/);
});
