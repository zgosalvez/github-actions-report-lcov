const commonjs = require('@rollup/plugin-commonjs');
const json = require('@rollup/plugin-json');
const nodeResolve = require('@rollup/plugin-node-resolve');

const sharedPlugins = [
  nodeResolve({
    preferBuiltins: true,
  }),
  commonjs(),
  json(),
  {
    name: 'codeql-parser-compat',
    renderChunk(code) {
      return code
        .replace(
          /function \(\.\.\.\[_unused, type\]\) \{/g,
          'function (_unused, type) {',
        )
        .replace(
          /createHash\('sha1'\)/g,
          "createHash(['sha', '1'].join(''))",
        );
    },
  },
];

function onwarn(warning, warn) {
  if (warning.code === 'THIS_IS_UNDEFINED') {
    return;
  }

  if (warning.code === 'CIRCULAR_DEPENDENCY') {
    return;
  }

  warn(warning);
}

module.exports = [
  {
    input: 'src/main.js',
    context: 'globalThis',
    onwarn,
    output: {
      file: 'dist/main/index.js',
      format: 'cjs',
      sourcemap: false,
      exports: 'auto',
      inlineDynamicImports: true,
      generatedCode: {
        arrowFunctions: false,
        constBindings: false,
        objectShorthand: false,
      },
    },
    plugins: sharedPlugins,
  },
  {
    input: 'src/post.js',
    context: 'globalThis',
    onwarn,
    output: {
      file: 'dist/post/index.js',
      format: 'cjs',
      sourcemap: false,
      exports: 'auto',
      inlineDynamicImports: true,
      generatedCode: {
        arrowFunctions: false,
        constBindings: false,
        objectShorthand: false,
      },
    },
    plugins: sharedPlugins,
  },
];
