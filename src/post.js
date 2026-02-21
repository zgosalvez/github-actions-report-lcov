const core = require('@actions/core');
const os = require('os');
const path = require('path');

let github;
let io;

async function run() {
  try {
    github = await import('@actions/github');
    io = await import('@actions/io');

    const tmpPath = path.resolve(os.tmpdir(), github.context.action);

    await io.rmRF(tmpPath);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
