const assert = require('node:assert/strict');
const { test } = require('node:test');

const { normalizeLcovContent } = require('../src/lcov');

test('adds line coverage for branch coverage without line coverage', () => {
  const input = [
    'TN:',
    'SF:src/App.jsx',
    'DA:1,1',
    'BRDA:2,0,0,-',
    'BRDA:3,0,0,4',
    'LF:1',
    'LH:1',
    'BRF:2',
    'BRH:1',
    'end_of_record',
    '',
  ].join('\n');

  const result = normalizeLcovContent(input);

  assert.equal(result.fixedLines, 2);
  assert.equal(result.hitLines, 1);
  assert.deepEqual(result.content.split('\n'), [
    'TN:',
    'SF:src/App.jsx',
    'DA:1,1',
    'DA:2,0',
    'BRDA:2,0,0,-',
    'DA:3,1',
    'BRDA:3,0,0,4',
    'LF:3',
    'LH:2',
    'BRF:2',
    'BRH:1',
    'end_of_record',
    '',
  ]);
});

test('adds one hit line when any branch on a missing line is hit', () => {
  const input = [
    'SF:src/App.jsx',
    'BRDA:10,0,0,0',
    'BRDA:10,0,1,2',
    'LF:0',
    'LH:0',
    'end_of_record',
  ].join('\n');

  const result = normalizeLcovContent(input);

  assert.equal(result.fixedLines, 1);
  assert.equal(result.hitLines, 1);
  assert.deepEqual(result.content.split('\n'), [
    'SF:src/App.jsx',
    'DA:10,1',
    'BRDA:10,0,0,0',
    'BRDA:10,0,1,2',
    'LF:1',
    'LH:1',
    'end_of_record',
  ]);
});

test('does not add duplicate line coverage', () => {
  const input = [
    'SF:src/App.jsx',
    'BRDA:5,0,0,1',
    'DA:5,1',
    'LF:1',
    'LH:1',
    'end_of_record',
  ].join('\n');

  const result = normalizeLcovContent(input);

  assert.equal(result.fixedLines, 0);
  assert.equal(result.hitLines, 0);
  assert.equal(result.content, input);
});
