// Writes cards/index.json: the catalog the manager reads from GitHub. Every file of every card in cards/catalog/<id>/ with its SHA-256
// (the picture, preview.jpg, is listed apart: it is read for the manager and never installed), so the service installs nothing that does
// not match. Run it after changing a card (a test fails when the index is old).
//   node tools/card-index.js          write cards/index.json
//   node tools/card-index.js --check  exit 1 when it is not up to date
'use strict';
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const root = path.join(__dirname, '..', 'cards');

function build() {
  const cards = [];
  const cat = path.join(root, 'catalog');
  for (const id of fs.readdirSync(cat).sort()) {
    const dir = path.join(cat, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'card.json'), 'utf8'));
    if (m.id !== id) throw new Error(id + ': the folder name must be the id');
    const files = {};
    for (const n of fs.readdirSync(dir).sort())
      if (!/^preview\.(jpg|png|webp)$/.test(n))
        files[n] = crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(dir, n)))
          .digest('hex');
    cards.push({
      id,
      name: m.name,
      version: m.version,
      description: m.description || '',
      about: m.about || '',
      preview: ['jpg', 'png', 'webp'].map(x => 'preview.' + x).filter(f => fs.existsSync(path.join(dir, f)))[0] || '',
      files,
    });
  }
  return JSON.stringify({ cards }, null, 2) + '\n';
}

if (require.main === module) {
  const out = path.join(root, 'index.json'),
    text = build();
  if (process.argv.indexOf('--check') >= 0) {
    const same = fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text;
    if (!same) console.error('cards/index.json is not up to date: run node tools/card-index.js');
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(out, text);
  console.log('wrote cards/index.json');
}
module.exports = { build };
