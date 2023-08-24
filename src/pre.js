const core = require('@actions/core');

async function run() {
  try {
    console.log('Installing lcov');

    const { execSync } = require('child_process');

    execSync('sudo apt-get update');
    execSync('sudo apt-get install --assume-yes lcov');

    console.log('lcov installed successfully');
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
