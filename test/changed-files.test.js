const assert = require('node:assert/strict');
const { test } = require('node:test');

const { getChangedFiles } = require('../src/changed-files');

const MERGE_SHA = 'a'.repeat(40);

function fakeGithub(eventName = 'pull_request') {
  return {
    context: {
      eventName,
      sha: MERGE_SHA,
      serverUrl: 'https://github.com',
      repo: { owner: 'owner', repo: 'repo' },
      payload: { pull_request: { number: 7 } },
    },
  };
}

function fakeCore() {
  const messages = { info: [], warning: [] };

  return {
    messages,
    info: (message) => messages.info.push(message),
    warning: (message) => messages.warning.push(message),
  };
}

// Each handler receives (args, options) and returns { exitCode, stdout } or throws.
function fakeExec(handler) {
  const calls = [];

  return {
    calls,
    getExecOutput: async (command, args, options) => {
      calls.push({ command, args, options });
      const result = handler(args, options) ?? {};
      const exitCode = result.exitCode ?? 0;

      if (exitCode !== 0 && !options.ignoreReturnCode) {
        throw new Error(`git ${args[0]} failed with exit code ${exitCode}`);
      }

      return { exitCode, stdout: result.stdout ?? '', stderr: '' };
    },
  };
}

function fakeOctokit(files) {
  return {
    rest: { pulls: { listFiles: { endpoint: { merge: (options) => options } } } },
    paginate: async () => {
      if (files instanceof Error) throw files;

      return files.map((filename) => ({ filename }));
    },
  };
}

test('diffs the merge commit against its first parent when it is available locally', async () => {
  const exec = fakeExec((args) => (args[0] === 'diff' ? { stdout: 'src/a.js\nsrc/b.js\n' } : {}));

  const files = await getChangedFiles({
    core: fakeCore(),
    exec,
    github: fakeGithub(),
    octokit: fakeOctokit(new Error('API should not be called')),
    token: 'token',
    cwd: './',
  });

  assert.deepEqual(files, ['src/a.js', 'src/b.js']);
  assert.deepEqual(exec.calls.map((call) => call.args[0]), ['cat-file', 'diff']);
  assert.deepEqual(exec.calls[1].args, ['diff', '--name-only', '--no-renames', `${MERGE_SHA}^1`, MERGE_SHA]);
});

test('fetches the merge commit parents when the checkout is shallow', async () => {
  const exec = fakeExec((args) => {
    if (args[0] === 'cat-file') return { exitCode: 1 };
    if (args[0] === 'diff') return { stdout: 'src/a.js\n' };

    return {};
  });

  const files = await getChangedFiles({
    core: fakeCore(),
    exec,
    github: fakeGithub(),
    octokit: fakeOctokit(new Error('API should not be called')),
    token: 'token',
    cwd: './',
  });

  assert.deepEqual(files, ['src/a.js']);
  assert.deepEqual(exec.calls[1].args, ['fetch', '--no-tags', '--depth=2', 'origin', MERGE_SHA]);
  assert.equal(exec.calls[1].options.env.GIT_CONFIG_COUNT, undefined);
});

test('authenticates the fetch with the token when the checkout did not persist credentials', async () => {
  const exec = fakeExec((args, options) => {
    if (args[0] === 'cat-file') return { exitCode: 1 };
    if (args[0] === 'fetch') return { exitCode: options.env.GIT_CONFIG_COUNT ? 0 : 128 };

    return { stdout: 'src/a.js\n' };
  });

  const files = await getChangedFiles({
    core: fakeCore(),
    exec,
    github: fakeGithub(),
    octokit: fakeOctokit(new Error('API should not be called')),
    token: 'token',
    cwd: './',
  });

  assert.deepEqual(files, ['src/a.js']);

  const authenticatedFetch = exec.calls[2];

  assert.equal(authenticatedFetch.options.env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(
    authenticatedFetch.options.env.GIT_CONFIG_VALUE_0,
    `AUTHORIZATION: basic ${Buffer.from('x-access-token:token').toString('base64')}`,
  );
  assert.ok(!authenticatedFetch.args.join(' ').includes('token'));
});

test('falls back to the API when the local diff fails', async () => {
  const core = fakeCore();
  const exec = fakeExec((args) => (args[0] === 'diff' ? { exitCode: 128 } : {}));

  const files = await getChangedFiles({
    core,
    exec,
    github: fakeGithub(),
    octokit: fakeOctokit(['src/from-api.js']),
    token: 'token',
    cwd: './',
  });

  assert.deepEqual(files, ['src/from-api.js']);
  assert.match(core.messages.info[0], /using the GitHub API instead/);
});

test('uses the API on pull_request_target, where no merge commit is checked out', async () => {
  const exec = fakeExec(() => {
    throw new Error('git should not be called');
  });

  const files = await getChangedFiles({
    core: fakeCore(),
    exec,
    github: fakeGithub('pull_request_target'),
    octokit: fakeOctokit(['src/from-api.js']),
    token: 'token',
    cwd: './',
  });

  assert.deepEqual(files, ['src/from-api.js']);
  assert.equal(exec.calls.length, 0);
});

test('returns null with a warning when neither git nor the API can list the files', async () => {
  const core = fakeCore();
  const exec = fakeExec(() => ({ exitCode: 128 }));

  const files = await getChangedFiles({
    core,
    exec,
    github: fakeGithub(),
    octokit: fakeOctokit(new Error('Sorry, this diff is taking too long to generate.')),
    token: 'token',
    cwd: './',
  });

  assert.equal(files, null);
  assert.match(core.messages.warning[0], /taking too long to generate/);
});
