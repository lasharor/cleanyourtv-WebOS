#!/usr/bin/env node
// Add-on repositories from a shell on the TV (docs/development/addon-repos.md). Talks to the service on 127.0.0.1:8765.
//   node /media/developer/cleanyourtv/cytv-addons.js shortcut     (once; then just: cytv-addons ...)
//   cytv-addons repos                          the repositories
//   cytv-addons repo-add <address> [name] [-y] add one: user/repo, user/repo@branch[/folder], or an https:// folder
//   cytv-addons repo-rm <name>                 remove one (what was installed from it stays)
//   cytv-addons list [repo]                    what the repositories offer, and what is installed
//   cytv-addons installed                      what is on the TV
//   cytv-addons install <id> [repo] [-y]       install (or reinstall) an add-on
//   cytv-addons update [id] [-y]               install newer versions of what is installed
//   cytv-addons remove <id>                    remove an installed add-on
//   cytv-addons shortcut                       one time: makes the command cytv-addons (~/.local/bin) so you need not type node and the path
// An add-on from a repository other than "official" is code that runs as root on the TV: the service asks for a confirm and this
// asks you (-y says yes). Plain ES5: it runs on Node 8.12.
'use strict';
var http = require('http');
var port = +process.env.CYTV_PORT || 8765;

function call(method, path, body, cb) {
  var data = body ? JSON.stringify(body) : '';
  var rq = http.request(
    { host: '127.0.0.1', port: port, method: method, path: path, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } },
    function (res) {
      var chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        var j = null;
        try {
          j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (e) {}
        cb(null, j || { error: 'the service answered ' + res.statusCode }, res.statusCode);
      });
    }
  );
  rq.on('error', function (e) {
    cb(e);
  });
  rq.setTimeout(120000, function () {
    rq.abort();
  });
  rq.end(data);
}
function fail(m) {
  console.error(m);
  process.exit(1);
}
function ask(question, cb) {
  process.stdout.write(question + ' [yes/N] ');
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', function (d) {
    process.stdin.pause();
    cb(/^\s*y(es)?\s*$/i.test(d));
  });
}
// a call that may need the confirm: asks once (or -y), then repeats it with confirm: true
function confirmed(method, path, body, yes, why, done) {
  call(method, path, body, function (e, j) {
    if (e) return fail('the CleanYourTV service does not answer on 127.0.0.1:' + port + ' (' + e.message + ')');
    if (!j.confirm) return done(j);
    var again = function () {
      body.confirm = true;
      call(method, path, body, function (e2, j2) {
        if (e2) fail(e2.message);
        done(j2);
      });
    };
    if (yes) return again();
    console.log(why + '\n');
    console.log('The code of an add-on runs as root on this TV and can read and change anything on it and on your network.');
    console.log('The checksum only shows that a file is the one the repository published, not that its author is trustworthy.');
    console.log('Only continue for people and projects you trust. The CleanYourTV project has not reviewed these add-ons.');
    console.log("Every repository is contacted whenever the add-ons list or a picture is opened, so its operator sees the TV's address.");
    (j.addons || []).forEach(function (a) {
      console.log('\n  ' + a.name + ' ' + a.version + ' (from ' + a.repo + ') may: ' + (a.can || []).join(', ') + '.');
    });
    console.log('');
    ask('Continue?', function (y) {
      if (!y) fail('Cancelled, nothing changed.');
      again();
    });
  });
}
function plain(method, path, body, done) {
  call(method, path, body, function (e, j) {
    if (e) return fail('the CleanYourTV service does not answer on 127.0.0.1:' + port + ' (' + e.message + ')');
    if (j.error) fail(j.error);
    done(j);
  });
}
// a column of n characters, and at least one space after it: a name made from a GitHub address easily fills its column
function pad(s, n) {
  s = String(s) + ' ';
  while (s.length < n) s += ' ';
  return s;
}
function showRepos(r) {
  r.repos.forEach(function (x) {
    console.log(pad(x.name, 24) + x.url + (x.official ? '   (the project’s own)' : ''));
  });
  if (!r.repos.length) console.log('No repositories. Add one: repo-add <address>');
}

var args = process.argv.slice(2);
var yes = args.indexOf('-y') >= 0 || args.indexOf('--yes') >= 0;
args = args.filter(function (a) {
  return a !== '-y' && a !== '--yes';
});
var cmd = args[0];

