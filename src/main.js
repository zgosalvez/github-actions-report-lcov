const artifact = require('@actions/artifact');
const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const glob = require('@actions/glob');
const lcovTotal = require("lcov-total");
const os = require('os');
const path = require('path');

const events = ['pull_request', 'pull_request_target'];

async function run() {
  try {
    await exec.exec('sudo apt-get install -y lcov');

    const tmpPath = path.resolve(os.tmpdir(), github.context.action);
    const coverageFilesPattern = core.getInput('coverage-files');
    const globber = await glob.create(coverageFilesPattern);
    const coverageFiles = await globber.glob();
    const title = core.getInput('title');

    await genhtml(coverageFiles, tmpPath);

    const coverageFile = await mergeCoverages(coverageFiles, tmpPath);
    const totalCoverage = lcovTotal(coverageFile);
    const minimumCoverage = core.getInput('minimum-coverage');
    const gitHubToken = core.getInput('github-token').trim();
    const errorMessage = `The code coverage is too low: ${totalCoverage}. Expected at least ${minimumCoverage}.`;
    const isFailure = totalCoverage < minimumCoverage;

    let prNumber = core.getInput('pr-number');
    let sha = github.context.payload.after
    if (!prNumber && github.context.eventName === 'pull_request') {
      prNumber = github.context.payload.pull_request.number
      sha = github.context.payload.pull_request.head.sha
    }
    if (!sha) sha = github.context.sha

    if (prNumber && gitHubToken !== '') {

    if (gitHubToken !== '' && events.includes(github.context.eventName)) {
      const octokit = await github.getOctokit(gitHubToken);
      const summary = await summarize(coverageFile);
      const details = await detail(coverageFile, octokit, prNumber);
      const shaShort = sha.substr(0, 7);
      let body = `### ${title ? `${title} ` : ''}[LCOV](https://github.com/marketplace/actions/report-lcov) of commit [<code>${shaShort}</code>](${prNumber}/commits/${sha}) during [${github.context.workflow} #${github.context.runNumber}](../actions/runs/${github.context.runId})\n<pre>${summary}\n\nFiles changed coverage rate:${details}</pre>`;

      if (isFailure) {
        body += `\n:no_entry: ${errorMessage}`;
      }

      core.debug("Creating a comment in the PR.")
      await octokit.issues.createComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: prNumber,
        body: body,
      });
    } else {
      core.info("github-token received is empty. Skipping writing a comment in the PR.");
      core.info("Note: This could happen even if github-token was provided in workflow file. It could be because your github token does not have permissions for commenting in target repo.")
    }

    if (isFailure) {
      throw Error(errorMessage);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function genhtml(coverageFiles, tmpPath) {
  const workingDirectory = core.getInput('working-directory').trim() || './';
  const artifactName = core.getInput('artifact-name').trim();
  const artifactPath = path.resolve(tmpPath, 'html').trim();
  const args = [...coverageFiles, '--rc', 'lcov_branch_coverage=1'];

  args.push('--output-directory');
  args.push(artifactPath);

  await exec.exec('genhtml', args, { cwd: workingDirectory });

  if (artifactName !== '') {
    const globber = await glob.create(`${artifactPath}/**`);
    const htmlFiles = await globber.glob();

    core.info(`Uploading artifacts.`);

    await artifact
      .create()
      .uploadArtifact(
        artifactName,
        htmlFiles,
        artifactPath,
        { continueOnError: false },
      );
  } else {
    core.info("Skip uploading artifacts");
  }
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

  await exec.exec('lcov', [...args, '--rc', 'lcov_branch_coverage=1']);

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
    '--rc',
    'lcov_branch_coverage=1'
  ], options);

  const lines = output
    .trim()
    .split(/\r?\n/)

  lines.shift(); // Removes "Reading tracefile..."

  return lines.join('\n');
}

async function detail(coverageFile, octokit, prNumber) {
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
    '--rc',
    'lcov_branch_coverage=1',
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
      pull_number: prNumber,
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
