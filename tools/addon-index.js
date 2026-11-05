// Writes addons/index.json: the catalog the manager reads from GitHub. Every file of every add-on in addons/catalog/<id>/ with its
// SHA-256, so the service installs nothing that does not match. Run it after changing an add-on (a test fails when the index is old).
//   node tools/addon-index.js [dir]    write [dir or addons]/index.json
//   node tools/addon-index.js [dir] --check   exit 1 when it is not up to date
'use strict';
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
// the folder is the first argument (a repository of your own: index.json beside catalog/), else addons/ of this repository
const argDir = process.argv.slice(2).filter(a => a.charAt(0) !== '-')[0];
const defaultRoot = path.join(__dirname, '..', 'addons');
const root = argDir ? path.resolve(argDir) : defaultRoot;

function walk(dir, base, out) {
  for (const n of fs.readdirSync(dir).sort()) {
    if (!base && /^preview\.(jpg|png|webp)$/.test(n)) continue; // the picture is read from GitHub for the manager, never installed
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, base + n + '/', out);
    else out[base + n] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return out;
}

function build(dir) {
  const addons = [];
  const cat = path.join(dir || defaultRoot, 'catalog');
  for (const id of fs.readdirSync(cat).sort()) {
    const dir = path.join(cat, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'addon.json'), 'utf8'));
    if (m.id !== id) throw new Error(id + ': the folder name must be the id');
    addons.push({
      id,
      name: m.name,
      version: m.version,
      description: m.description || '',
      about: m.about || '',
      preview: ['jpg', 'png', 'webp'].map(x => 'preview.' + x).filter(f => fs.existsSync(path.join(dir, f)))[0] || '',
      kind: m.kind,
      permissions: m.permissions || [],
      luna: (m.luna || []).map(l => l.uri),
      files: walk(dir, '', {}),
    });
  }
  return JSON.stringify({ addons }, null, 2) + '\n';
}

if (require.main === module) {
  const out = path.join(root, 'index.json'),
    text = build(root);
  if (process.argv.indexOf('--check') >= 0) {
    const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text;
    if (!same) console.error(out + ' is not up to date: run node tools/addon-index.js');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(out, text);
  console.log('wrote ' + out);
}
module.exports = { build };
