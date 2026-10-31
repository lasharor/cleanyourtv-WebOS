'use strict';
const cp = require('child_process'),
  path = require('path');
const { root, ok, run } = require('./lib');
run(async () => {
  const result = cp.spawnSync('python3', [path.join(root, 'tools/test/webos4homepatch_test.py')], { encoding: 'utf8' });
  ok(result.status === 0, 'HOME generation rejects unknown firmware and ambiguous replacements: ' + (result.stderr || ''));
});
