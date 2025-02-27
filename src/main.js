const {DefaultArtifactClient} = require('@actions/artifact');
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
    core.debug('Starting the action');
    const tmpPath = path.resolve(os.tmpdir(), github.context.action);
    core.debug(`Temporary path: ${tmpPath}`);
    const coverageFilesPattern = core.getInput('coverage-files');
    core.debug(`Coverage files pattern: ${coverageFilesPattern}`);
    const globber = await glob.create(coverageFilesPattern);
    const coverageFiles = await globber.glob();
    core.debug(`Coverage files: ${coverageFiles}`);
    const titlePrefix = core.getInput('title-prefix');
    const additionalMessage = core.getInput('additional-message');
    const updateComment = core.getInput('update-comment') === 'true';

    const lcovVersion = await getLcovVersion();
    core.debug(`LCOV version: ${lcovVersion}`);
    const branchCoverageOption = compareVersions(lcovVersion, '2.0.0') >= 0 ? 'branch_coverage=1' : 'lcov_branch_coverage=1';
    core.debug(`Branch coverage option: ${branchCoverageOption}`);

    await genhtml(coverageFiles, tmpPath, branchCoverageOption);

    const coverageFile = await mergeCoverages(coverageFiles, tmpPath, branchCoverageOption);
    core.debug(`Merged coverage file: ${coverageFile}`);
    const totalCoverage = lcovTotal(coverageFile);
    core.debug(`Total coverage: ${totalCoverage}`);
    const minimumCoverage = core.getInput('minimum-coverage');
    const gitHubToken = core.getInput('github-token').trim();
    const errorMessage = `The code coverage is too low: ${totalCoverage}. Expected at least ${minimumCoverage}.`;
    const isMinimumCoverageReached = totalCoverage >= minimumCoverage;

    const hasGithubToken = gitHubToken !== '';
    const isPR = events.includes(github.context.eventName);

    if (hasGithubToken && isPR) {
      const octokit = await github.getOctokit(gitHubToken);
      const summary = await summarize(coverageFile, branchCoverageOption);
      const details = await detail(coverageFile, octokit, branchCoverageOption);
      const sha = github.context.payload.pull_request.head.sha;
      const shaShort = sha.substr(0, 7);
      const commentHeaderPrefix = `### ${titlePrefix ? `${titlePrefix} ` : ''}[LCOV](https://github.com/marketplace/actions/report-lcov) of commit`;
      let body = `${commentHeaderPrefix} [<code>${shaShort}</code>](${github.context.payload.pull_request.number}/commits/${sha}) during [${github.context.workflow} #${github.context.runNumber}](../actions/runs/${github.context.runId})\n<pre>${summary}\n\nFiles changed coverage rate:${details}</pre>${additionalMessage ? `\n${additionalMessage}` : ''}`;

      if (!isMinimumCoverageReached) {
        body += `\n:no_entry: ${errorMessage}`;
      }

      core.debug(`Comment body: ${body}`);

      updateComment ? await upsertComment(body, commentHeaderPrefix, octokit) : await createComment(body, octokit);
    } else if (!hasGithubToken) {
      core.info("github-token received is empty. Skipping writing a comment in the PR.");
      core.info("Note: This could happen even if github-token was provided in workflow file. It could be because your github token does not have permissions for commenting in target repo.")
    } else if (!isPR) {
      core.info("The event is not a pull request. Skipping writing a comment.");
      core.info("The event type is: " + github.context.eventName);
    }

    core.setOutput("total-coverage", totalCoverage);

    if (!isMinimumCoverageReached) {
      throw Error(errorMessage);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function createComment(body, octokit) {
  core.debug("Creating a comment in the PR.")

  await octokit.rest.issues.createComment({
    repo: github.context.repo.repo,
    owner: github.context.repo.owner,
    issue_number: github.context.payload.pull_request.number,
    body,
  });
}

async function upsertComment(body, commentHeaderPrefix, octokit) {
  const issueComments = await octokit.rest.issues.listComments({
    repo: github.context.repo.repo,
    owner: github.context.repo.owner,
    issue_number: github.context.payload.pull_request.number,
  });

  const existingComment = issueComments.data.find(comment =>
    comment.body.includes(commentHeaderPrefix),
  );

  if (existingComment) {
    core.debug(`Updating comment, id: ${existingComment.id}.`);

    await octokit.rest.issues.updateComment({
      repo: github.context.repo.repo,
      owner: github.context.repo.owner,
      comment_id: existingComment.id,
      body,
    });
  } else {
    core.debug(`Comment does not exist, a new comment will be created.`);

    await createComment(body, octokit);
  }
}

async function genhtml(coverageFiles, tmpPath, branchCoverageOption) {
  const workingDirectory = core.getInput('working-directory').trim() || './';
  const artifactName = core.getInput('artifact-name').trim();
  const artifactPath = path.resolve(tmpPath, 'html').trim();
  const args = [...coverageFiles, '--rc', branchCoverageOption];

  args.push('--output-directory');
  args.push(artifactPath);

  core.debug(`Running genhtml with args: ${args.join(' ')}`);

  await exec.exec('genhtml', args, { cwd: workingDirectory });

  if (artifactName !== '') {
    const artifact = new DefaultArtifactClient();
    const globber = await glob.create(`${artifactPath}/**/**.*`);
    const htmlFiles = await globber.glob();

    core.info(`Uploading artifacts.`);

    await artifact.uploadArtifact(artifactName, htmlFiles, artifactPath);
  } else {
    core.info("Skip uploading artifacts");
  }
}

async function mergeCoverages(coverageFiles, tmpPath, branchCoverageOption) {
  const mergedCoverageFile = tmpPath + '/lcov.info';
  const args = [];

  for (const coverageFile of coverageFiles) {
    args.push('--add-tracefile');
    args.push(coverageFile);
  }

  args.push('--output-file');
  args.push(mergedCoverageFile);

  core.debug(`Running lcov with args: ${args.join(' ')}`);

  await exec.exec('lcov', [...args, '--rc', branchCoverageOption]);

  return mergedCoverageFile;
}

async function summarize(coverageFile, branchCoverageOption) {
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

  core.debug(`Running lcov --summary with coverage file: ${coverageFile}`);

  await exec.exec('lcov', [
    '--summary',
    coverageFile,
    '--rc',
    branchCoverageOption
  ], options);

  const lines = output
    .trim()
    .split(/\r?\n/)

  lines.shift(); // Removes "Reading tracefile..."

  return lines.join('\n');
}

async function detail(coverageFile, octokit, branchCoverageOption) {
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

  core.debug(`Running lcov --list with coverage file: ${coverageFile}`);

  await exec.exec('lcov', [
    '--list',
    coverageFile,
    '--list-full-path',
    '--rc',
    branchCoverageOption,
  ], options);

  let lines = output
    .trim()
    .split(/\r?\n/)

  lines.shift(); // Removes "Reading tracefile..."
  lines.pop(); // Removes "Total..."
  lines.pop(); // Removes "========"

  const listFilesOptions = octokit
    .rest.pulls.listFiles.endpoint.merge({
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

async function getLcovVersion() {
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

  core.debug('Running lcov --version');

  await exec.exec('lcov', ['--version'], options);

  core.debug(`LCOV version output: ${output}`);

  const match = output.match(/lcov: LCOV version (\d+\.\d+)(?:-(\d+))?/);
  let version = '0.0-0';
  if (match) {
    version = match[2] ? `${match[1]}-${match[2]}` : `${match[1]}-0`;
  }
  core.debug(`Parsed LCOV version: ${version}`);
  return version;
}

function compareVersions(v1, v2) {
  core.debug(`Comparing versions: ${v1} and ${v2}`);
  const v1Parts = v1.split(/[-.]/).map(Number);
  const v2Parts = v2.split(/[-.]/).map(Number);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;

    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }

  return 0;
}

run();
