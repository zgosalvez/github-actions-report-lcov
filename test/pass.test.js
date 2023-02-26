const process = require('process');
const cp = require('child_process');
const jest = require('@jest/globals');
const path = require('path');

const ip = path.join(__dirname, '../src/main.js');
const coverageFiles = 'INPUT_COVERAGE_FILES';

jest.beforeEach(() => {
    process.env[coverageFiles] = "test/stub/coverage/lcov.*.info";
});

jest.afterEach(() => {
    delete process.env[coverageFiles];
});

jest.test('actions pass', () => {
    const result = cp.execSync(`node ${ip}`, { env: process.env }).toString();

    jest.expect(result).toContain('//TODO');
});
