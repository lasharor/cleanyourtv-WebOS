// The input hook (inputhook.js): which of LG's processes it goes into (issue 23: hooked into micomservice, HDMI-CEC control of
// other devices and eARC stopped working), and a hook that attached but receives no button (issue 185).
const fs = require('fs'),
  path = require('path');
const { ok, req, run } = require('./lib');

const PROC = process.env.CYTV_PROC;
const proc = (pid, name) => {
  fs.mkdirSync(path.join(PROC, String(pid)));
  fs.writeFileSync(path.join(PROC, String(pid), 'comm'), name + '\n');
};

run(async () => {
  const hook = req('inputhook');
  proc(100, 'micomservice');
  proc(200, 'lginput2');
  proc(300, 'tvservice');
  proc(400, 'bash');
  let p = hook.procs();
  ok(
    p.length === 1 && p[0].name === 'lginput2',
    "where LG's input service runs, the hook goes only into lginput2, never into micomservice"
  );
  fs.unlinkSync(path.join(PROC, '200', 'comm'));
  fs.rmdirSync(path.join(PROC, '200'));
  p = hook.procs();
  ok(
    p
      .map(x => x.name)
      .sort()
      .join() === 'micomservice,tvservice',
    'firmware without lginput2: the other input processes, as before'
  );

  // issue 185 (55UN6950ZUA): the hook attaches in lginput2 but no button ever reaches it. Learning says so instead of "nothing pressed".
  const LOG = process.env.CYTV_HOOK_LOG;
  const later = fn => {
    const now = Date.now;
    Date.now = () => now() + 46000;
    try {
      return fn();
    } finally {
      Date.now = now;
    }
  };
  fs.writeFileSync(LOG, '[INFO] InputHook initialized\n[INFO] Replacing lginput_uinput_send_button\n[DEBG] lib_main returned: 0\n');
  hook.startLearn('remap');
  ok(hook.learnState().state === 'waiting', 'blind hook: waiting while the step runs');
  ok(later(hook.learnState).state === 'blind', 'blind hook: no button in the whole log when the step ends -> blind');
  ok(hook.hookInfo().blind === true && hook.status().hook.blind === true, 'blind hook: reported in the status');
  fs.appendFileSync(LOG, '[INFO] lginput_uinput_send_button called: keyid=7, state=1 uinput_code=108\n');
  ok(hook.hookInfo().blind === false, 'blind hook: cleared once a button shows up in the log');
  // the hook works, only nothing new was pressed during the step: a plain timeout, as before
  hook.startLearn('remap');
  ok(later(hook.learnState).state === 'timeout', 'working hook, nothing pressed: timeout, not blind');
});