if (cmd === 'repos') {
  plain('GET', '/api/addons/repos', null, showRepos);
} else if (cmd === 'repo-add' && args[1]) {
  var b = { add: args[1] };
  if (args[2]) b.name = args[2];
  confirmed('POST', '/api/addons/repos', b, yes, 'Adding ' + args[1] + ' as a source of add-ons.', function (j) {
    if (j.error) fail(j.error);
    console.log('Added ' + j.added + '.');
    showRepos(j);
  });
} else if (cmd === 'repo-rm' && args[1]) {
  plain('POST', '/api/addons/repos', { remove: args[1] }, function (j) {
    console.log('Removed ' + j.removed + '. What was installed from it stays installed.');
  });
} else if (cmd === 'list') {
  plain('GET', '/api/addons/catalog', null, function (j) {
    j.addons
      .filter(function (a) {
        return !args[1] || a.repo === args[1];
      })
      .forEach(function (a) {
        var st = a.bundled ? 'ships with CleanYourTV' : a.update ? 'installed ' + a.installed + ', update' : a.installed ? 'installed ' + a.installed : '';
        console.log(pad(a.id, 16) + pad(a.version, 9) + pad(a.repo, 20) + pad(a.kind, 8) + st + '  ' + a.description);
      });
    (j.errors || []).forEach(function (x) {
      console.error('Could not read ' + x.repo + ': ' + x.error);
    });
  });
} else if (cmd === 'installed') {
  plain('GET', '/api/addons', null, function (j) {
    j.addons.forEach(function (a) {
      console.log(pad(a.id, 16) + pad(a.version || '', 9) + pad(a.status, 9) + (a.bundled ? 'ships with CleanYourTV' : a.repo ? 'from ' + a.repo : ''));
    });
  });
} else if (cmd === 'install' && args[1]) {
  confirmed('POST', '/api/addons/install', { id: args[1], repo: args[2] || '' }, yes, 'Installing ' + args[1] + (args[2] ? ' from ' + args[2] : '') + '.', function (j) {
    if (j.error) fail(j.error);
    console.log('Installed ' + j.id + ' ' + j.version + ' from ' + j.repo + (j.restartNeeded ? '. Restart the service to load the new code.' : '.'));
  });
} else if (cmd === 'update') {
  confirmed('POST', '/api/addons/update', args[1] ? { id: args[1] } : {}, yes, 'Updating add-ons from the repositories they were installed from.', function (j) {
    if (j.error) fail(j.error);
    j.updated.forEach(function (u) {
      console.log('Updated ' + u.id + ' to ' + u.version);
    });
    j.failed.forEach(function (u) {
      console.error('Failed ' + u.id + ': ' + u.error);
    });
    if (!j.updated.length && !j.failed.length) console.log('Everything is up to date.');
    if (j.restartNeeded) console.log('Restart the service to load the new code.');
  });
} else if (cmd === 'shortcut') {
  // one time: a command "cytv-addons" in ~/.local/bin, which is on root's PATH on webOS and survives reboots (/home is writable)
  var fs = require('fs'),
    path = require('path');
  var dir = path.join(process.env.HOME || '/home/root', '.local', 'bin'),
    file = path.join(dir, 'cytv-addons');
  // mkdir -p (Node 8 has no recursive option)
  var made = '';
  dir.split(path.sep).forEach(function (p, i) {
    made = i ? path.join(made, p) : p || path.sep;
    try {
      fs.mkdirSync(made);
    } catch (e) {}
  });
  fs.writeFileSync(file, '#!/bin/sh\nexec node ' + JSON.stringify(path.resolve(__filename)) + ' "$@"\n');
  fs.chmodSync(file, 493); // 0755
  console.log('Written ' + file + '. Log in again (or run it by that path); then: cytv-addons repos');
} else if (cmd === 'remove' && args[1]) {
  plain('POST', '/api/addons/remove', { id: args[1] }, function (j) {
    console.log('Removed ' + j.id + (j.restartNeeded ? '. Restart the service to unload it.' : '.'));
  });
} else {
  console.log(
    [
      'cytv-addons repos | repo-add <address> [name] | repo-rm <name>',
      'cytv-addons list [repo] | installed | install <id> [repo] | update [id] | remove <id> | shortcut      (-y: do not ask)',
      'An address is user/repo, user/repo@branch[/folder] or an https:// folder with an index.json.',
    ].join('\n')
  );
  process.exit(cmd ? 1 : 0);
}
