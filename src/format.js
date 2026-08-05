const DEFAULT_THRESHOLDS = [90, 70];

// Parses the `thresholds` action input (e.g. "90,70" or "[90, 70]") into a
// [greenMin, yellowMin] pair. Anything below yellowMin is red.
function parseThresholds(input) {
  if (!input || !input.trim()) {
    return DEFAULT_THRESHOLDS;
  }

  const values = input
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((value) => Number(value.trim()));

  if (values.length !== 2 || values.some(Number.isNaN) || values[0] <= values[1]) {
    throw new Error(
      `Invalid "thresholds" input: expected two comma-separated numbers in descending order (e.g. "90,70"), got "${input}".`,
    );
  }

  return values;
}

function formatCoverageEmoji(percentage, thresholds = DEFAULT_THRESHOLDS) {
  let value = percentage;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (normalized === '' || normalized === '-' || normalized === 'no data found') {
      return '⚪';
    }

    value = Number(normalized.replace('%', ''));
  }

  if (value === null || value === undefined || Number.isNaN(value)) {
    return '⚪';
  }

  const [greenMin, yellowMin] = thresholds;

  if (value >= greenMin) return '🟢';
  if (value >= yellowMin) return '🟡';

  return '🔴';
}

function emptyMetric() {
  return { percentage: null, covered: null, total: null };
}

function parseSummaryMetricText(text) {
  const trimmed = text.trim();

  if (trimmed === '' || /no data found/i.test(trimmed)) {
    return emptyMetric();
  }

  const match = trimmed.match(/^([\d.]+)%\s*\((\d+)\s+of\s+(\d+)/i);

  if (!match) {
    return emptyMetric();
  }

  return {
    percentage: Number(match[1]),
    covered: Number(match[2]),
    total: Number(match[3]),
  };
}

// Parses the raw output of `lcov --summary` into structured coverage data.
function parseLcovSummary(summaryOutput) {
  const result = {
    lines: emptyMetric(),
    functions: emptyMetric(),
    branches: emptyMetric(),
  };

  const metricLineRegex = /^(lines|functions|branches)\.*:\s*(.+)$/i;

  for (const rawLine of summaryOutput.split(/\r?\n/)) {
    const match = rawLine.trim().match(metricLineRegex);

    if (!match) continue;

    result[match[1].toLowerCase()] = parseSummaryMetricText(match[2]);
  }

  return result;
}

function parseListCell(cell) {
  const trimmed = cell.trim();
  const match = trimmed.match(/^(-|[\d.]+)%?\s+(\d+)$/);

  if (!match) {
    return { percentage: null, total: 0 };
  }

  return {
    percentage: match[1] === '-' ? null : Number(match[1]),
    total: Number(match[2]),
  };
}

// Parses the raw output of `lcov --list` (as returned by detail()) into an
// array of per-file coverage rows. Returns an empty array for the "n/a" case.
function parseLcovList(detailOutput) {
  const trimmed = detailOutput.trim();

  if (trimmed === '' || trimmed === 'n/a') {
    return [];
  }

  const rows = [];

  for (const rawLine of detailOutput.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line.includes('|')) continue;

    const [filenameCell, linesCell, functionsCell, branchesCell] = line.split('|');

    if (branchesCell === undefined) continue; // Malformed/short line, skip.

    const filename = filenameCell.trim();

    if (filename === '' || /^filename$/i.test(filename) || /^=+$/.test(filename)) {
      continue; // Header/separator row.
    }

    rows.push({
      filename,
      lines: parseListCell(linesCell),
      functions: parseListCell(functionsCell),
      branches: parseListCell(branchesCell),
    });
  }

  return rows;
}

function formatSummaryMetricRow(label, metric, unit, thresholds) {
  const { percentage, covered, total } = metric;
  const coverageCell = percentage === null ? '⚪ N/A' : `${formatCoverageEmoji(percentage, thresholds)} ${percentage.toFixed(1)}%`;
  const detailsCell = percentage === null ? 'no data found' : `${covered} / ${total} ${unit}`;

  return `| ${label} | ${coverageCell} | ${detailsCell} |`;
}

// Formats parsed summary coverage data (see parseLcovSummary) as a
// GitHub-flavored markdown table.
function formatSummaryTable(summary, thresholds = DEFAULT_THRESHOLDS) {
  return [
    '### 📊 Summary Coverage',
    '',
    '| Metric | Coverage | Details |',
    '|---|---|---|',
    formatSummaryMetricRow('📈 Lines', summary.lines, 'lines', thresholds),
    formatSummaryMetricRow('🔧 Functions', summary.functions, 'functions', thresholds),
    formatSummaryMetricRow('🌿 Branches', summary.branches, 'branches', thresholds),
  ].join('\n');
}

function formatFileMetricCell(metric, thresholds) {
  if (metric.percentage === null) {
    return `⚪ – (${metric.total})`;
  }

  return `${formatCoverageEmoji(metric.percentage, thresholds)} ${metric.percentage.toFixed(1)}% (${metric.total})`;
}

// Formats parsed per-file coverage rows (see parseLcovList) as a
// GitHub-flavored markdown table.
function formatFilesTable(rows, thresholds = DEFAULT_THRESHOLDS) {
  const lines = [
    '### 📁 Files Changed Coverage',
    '',
    '| File | Lines | Functions | Branches |',
    '|---|---|---|---|',
  ];

  if (rows.length === 0) {
    lines.push('| No coverage data for changed files | | | |');
    return lines.join('\n');
  }

  for (const row of rows) {
    lines.push(
      `| \`${row.filename}\` | ${formatFileMetricCell(row.lines, thresholds)} | ${formatFileMetricCell(row.functions, thresholds)} | ${formatFileMetricCell(row.branches, thresholds)} |`,
    );
  }

  return lines.join('\n');
}

module.exports = {
  DEFAULT_THRESHOLDS,
  parseThresholds,
  formatCoverageEmoji,
  parseLcovSummary,
  parseLcovList,
  formatSummaryTable,
  formatFilesTable,
};
