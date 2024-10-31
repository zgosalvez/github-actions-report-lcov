const { DefaultArtifactClient } = require('@actions/artifact')
const core = require('@actions/core')
const exec = require('@actions/exec')
const github = require('@actions/github')
const glob = require('@actions/glob')
const lcovTotal = require('lcov-total')
const os = require('os')
const path = require('path')

const detailPath = /^(?<path>.+?)\s*[|].+[|].+[|].+$/

async function run () {
  try {
    const tmpPath = path.resolve(os.tmpdir(), github.context.action)
    const coverageFilesPattern = core.getInput('coverage-files')
    const globber = await glob.create(coverageFilesPattern)
    const coverageFiles = await globber.glob()
    const titlePrefix = core.getInput('title-prefix')
    const additionalMessage = core.getInput('additional-message')
    const updateComment = core.getInput('update-comment') === 'true'
    const workingDirectory = core.getInput('working-directory').trim() || './'

    await genhtml(coverageFiles, tmpPath, workingDirectory)

    const coverageFile = await mergeCoverages(coverageFiles, tmpPath)
    const totalCoverage = lcovTotal(coverageFile)
    const minimumCoverage = core.getInput('minimum-coverage')
    const gitHubToken = core.getInput('github-token').trim()
    const errorMessage = `The code coverage is too low: ${totalCoverage}. Expected at least ${minimumCoverage}.`
    const isMinimumCoverageReached = totalCoverage >= minimumCoverage

    const hasGithubToken = gitHubToken !== ''

    if (hasGithubToken) {
      const octokit = await github.getOctokit(gitHubToken)
      const summary = await summarize(coverageFile)
      for (const pr of pullRequests(github)) {
        console.log(
          `Calculating coverage for PR ${pr.number}, sha ${pr.head.sha}...`
        )
        const details = await detail(
          coverageFile,
          workingDirectory,
          pr,
          octokit
        )
        const shaShort = pr.head.sha.substr(0, 7)
        const commentHeaderPrefix = `### ${
          titlePrefix ? `${titlePrefix} ` : ''
        }[LCOV](https://github.com/marketplace/actions/report-lcov) of commit`
        let body = `${commentHeaderPrefix} [<code>${shaShort}</code>](${
          pr.number
        }/commits/${pr.head.sha}) during [${github.context.workflow} #${
          github.context.runNumber
        }](../actions/runs/${
          github.context.runId
        })\n<pre>${summary}\n\nFiles changed coverage rate:${details}</pre>${
          additionalMessage ? `\n${additionalMessage}` : ''
        }`

        if (!isMinimumCoverageReached) {
          body += `\n:no_entry: ${errorMessage}`
        }

        updateComment
          ? await upsertComment(body, commentHeaderPrefix, pr, octokit)
          : await createComment(body, pr, octokit)
      }
    } else {
      core.info(
        'github-token received is empty. Skipping writing a comment in the PR.'
      )
      core.info(
        'Note: This could happen even if github-token was provided in workflow file. It could be because your github token does not have permissions for commenting in target repo.'
      )
    }

    core.setOutput('total-coverage', totalCoverage)

    if (!isMinimumCoverageReached) {
      throw Error(errorMessage)
    }
  } catch (error) {
    console.error(error)
    core.setFailed(error.message)
  }
}

async function createComment (body, pullRequest, octokit) {
  core.debug('Creating a comment in the PR.')

  await octokit.rest.issues.createComment({
    issue_number: pullRequest.number,
    body,
    ...ownerRepo(pullRequest.url)
  })
}

async function upsertComment (body, commentHeaderPrefix, pullRequest, octokit) {
  const issueComments = await octokit.rest.issues.listComments({
    issue_number: pullRequest.number,
    ...ownerRepo(pullRequest.url)
  })

  const existingComment = issueComments.data.find((comment) =>
    comment.body.includes(commentHeaderPrefix)
  )

  if (existingComment) {
    core.debug(`Updating comment, id: ${existingComment.id}.`)

    await octokit.rest.issues.updateComment({
      comment_id: existingComment.id,
      body,
      ...ownerRepo(pullRequest.url)
    })
  } else {
    core.debug('Comment does not exist, a new comment will be created.')

    await createComment(body, pullRequest, octokit)
  }
}

