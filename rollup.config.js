const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');
const { nodeResolve } = require('@rollup/plugin-node-resolve');

const external = [
  /^node:/,
  'fs',
  'os',
  'path',
  'crypto',
  'stream',
  'http',
  'https',
  'url',
  'util',
  'zlib',
  'events',
  'buffer',
];

function createConfig(input, outputFile) {
  return {
    input,
    output: {
      file: outputFile,
      format: 'cjs',
      sourcemap: true,
      inlineDynamicImports: true,
      exports: 'auto',
    },
    external,
    onwarn(warning, warn) {
      const code = warning.code;
      const id = warning.id || '';
      const ids = Array.isArray(warning.ids) ? warning.ids : [];
      const fromNodeModules = id.includes('node_modules') || (ids.length > 0 && ids.every((entry) => entry.includes('node_modules')));

      if (fromNodeModules && (code === 'THIS_IS_UNDEFINED' || code === 'CIRCULAR_DEPENDENCY')) {
        return;
      }

      warn(warning);
    },
    plugins: [
      nodeResolve({
        preferBuiltins: true,
      }),
      commonjs({
        transformMixedEsModules: true,
      }),
      json(),
    ],
  };
}

module.exports = [
  createConfig('src/main.js', 'dist/main/index.js'),
  createConfig('src/post.js', 'dist/post/index.js'),
];
