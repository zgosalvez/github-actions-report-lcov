const artifact = require('@actions/artifact');
const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const lcovTotal = require("lcov-total");
const path = require('path');

async function run() {
  try {
    await exec.exec('sudo apt-get install lcov');

    console.log(github.context.action_path);
    console.log(process.env.GITHUB_ACTION_PATH);

    const tmpPath = path.resolve(github.context.action_path, 'tmp');
    const coverageFiles = core.getInput('coverage-files');

    await genhtml(coverageFiles, tmpPath);

    const coverageFile = await mergeCoverages(coverageFiles, tmpPath);
    const summary = await summarize(coverageFile);
    const gitHubToken = core.getInput('github-token').trim();

    if (gitHubToken !== '' && github.context.event_name === 'pull_request') {
      await github.getOctokit(gitHubToken)
        .issues.createComment({
          owner: github.context.owner,
          repo: github.context.repo,
          issue_number: github.context.event.number,
          body: summary,
        });
    }

    if (lcovTotal(coverageFile) < core.getInput('minimum-coverage')) {
      throw new Error('The code coverage is too low.');
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function genhtml(coverageFiles, tmpPath) {
  const artifactPath = path.resolve(tmpPath, 'html');

  await exec.exec('genhtml', [
    coverageFiles,
    '--output-directory',
    artifactPath,
  ]);

  await artifact
    .create()
    .uploadArtifact(
      core.getInput('artifact-name').trim(),
      [artifactPath],
      tmpPath,
      { continueOnError: false },
    );
}

async function mergeCoverages(coverageFiles, tmpPath) {
  const coverageFile = path.resolve(tmpPath, 'lcov.info');
  const lcovResultMerger = path.resolve(github.context.action_path, 'node_modules/.bin/lcov-result-merger');

  await exec.exec(lcovResultMerger, [
    coverageFiles,
    coverageFile,
  ]);

  return coverageFile;
}

async function summarize(coverageFile) {
  let output = '';

  const options = {};
  options.listeners = {
    stdout: (data) => {
      output += data.toString();
    },
    stderr: (data) => {
      output += data.toString();
    }
  };

  await exec.exec('lcov', [
    coverageFile,
    '--summary',
    coverageFile,
  ], options);

  const lines = output
    .trim()
    .split(/\r?\n/)
    .shift(); // Removes "Reading tracefile..."

  return lines.join('\n');
}

run();