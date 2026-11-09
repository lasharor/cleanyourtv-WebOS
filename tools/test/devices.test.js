// Paired devices (helper/devices.js): the pairing window and its code, one token per device kept as a hash, the list, block, remove,
// remove all, and removing devices that were not used.
const { ok, req, run } = require('./lib');

run(async () => {
  let saved = {};
  const store = { get: () => JSON.parse(JSON.stringify(saved)), set: o => (saved = JSON.parse(JSON.stringify(o))) };
  const D = req('devices').create(store, { max: 3, windowMs: 60000, label: 'agent' });

  ok(D.pair('123456', 'x', '10.0.0.5').status === 403, 'no window: a code is refused');
  const w = D.openWindow();
  ok(/^\d{6}$/.test(w.code) && D.windowOpen(), 'the window has a 6-digit code');
  ok(D.pair('000000', 'x', '10.0.0.5').status === 403, 'a wrong code is refused');
  const p = D.pair(w.code, 'Claude Code<script>', '10.0.0.5');
  ok(/^[0-9a-f]{8}\.[0-9a-f]{32}$/.test(p.token) && p.name === 'Claude Codescript', 'the right code gives a token; the name is cleaned');
  ok(
    JSON.stringify(saved).indexOf(p.token.split('.')[1]) < 0 && /^[0-9a-f]{64}$/.test(saved.devices[0].hash),
    'only a hash of the secret is kept'
  );
  ok(D.pair(w.code, 'again', '10.0.0.5').status === 403, 'the code works once');
  ok(D.windowState(w.id).paired.name === 'Claude Codescript', 'the window tells its page who paired');
  {
    const wa = D.openWindow(),
      a = D.pair(wa.code, 'someone', '10.0.0.5', p.token);
    ok(
      a.already === true && !a.token && a.id === p.id && D.count() === 1,
      'a device with a token that works is told it is connected already'
    );
    ok(D.windowState(wa.id).paired.id === p.id, 'and its window tells who it was');
    const wb = D.openWindow(),
      b = D.pair(wb.code, 'fresh', '10.0.0.10', 'ffffffff.' + '0'.repeat(32));
    ok(b.token && D.count() === 2 && D.remove(b.id), 'a token that does not work pairs as new');
  }
  {
    // a device that pairs just before the window ends: the manager still learns who paired (its QR screen closes on that)
    let s2 = {};
    const E = req('devices').create({ get: () => s2, set: o => (s2 = o) }, { max: 3, windowMs: 40, label: 'agent' }),
      we = E.openWindow();
    E.pair(we.code, 'late', '10.0.0.9');
    await new Promise(r => setTimeout(r, 80));
    ok(
      !E.windowOpen() && E.windowState(we.id).paired && E.windowState(we.id).paired.name === 'late',
      'an expired window still tells who paired'
    );
    const we2 = E.openWindow();
    await new Promise(r => setTimeout(r, 80));
    ok(E.pair(we2.code, 'too late', '10.0.0.9').status === 403, 'an expired code is refused');
  }

  ok(D.verify(p.token, '10.0.0.6').device.name === 'Claude Codescript', 'the token is accepted');
  ok(D.verify(p.token.slice(0, -1) + (p.token.slice(-1) === '0' ? '1' : '0')).error === 'revoked', 'a changed token is refused');
  ok(D.verify('nonsense').error === 'revoked', 'a token of the wrong shape is refused');
  ok(D.list()[0].ip === '10.0.0.6' && D.list()[0].active === true, 'the list has the address it was last used from, in use now');

  const w2 = D.openWindow(),
    q = D.pair(w2.code, 'Claude Codescript', '10.0.0.7');
  ok(q.name === 'Claude Codescript 2', 'a name already taken gets " 2"');
  ok(D.count() === 2, 'two devices');

  ok(D.setBlocked(q.id, true) && D.verify(q.token).error === 'blocked', 'a blocked device is refused');
  {
    // found on the TV: a blocked agent that paired again with its token was told it was connected
    const wk = D.openWindow(),
      k = D.pair(wk.code, 'blocked one', '10.0.0.11', q.token);
    ok(k.status === 403 && k.blocked && !k.already && !k.token && D.count() === 2, 'a blocked device that pairs again is refused');
    ok(!D.windowState(wk.id).paired, 'and its try does not use the code');
  }
  ok(D.setBlocked(q.id, false) && D.verify(q.token).device, 'and allowed again');
  ok(D.remove(q.id) && D.verify(q.token).error === 'revoked' && D.count() === 1, 'a removed device is refused');
  ok(!D.remove('ffffffff'), 'removing an unknown device says so');

  // the limit
  const w3 = D.openWindow();
  D.pair(w3.code, 'b', '10.0.0.8');
  const w4 = D.openWindow();
  D.pair(w4.code, 'c', '10.0.0.9');
  const w5 = D.openWindow();
  ok(D.pair(w5.code, 'd', '10.0.0.10').status === 409, 'no more than the limit');

  // guessing
  const w6 = D.openWindow();
  for (let i = 0; i < 5; i++) D.pair('111111', 'g', '10.0.0.66');
  ok(D.pair(w6.code, 'g', '10.0.0.66').status === 429, 'five tries a minute per address');
  for (let i = 0; i < 8; i++) D.pair('222222', 'g', '10.0.1.' + i);
  ok(!D.windowOpen(), 'eight wrong codes close the window');

  // unused devices
  ok(D.expireDays() === 14, 'unused devices go after two weeks by default');
  ok(!D.setExpire(5) && D.setExpire(1) && D.expireDays() === 1, 'the choices are 0, 1, 3, 7, 14 and 30');
  saved.devices.forEach(d => {
    d.seen = d.created = Date.now() - 3 * 864e5;
  });
  const keep = saved.devices[0].id;
  const fresh = req('devices').create(store, { max: 3 }); // a new start: nothing seen in memory
  const before = fresh.count();
  saved.devices[0].seen = Date.now(); // used now
  const gone = fresh.sweep();
  ok(
    gone.length === before - 1 && fresh.count() === 1 && fresh.list()[0].id === keep,
    'the sweep removes the unused ones and keeps the one in use'
  );
  ok(fresh.removesIn(keep) > 0 && fresh.removesIn(keep) <= 864e5, 'and says when the kept one goes');
  ok(fresh.setExpire(0) && fresh.sweep().length === 0 && fresh.removesIn(keep) === null, 'Never removes nothing');
  ok(fresh.removeAll() === 1 && fresh.count() === 0, 'remove all');
});
