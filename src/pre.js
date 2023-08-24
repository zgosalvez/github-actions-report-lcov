const core = require('@actions/core');
const { execSync } = require('child_process');

function run() {
  try {
    console.log('Installing lcov');

    const platform = process.env.RUNNER_OS;
    if (platform === 'Linux') {
      execSync('sudo apt-get update');
      execSync('sudo apt-get install --assume-yes lcov');
    } else if (platform === 'macOS') {
      execSync('brew install lcov');
    }

    console.log('lcov installed successfully');
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
