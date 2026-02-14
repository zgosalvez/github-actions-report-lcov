const core = require('@actions/core');
const io = require('@actions/io');
const os = require('os');
const path = require('path');

let github;

async function run() {
  try {
    github = require('@actions/github');
    const tmpPath = path.resolve(os.tmpdir(), github.context.action);

    await io.rmRF(tmpPath);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();