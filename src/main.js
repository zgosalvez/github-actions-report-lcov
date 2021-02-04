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
    await exec.exec('sudo apt-get install lcov');

    const tmpPath = path.resolve(os.tmpdir(), github.context.action);
    const coverageFilesPattern = core.getInput('coverage-files');
    const globber = await glob.create(coverageFilesPattern);
    const coverageFiles = await globber.glob();

    const projectDir = core.getInput('project-dir') || '';

    await genhtml(coverageFiles, path.resolve(tmpPath, projectDir));

    const coverageFile = await mergeCoverages(coverageFiles, tmpPath);
    const totalCoverage = lcovTotal(coverageFile);
    const minimumCoverage = core.getInput('minimum-coverage');
    const gitHubToken = core.getInput('github-token').trim();
    const errorMessage = `The code coverage is too low. Expected at least ${minimumCoverage}.`;
    const isFailure = totalCoverage < minimumCoverage;

    if (gitHubToken !== '' && github.context.eventName === 'pull_request') {
      const octokit = await github.getOctokit(gitHubToken);
      const summary = await summarize(coverageFile);
      const details = await detail(coverageFile, octokit);
      const sha = github.context.payload.pull_request.head.sha;
      const shaShort = sha.substr(0, 7);
      let body = `### [LCOV](https://github.com/marketplace/actions/report-lcov) of commit [<code>${shaShort}</code>](${github.context.payload.pull_request.number}/commits/${sha}) during [${github.context.workflow} #${github.context.runNumber}](../actions/runs/${github.context.runId})\n<pre>${summary}\n\nFiles changed coverage rate:${details}</pre>`;

      if (isFailure) {
        body += `\n:no_entry: ${errorMessage}`;
      }

      await octokit.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: github.context.payload.pull_request.number,
        body: body,
      });
    }

    if (isFailure) {
      throw Error(errorMessage);
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

  const globber = await glob.create(`${artifactPath}/**`);
  const htmlFiles = await globber.glob();

  await artifact
    .create()
    .uploadArtifact(
      artifactName,
      htmlFiles,
      artifactPath,
      { continueOnError: false },
    );
}

async function mergeCoverages(coverageFiles, tmpPath) {
  // This is broken for some reason:
  //const mergedCoverageFile = path.resolve(tmpPath, 'lcov.info');
  const mergedCoverageFile = tmpPath + '/lcov.info';
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
    '--summary',
    coverageFile,
  ], options);

  const lines = output
    .trim()
    .split(/\r?\n/)

  lines.shift(); // Removes "Reading tracefile..."

  return lines.join('\n');
}

async function detail(coverageFile, octokit) {
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
    '--list',
    coverageFile,
    '--list-full-path',
  ], options);

  let lines = output
    .trim()
    .split(/\r?\n/)

  lines.shift(); // Removes "Reading tracefile..."
  lines.pop(); // Removes "Total..."
  lines.pop(); // Removes "========"

  const listFilesOptions = octokit
    .pulls.listFiles.endpoint.merge({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: github.context.payload.pull_request.number,
    });
  const listFilesResponse = await octokit.paginate(listFilesOptions);
  const changedFiles = listFilesResponse.map(file => file.filename);

  lines = lines.filter((line, index) => {
    if (index <= 2) return true; // Include header

    for (const changedFile of changedFiles) {
      console.log(`${line} === ${changedFile}`);

      if (line.startsWith(changedFile)) return true;
    }

    return false;
  });

  if (lines.length === 3) { // Only the header remains
    return ' n/a';
  }

  return '\n  ' + lines.join('\n  ');
}

run();