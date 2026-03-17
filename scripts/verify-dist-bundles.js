const fs = require('fs');

const distFiles = ['dist/main/index.js', 'dist/post/index.js'];
const unresolvedActionRequires = /require\(['"]@actions\//;

for (const distFile of distFiles) {
  const content = fs.readFileSync(distFile, 'utf8');

  if (unresolvedActionRequires.test(content)) {
    throw new Error(
      `Bundle ${distFile} still contains unresolved @actions/* requires.`,
    );
  }
}

console.log('Verified dist bundles do not contain unresolved @actions/* requires.');
