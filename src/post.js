const os = require('os');
const path = require('path');

let core;
let github;
let io;

async function run() {
  try {
    core = await import('@actions/core');
    github = await import('@actions/github');
    io = await import('@actions/io');

    const tmpPath = path.resolve(os.tmpdir(), github.context.action);

    await io.rmRF(tmpPath);
  } catch (error) {
    if (core && typeof core.setFailed === 'function') {
      core.setFailed(error.message);
      return;
    }

    throw error;
  }
}

run();
