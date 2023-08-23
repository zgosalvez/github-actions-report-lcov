const artifact = require('@actions/artifact');
const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const glob = require('@actions/glob');
const lcovTotal = require('lcov-total');
const os = require('os');
const path = require('path');

function readAndSetInputs() {
  return {
    coverageFilesPattern: core.getInput('coverage-files'),
    titlePrefix: core.getInput('title-prefix'),
    additionalMessage: core.getInput('additional-message'),
    updateComment: core.getInput('update-comment') === 'true',
    artifactName: core.getInput('artifact-name'),
    minimumCoverage: Number(core.getInput('minimum-coverage')),
    gitHubToken: core.getInput('github-token'),
    workingDirectory: core.getInput('working-directory') || './',
  };
}

function sha() {
  const full = github.context.payload.pull_request.head.sha;
  return {
    full,
    short: sha.substr(0, 7),
  };
}

function buildHeader(titlePrefix) {
  return `### ${
    titlePrefix ? `${titlePrefix} ` : ''
  }[LCOV](https://github.com/marketplace/actions/report-lcov) of commit`;
}

function buildMessageBody(params) {
  const { header, summary, details, additionalMessage, isMinimumCoverageReached, errorMessage } = params;

  let body = `${header} [<code>${sha().short}</code>](${github.context.payload.pull_request.number}/commits/${
    sha().full
  }) during [${github.context.workflow} #${github.context.runNumber}](../actions/runs/${
    github.context.runId
  })\n<pre>${summary}\n\nFiles changed coverage rate:${details}</pre>${
    additionalMessage ? `\n${additionalMessage}` : ''
  }`;

  if (!isMinimumCoverageReached) {
    body += `\n:no_entry: ${errorMessage}`;
  }

  return body;
}

function runningInPullRequest() {
  const allowedGitHubEvents = ['pull_request', 'pull_request_target'];
  return allowedGitHubEvents.includes(github.context.eventName);
}

async function run() {
  const {
    coverageFilesPattern,
    titlePrefix,
    additionalMessage,
    updateComment,
    artifactName,
    minimumCoverage,
    gitHubToken,
  } = readAndSetInputs();

  try {
    const tmpPath = path.resolve(os.tmpdir(), github.context.action);
    const globber = await glob.create(coverageFilesPattern);
    const coverageFiles = await globber.glob();

    if (artifactName) {
      await generateHTMLAndUpload(artifactName, coverageFiles, tmpPath);
    }

    const mergedCoverageFile = await mergeCoverages(coverageFiles, tmpPath);
    const totalCoverage = lcovTotal(mergedCoverageFile);
    const errorMessage = `The code coverage is too low: ${totalCoverage}. Expected at least ${minimumCoverage}.`;
    const isMinimumCoverageReached = totalCoverage >= minimumCoverage;

    if (gitHubToken && runningInPullRequest()) {
      const octokit = await github.getOctokit(gitHubToken);
      const body = buildMessageBody({
        header: buildHeader(titlePrefix),
        summary: await summarize(mergedCoverageFile),
        details: await detail(mergedCoverageFile, octokit),
        additionalMessage,
        isMinimumCoverageReached,
        errorMessage,
      });

      updateComment ? await upsertComment(body, buildHeader(titlePrefix), octokit) : await createComment(body, octokit);
    } else {
      core.info('github-token received is empty. Skipping writing a comment in the PR.');
      core.info(
        'Note: This could happen even if github-token was provided in workflow file. It could be because your github token does not have permissions for commenting in target repo.',
      );
    }

    core.setOutput('total-coverage', totalCoverage);
    if (!isMinimumCoverageReached) {
      core.setFailed(errorMessage);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function createComment(body, octokit) {
  core.debug('Creating a comment in the PR.');

  await octokit.rest.issues.createComment({
    repo: github.context.repo.repo,
    owner: github.context.repo.owner,
    issue_number: github.context.payload.pull_request.number,
    body,
  });
}

async function upsertComment(body, commentHeader, octokit) {
  const issueComments = await octokit.rest.issues.listComments({
    repo: github.context.repo.repo,
    owner: github.context.repo.owner,
    issue_number: github.context.payload.pull_request.number,
  });

  const existingComment = issueComments.data.find((comment) => comment.body.includes(commentHeader));

  if (existingComment) {
    core.debug(`Updating comment, id: ${existingComment.id}.`);

    await octokit.rest.issues.updateComment({
      repo: github.context.repo.repo,
      owner: github.context.repo.owner,
      comment_id: existingComment.id,
      body,
    });
  } else {
    core.debug('Comment does not exist, a new comment will be created.');

    await createComment(body, octokit);
  }
}

async function generateHTMLAndUpload(artifactName, coverageFiles, tmpPath) {
  const { workingDirectory } = readAndSetInputs();
  const artifactPath = path.resolve(tmpPath, 'html').trim();

  const args = [...coverageFiles, '--rc', 'lcov_branch_coverage=1', '--output-directory', artifactPath];

  await exec.exec('genhtml', args, { cwd: workingDirectory });

  const globber = await glob.create(`${artifactPath}/**`);
  const htmlFiles = await globber.glob();

  artifact.create().uploadArtifact(artifactName, htmlFiles, artifactPath, { continueOnError: false });
}

async function mergeCoverages(coverageFiles, tmpPath) {
  const mergedCoverageFile = `${tmpPath}/merged-lcov.info`;
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

async function summarize(mergedCoverageFile) {
  let output = '';

  const options = {};
  options.listeners = {
    stdout: (data) => {
      output += data.toString();
    },
    stderr: (data) => {
      output += data.toString();
    },
  };

  await exec.exec('lcov', ['--summary', mergedCoverageFile, '--rc', 'lcov_branch_coverage=1'], options);

  const lines = output.trim().split(/\r?\n/);

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
    },
  };

  await exec.exec('lcov', ['--list', coverageFile, '--list-full-path', '--rc', 'lcov_branch_coverage=1'], options);

  let lines = output.trim().split(/\r?\n/);

  lines.shift(); // Removes "Reading tracefile..."
  lines.pop(); // Removes "Total..."
  lines.pop(); // Removes "========"

  const listFilesOptions = octokit.rest.pulls.listFiles.endpoint.merge({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    pull_number: github.context.payload.pull_request.number,
  });
  const listFilesResponse = await octokit.paginate(listFilesOptions);
  const changedFiles = listFilesResponse.map((file) => file.filename);

  lines = lines.filter((line, index) => {
    const includeHeader = () => index <= 2;
    if (includeHeader()) {
      return true;
    }

    for (const changedFile of changedFiles) {
      console.log(`${line} === ${changedFile}`);

      if (line.startsWith(changedFile)) {
        return true;
      }
    }

    return false;
  });

  const onlyHeaderRemains = () => lines.length === 3;
  return onlyHeaderRemains() ? ' n/a' : `\n  ${lines.join('\n  ')}`;
}

run();
