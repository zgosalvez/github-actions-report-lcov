const core = require('@actions/core')
const github = require('@actions/github')
const io = require('@actions/io')
const os = require('os')
const path = require('path')

async function run () {
  try {
    const tmpPath = path.resolve(os.tmpdir(), github.context.action)

    await io.rmRF(tmpPath)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
