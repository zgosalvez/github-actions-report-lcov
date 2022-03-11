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
    await exec.exec('sudo apt-get install -y lcov');

    const tmpPath = path.resolve(os.tmpdir(), github.context.action);
    const workingDirectory = ensureTrailingSlash(core.getInput('working-directory').trim() || './');
    const coverageFilesPattern = core.getInput('coverage-files');
    const globber = await glob.create(coverageFilesPattern);
    const coverageFiles = await globber.glob();

    await genhtml(coverageFiles, tmpPath, workingDirectory);

    const coverageFile = await mergeCoverages(coverageFiles, tmpPath);
    const totalCoverage = lcovTotal(coverageFile);
    const minimumCoverage = core.getInput('minimum-coverage');
    const gitHubToken = core.getInput('github-token').trim();
    const errorMessage = `The code coverage is too low. Expected at least ${minimumCoverage}.`;
    const isFailure = totalCoverage < minimumCoverage;

    if (gitHubToken !== '') {
      const octokit = await github.getOctokit(gitHubToken);
      const prs = pullRequests(github);
      for (let i=0; i < prs.length; i++) {
        const pr = prs[i];
        console.log(`Calculating coverage for PR ${pr.number}, sha ${pr.head.sha}...`);
        const summary = await summarize(coverageFile);
        const details = await detail(coverageFile, pr, octokit, workingDirectory);
        const shaShort = pr.head.sha.substr(0, 7);
        let body = `### Coverage of commit [<code>${shaShort}</code>](${pr.number}/commits/${pr.head.sha})
<pre>${summary}

Files changed coverage rate:${details}</pre>

[Download coverage report](../actions/runs/${github.context.runId})
`;

        if (isFailure) {
          body += `\n:no_entry: ${errorMessage}`;
        }

        console.log("Posting body:");
        console.log(body);

        try {
          await octokit.issues.createComment({
            issue_number: pr.number,
            body: body,
            ...ownerRepo(pr.url)
          });
        } catch (error) {
          console.log("Unable to post coverage report.");
          console.log(error);
        }
      };
    } else {
      console.log("No GITHUB_TOKEN, not posting.");
    }

    if (isFailure) {
      throw Error(errorMessage);
    }
  } catch (error) {
    console.error(error);
    core.setFailed(error.message);
  }
}

function pullRequests(github) {
  if (github.context.eventName === "pull_request") {
    return [github.context.payload.pull_request];
  };
  if (github.context.eventName == "workflow_run") {
    if (github.context.payload.workflow_run.pull_requests.length > 0) {
      return github.context.payload.workflow_run.pull_requests;
    }
  }
  if (!!process.env.PR_SHA && !!process.env.PR_NUMBER &&
      process.env.PR_SHA != "" && process.env.PR_NUMBER != "") {
    return [{
      number: process.env.PR_NUMBER,
      head: {
        sha: process.env.PR_SHA,
      },
      url: `https://api.github.com/repos/${github.context.repo.owner}/${github.context.repo.repo}/pulls/${process.env.PR_NUMBER}`
    }];
  }
  return [];
}

function ownerRepo(url) {
  const match = url.match(/\/repos\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)\/pulls\//);
  return {
    owner: match[1],
    repo: match[2],
  };
}

function ensureTrailingSlash(path) {
  if (path.endsWith("/")) {
    return path;
  }

  return path + "/";
}

async function genhtml(coverageFiles, tmpPath, workingDirectory) {
  const artifactName = core.getInput('artifact-name').trim();
  const artifactPath = path.resolve(tmpPath, 'html').trim();
  const args = [...coverageFiles, '--rc', 'lcov_branch_coverage=1'];

  args.push('--output-directory');
  args.push(artifactPath);

  await exec.exec('genhtml', args, { cwd: workingDirectory });

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
    .split(/\r?\n/);

  lines.shift(); // Removes "Reading tracefile..."

  return lines.join('\n');
}

async function detail(coverageFile, pull_request, octokit, workingDirectory) {
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
    .split(/\r?\n/);

  lines.shift(); // Removes "Reading tracefile..."
  lines.pop(); // Removes "Total..."
  lines.pop(); // Removes "========"
  const listFilesOptions = octokit
    .pulls.listFiles.endpoint.merge({
      pull_number: pull_request.number,
      ...ownerRepo(pull_request.url)
    });
  const listFilesResponse = await octokit.paginate(listFilesOptions);
  const changedFiles = listFilesResponse.map(file => file.filename);

  lines = lines.filter((line, index) => {
    if (index <= 2) return true; // Include header

    if (workingDirectory !== "./") {
        line = workingDirectory + line;
    }

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