function pullRequests (github) {
  if (github.context.eventName === 'pull_request') {
    return [github.context.payload.pull_request]
  }
  if (github.context.eventName === 'workflow_run') {
    if (github.context.payload.workflow_run.pull_requests.length > 0) {
      return github.context.payload.workflow_run.pull_requests
    }
  }
  if (
    !!process.env.PR_SHA &&
    !!process.env.PR_NUMBER &&
    process.env.PR_SHA !== '' &&
    process.env.PR_NUMBER !== ''
  ) {
    return [
      {
        number: process.env.PR_NUMBER,
        head: {
          sha: process.env.PR_SHA
        },
        url: `https://api.github.com/repos/${github.context.repo.owner}/${github.context.repo.repo}/pulls/${process.env.PR_NUMBER}`
      }
    ]
  }
  return []
}

function ownerRepo (url) {
  const match = url.match(/\/repos\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/pulls\//)
  return {
    owner: match[1],
    repo: match[2]
  }
}

async function genhtml (coverageFiles, tmpPath, workingDirectory) {
  const artifactName = core.getInput('artifact-name').trim()
  const artifactPath = path.resolve(tmpPath, 'html').trim()
  const args = [
    ...coverageFiles,
    '--rc',
    'lcov_branch_coverage=1',
    '--artifact-directory',
    artifactPath
  ]

  await exec.exec('genhtml', args, { cwd: workingDirectory })

  if (artifactName !== '') {
    const artifact = new DefaultArtifactClient()
    const globber = await glob.create(`${artifactPath}/**/**.*`)
    const htmlFiles = await globber.glob()

    core.info('Uploading artifacts.')

    await artifact.uploadArtifact(artifactName, htmlFiles, artifactPath)
  } else {
    core.info('Skip uploading artifacts')
  }
}

async function mergeCoverages (coverageFiles, tmpPath) {
  // This is broken for some reason:
  // const mergedCoverageFile = path.resolve(tmpPath, 'lcov.info');
  const mergedCoverageFile = tmpPath + '/lcov.info'
  const args = []

  for (const coverageFile of coverageFiles) {
    args.push('--add-tracefile')
    args.push(coverageFile)
  }

  args.push('--output-file')
  args.push(mergedCoverageFile)

  await exec.exec('lcov', [...args, '--rc', 'lcov_branch_coverage=1'])

  return mergedCoverageFile
}

async function summarize (coverageFile) {
  let output = ''

  const options = {}
  options.listeners = {
    stdout: (data) => {
      output += data.toString()
    },
    stderr: (data) => {
      output += data.toString()
    }
  }

  await exec.exec(
    'lcov',
    ['--summary', coverageFile, '--rc', 'lcov_branch_coverage=1'],
    options
  )

  const lines = output.trim().split(/\r?\n/)

  lines.shift() // Removes "Reading tracefile..."

  return lines.join('\n')
}

async function detail (coverageFile, workingDirectory, pullRequest, octokit) {
  let output = ''

  const options = {}
  options.listeners = {
    stdout: (data) => {
      output += data.toString()
    },
    stderr: (data) => {
      output += data.toString()
    }
  }

  await exec.exec(
    'lcov',
    [
      '--list',
      coverageFile,
      '--list-full-path',
      '--rc',
      'lcov_branch_coverage=1'
    ],
    options
  )

  let lines = output.trim().split(/\r?\n/)

  lines.shift() // Removes "Reading tracefile..."
  lines.pop() // Removes "Total..."
  lines.pop() // Removes "========"
  const listFilesOptions = octokit.rest.pulls.listFiles.endpoint.merge({
    pull_number: pullRequest.number,
    ...ownerRepo(pullRequest.url)
  })
  const listFilesResponse = await octokit.paginate(listFilesOptions)
  let changedFiles = listFilesResponse.map((file) => file.filename)

  lines = lines.filter((line, index) => {
    if (index <= 2) return true // Include header

    const match = detailPath.exec(line)
    if (match) {
      const linePath = path.resolve(workingDirectory, match.groups.path)
      for (const changedFile of changedFiles) {
        const relative = path.relative(linePath, changedFile)
        console.log(`${linePath} === ${changedFile}`)

        if (relative === '') {
          changedFiles = changedFiles.filter((x) => x !== changedFile)
          return true
        }
      }
    }

    return false
  })

  if (lines.length === 3) {
    // Only the header remains
    return ' n/a'
  }

  return '\n  ' + lines.join('\n  ')
}

run()
