// Lint rules (node tools/lint.js). The service runs on Node 8 (webOS 5 and 6), the pages on Chromium 68: the rules catch mistakes a
// test may not reach, such as a name that is used but never defined.
const globals = require('globals');

const mistakes = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
};

module.exports = [
  {
    files: ['helper/*.js', 'scripts/jtool.js', 'webos4/*.js', 'tools/**/*.js'],
    ignores: ['tools/vendor/**'],
    languageOptions: { ecmaVersion: 2018, sourceType: 'commonjs', globals: Object.assign({}, globals.node) },
    rules: mistakes,
  },
  { files: ['webos4/runtime-install.js'], languageOptions: { ecmaVersion: 5, sourceType: 'commonjs' } },
  {
    // the scripts of the built pages, given to ESLint by tools/lint.js
    files: ['**/*.page.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      // what Chromium 68 has beyond ES5 (Promise, Intl) and what webOS adds
      globals: Object.assign({}, globals.browser, {
        Promise: 'readonly',
        Intl: 'readonly',
        webOS: 'readonly',
        webOSSystem: 'readonly',
        PalmSystem: 'readonly',
        PalmServiceBridge: 'readonly',
        qrcode: 'readonly',
      }),
    },
    // a page's functions are called from its markup and from each other across the files it is built from
    rules: Object.assign({}, mistakes, { 'no-unused-vars': 'off' }),
  },
];
