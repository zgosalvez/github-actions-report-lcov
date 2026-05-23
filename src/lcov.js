const fs = require('fs/promises');
const path = require('path');

function parsePositiveLineNumber(value) {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return Number(value);
}

function parseLineCoverage(line) {
  if (!line.startsWith('DA:')) {
    return null;
  }

  const [lineNumber] = line.slice(3).split(',');

  return parsePositiveLineNumber(lineNumber);
}

function parseBranchCoverage(line) {
  if (!line.startsWith('BRDA:')) {
    return null;
  }

  const [lineNumber, , , taken] = line.slice(5).split(',');
  const parsedLineNumber = parsePositiveLineNumber(lineNumber);

  if (parsedLineNumber === null) {
    return null;
  }

  return {
    hit: Number(taken) > 0,
    lineNumber: parsedLineNumber,
  };
}

function addToSummary(line, prefix, count) {
  if (count === 0 || !line.startsWith(prefix)) {
    return line;
  }

  const value = line.slice(prefix.length);

  if (!/^\d+$/.test(value)) {
    return line;
  }

  return `${prefix}${Number(value) + count}`;
}

function normalizeRecord(recordLines) {
  const coveredLines = new Set();
  const branchOnlyLines = new Map();

  for (const line of recordLines) {
    const lineCoverageLineNumber = parseLineCoverage(line);

    if (lineCoverageLineNumber !== null) {
      coveredLines.add(lineCoverageLineNumber);
      continue;
    }

    const branchCoverage = parseBranchCoverage(line);

    if (branchCoverage !== null) {
      const existingHit = branchOnlyLines.get(branchCoverage.lineNumber) || false;

      branchOnlyLines.set(
        branchCoverage.lineNumber,
        existingHit || branchCoverage.hit,
      );
    }
  }

  for (const lineNumber of coveredLines) {
    branchOnlyLines.delete(lineNumber);
  }

  if (branchOnlyLines.size === 0) {
    return {
      fixedLines: 0,
      hitLines: 0,
      lines: recordLines,
    };
  }

  const generatedLines = new Set();
  const hitLines = [...branchOnlyLines.values()].filter(Boolean).length;
  const normalizedLines = [];

  for (const line of recordLines) {
    const branchCoverage = parseBranchCoverage(line);

    if (
      branchCoverage !== null &&
      branchOnlyLines.has(branchCoverage.lineNumber) &&
      !generatedLines.has(branchCoverage.lineNumber)
    ) {
      normalizedLines.push(
        `DA:${branchCoverage.lineNumber},${branchOnlyLines.get(branchCoverage.lineNumber) ? 1 : 0}`,
      );
      generatedLines.add(branchCoverage.lineNumber);
    }

    normalizedLines.push(
      addToSummary(
        addToSummary(line, 'LF:', branchOnlyLines.size),
        'LH:',
        hitLines,
      ),
    );
  }

  return {
    fixedLines: branchOnlyLines.size,
    hitLines,
    lines: normalizedLines,
  };
}

function normalizeLcovContent(content) {
  const lines = content.split(/\r?\n/);
  const normalizedLines = [];
  let recordLines = [];
  let fixedLines = 0;
  let hitLines = 0;

  function flushRecord() {
    const normalizedRecord = normalizeRecord(recordLines);

    normalizedLines.push(...normalizedRecord.lines);
    fixedLines += normalizedRecord.fixedLines;
    hitLines += normalizedRecord.hitLines;
    recordLines = [];
  }

  for (const line of lines) {
    if (line.startsWith('SF:')) {
      if (recordLines.length > 0) {
        flushRecord();
      }

      recordLines.push(line);
      continue;
    }

    if (recordLines.length > 0) {
      recordLines.push(line);

      if (line === 'end_of_record') {
        flushRecord();
      }

      continue;
    }

    normalizedLines.push(line);
  }

  if (recordLines.length > 0) {
    flushRecord();
  }

  return {
    content: normalizedLines.join('\n'),
    fixedLines,
    hitLines,
  };
}

async function normalizeCoverageFiles(coverageFiles, tmpPath) {
  const normalizedDir = path.resolve(tmpPath, 'normalized-lcov');
  const normalizedCoverageFiles = [];
  const files = [];
  let fixedLines = 0;

  await fs.mkdir(normalizedDir, { recursive: true });

  for (const [index, coverageFile] of coverageFiles.entries()) {
    const content = await fs.readFile(coverageFile, 'utf8');
    const normalized = normalizeLcovContent(content);

    fixedLines += normalized.fixedLines;

    if (normalized.fixedLines === 0) {
      normalizedCoverageFiles.push(coverageFile);
      continue;
    }

    const normalizedCoverageFile = path.join(
      normalizedDir,
      `${index}-${path.basename(coverageFile)}`,
    );

    await fs.writeFile(normalizedCoverageFile, normalized.content);
    normalizedCoverageFiles.push(normalizedCoverageFile);
    files.push({
      coverageFile,
      fixedLines: normalized.fixedLines,
      hitLines: normalized.hitLines,
    });
  }

  return {
    coverageFiles: normalizedCoverageFiles,
    files,
    fixedLines,
  };
}

module.exports = {
  normalizeCoverageFiles,
  normalizeLcovContent,
};
