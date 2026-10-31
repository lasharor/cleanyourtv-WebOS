// Type checks and lint, with the tools in package.json (run npm install once; nothing of it is shipped):
//   node tools/lint.js
// 1. TypeScript checks the service (helper/*.js) from its code and JSDoc comments, without compiling anything (tsconfig.json);
// 2. ESLint checks the service, the scripts and tools for mistakes such as a name that is never defined (eslint.config.js);
// 3. ESLint checks the script of every page the TV loads as ES5 in a browser, with the TV's globals (webOSSystem, PalmServiceBridge);
// 4. Prettier checks that the code is formatted (npm run format formats it).
'use strict';
const fs = require('fs'),
  path = require('path'),
  cp = require('child_process');
const root = path.join(__dirname, '..');
const bin = n => path.join(root, 'node_modules', '.bin', n);
if (!fs.existsSync(bin('tsc')) || !fs.existsSync(bin('eslint'))) {
  console.log('skipped: run npm install once for the type checks and lint');
  process.exit(0);
}
let failed = 0;
const step = (name, cmd, args) => {
  const r = cp.spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  console.log((r.status === 0 ? 'ok   ' : 'FAIL ') + name + (r.status === 0 ? '' : '\n' + out));
  if (r.status !== 0) failed++;
};
step('types of the service (tsc)', bin('tsc'), ['-p', 'tsconfig.json']);
step('lint of the service, scripts and tools (eslint)', bin('eslint'), ['helper', 'scripts/jtool.js', 'webos4', 'tools']);
// the page scripts, as the TV gets them
// (written to .lint-pages, inside the project so ESLint's config applies; git ignores it)
const tmp = path.join(root, '.lint-pages');
cp.spawnSync('mkdir', ['-p', tmp]);
const pages = ['app', 'manager/app', 'picker/app', 'notify/app', 'webos4/app'];
for (const p of pages) {
  const html = fs.readFileSync(path.join(root, p, 'index.html'), 'utf8');
  const scripts = [];
  html.replace(/<script>([\s\S]*?)<\/script>/g, (_, s) => scripts.push(s));
  fs.writeFileSync(path.join(tmp, p.replace(/\//g, '-') + '.page.js'), scripts.join('\n;\n'));
}
step('lint of the page scripts as ES5 (eslint)', bin('eslint'), [path.relative(root, tmp)]);
cp.spawnSync('rm', ['-rf', tmp]);
step('formatting (prettier --check)', bin('prettier'), [
  '--check',
  'helper/*.js',
  'tools/**/*.js',
  'app/src/**/*.{js,css}',
  'manager/src/**/*.{js,css}',
  'i18n/*.js',
  'webos4/*.js',
  'webos4/src/*.{js,css}',
  'scripts/jtool.js',
  'eslint.config.js',
]);
process.exit(failed ? 1 : 0);
