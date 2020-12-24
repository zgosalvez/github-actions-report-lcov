const artifact = require('@actions/artifact');
const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const glob = require('@actions/glob');
const lcovTotal = require("lcov-total");
const os = require('os');
const path = require('path');

async function run() {
  try {
    console.log(process.cwd);
    
    await exec.exec('sudo apt-get install lcov');

    const tmpPath = path.resolve(os.tmpdir(), github.context.action);
    const coverageFilesPattern = core.getInput('coverage-files');
    const globber = await glob.create(coverageFilesPattern);
    const coverageFiles = await globber.glob();

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
  const artifactName = core.getInput('artifact-name').trim();
  const artifactPath = path.resolve(tmpPath, 'html').trim();
  const args = [...coverageFiles];

  args.push('--output-directory');
  args.push(artifactPath);

  await exec.exec('genhtml', args);

  await artifact
    .create()
    .uploadArtifact(
      artifactName,
      [artifactPath],
      artifactPath,
      { continueOnError: false },
    );
}

async function mergeCoverages(coverageFiles, tmpPath) {
  const mergedCoverageFile = path.resolve(tmpPath, 'lcov.info');
  console.log(tmpPath);
  console.log(mergedCoverageFile);
  const args = [];

  for (const coverageFile of coverageFiles) {
    args.push('--add-tracefile');
    args.push(coverageFile);
  }

  args.push('--output-file');
  args.push(mergedCoverageFile);

  await exec.exec('lcov', args);

  return mergedCoverageFile;
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