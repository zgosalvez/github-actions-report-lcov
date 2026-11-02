// Lists the files changed by the pull request.
//
// On `pull_request`, the checked-out commit (GITHUB_SHA) is GitHub's merge commit,
// whose first parent is the base branch tip, so diffing the two locally gives the
// pull request's changes. This avoids `pulls.listFiles`, which fails on very large
// pull requests with "Sorry, this diff is taking too long to generate".
//
// The API is still used when the local diff isn't possible, e.g. on
// `pull_request_target` (no merge commit is checked out) or when the job has no
// checkout. Returns null when neither works, so the rest of the report can still
// be posted.
async function getChangedFiles({ core, exec, github, octokit, token, cwd }) {
  if (github.context.eventName === 'pull_request') {
    try {
      return await getChangedFilesFromGit({ core, exec, github, token, cwd });
    } catch (error) {
      core.info(`Could not diff the pull request locally, using the GitHub API instead: ${error.message}`);
    }
  }

  try {
    return await getChangedFilesFromApi({ github, octokit });
  } catch (error) {
    core.warning(`Could not list the pull request's changed files: ${error.message}`);

    return null;
  }
}

async function getChangedFilesFromGit({ core, exec, github, token, cwd }) {
  const mergeCommit = github.context.sha;
  // No terminal prompt: without credentials, fail fast instead of waiting for a
  // username.
  const git = (args, options = {}) =>
    exec.getExecOutput('git', args, {
      cwd,
      silent: true,
      ...options,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    });

  // A default `actions/checkout` is a depth-1 clone, so the merge commit's parents
  // are usually missing. Depth 2 brings both of them.
  if ((await git(['cat-file', '-e', `${mergeCommit}^1^{commit}`], { ignoreReturnCode: true })).exitCode !== 0) {
    core.info(`Fetching the parents of ${mergeCommit}.`);
    await fetchCommit({ git, github, token, sha: mergeCommit });
  }

  const { stdout } = await git(['diff', '--name-only', '--no-renames', `${mergeCommit}^1`, mergeCommit]);

  return stdout.split(/\r?\n/).filter(Boolean);
}

async function fetchCommit({ git, github, token, sha }) {
  const args = ['fetch', '--no-tags', '--depth=2', 'origin', sha];

  // Works as is when the checkout persisted its credentials (the default).
  if ((await git(args, { ignoreReturnCode: true })).exitCode === 0) return;

  // Otherwise authenticate the way actions/checkout does. Passed through the
  // environment so the token never appears on a logged command line.
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');

  await git(args, {
    env: {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `http.${github.context.serverUrl}/.extraheader`,
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    },
  });
}

async function getChangedFilesFromApi({ github, octokit }) {
  const listFilesOptions = octokit
    .rest.pulls.listFiles.endpoint.merge({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: github.context.payload.pull_request.number,
    });
  const listFilesResponse = await octokit.paginate(listFilesOptions);

  return listFilesResponse.map(file => file.filename);
}

module.exports = { getChangedFiles };
