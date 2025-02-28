const rewire = require('rewire');
const path = require('path');
const main = rewire('../src/main');
const filterChangedFiles = main.__get__('filterChangedFiles');

test('filterChangedFiles should filter and trim paths correctly', () => {
  const changedFiles = [
    '.github/workflows/flutter-test.yml',
    'app/lib/api/auth_api.dart',
    'app/lib/models/address.dart',
    'app/lib/providers/user.dart',
    'app/lib/providers/request.dart'
  ];
  const workingDirectory = './app';

  const expected = [
    'lib/api/auth_api.dart',
    'lib/models/address.dart',
    'lib/providers/user.dart',
    'lib/providers/request.dart'
  ];

  const result = filterChangedFiles(changedFiles, workingDirectory);
  expect(result).toEqual(expected);
});

test('filterChangedFiles should return an empty array if no files are in the working directory', () => {
  const changedFiles = [
    '.github/workflows/flutter-test.yml',
    'lib/api/auth_api.dart'
  ];
  const workingDirectory = './app';

  const expected = [];

  const result = filterChangedFiles(changedFiles, workingDirectory);
  expect(result).toEqual(expected);
});

test('filterChangedFiles should handle workingDirectory as current directory', () => {
  const changedFiles = [
    '.github/workflows/flutter-test.yml',
    'lib/api/auth_api.dart',
    'lib/models/address.dart',
    'lib/providers/user.dart',
    'lib/providers/request.dart'
  ];
  const workingDirectory = '.';

  const expected = [
    '.github/workflows/flutter-test.yml',
    'lib/api/auth_api.dart',
    'lib/models/address.dart',
    'lib/providers/user.dart',
    'lib/providers/request.dart'
  ];

  const result = filterChangedFiles(changedFiles, workingDirectory);
  expect(result).toEqual(expected);
});
