/* the remote's Input and Home buttons differ between remotes and firmware: learn their codes from the hook, then test */
function kShow(text, list) {
  kText = text;
  kRows = list;
  build();
  idx = 0;
  draw();
}
function openKeys(flow) {
  kFlow = flow || 'input';
  if (view !== 'keys') push('keys');
  kStep(kFlow === 'home' || kFlow === 'voice' || kFlow === 'guide' ? kFlow : 'input');
}
function closeKeys() {
  clearTimeout(kTimer);
  banner('');
  pop();
  load(true);
}
function kName(n) {
  return n === 'input' ? 'Input' : n === 'voice' ? 'voice' : n === 'guide' ? 'Guide' : 'Home';
}
function kStep(n) {
  clearTimeout(kTimer);
  var k = (st && st.keys) || { input: '241', home: '' };
  if (n === 'input')
    return kShow('The Input key.\nChoose Start, then press the Input button on your remote.', [
      {
        label: 'Start',
        sub: k.inputIsDefault ? 'default: ' + k.input : 'learned: ' + k.input,
        fn: function () {
          kLearn('input');
        },
      },
      {
        label: 'Skip',
        fn: function () {
          kStep('test');
        },
      },
      {
        label: 'Clear',
        sub: 'back to the default (241)',
        dim: k.inputIsDefault,
        fn: function () {
          if (!k.inputIsDefault) kClear('input');
        },
      },
      { label: 'Close', fn: closeKeys },
    ]);
  if (n === 'home')
    return kShow(
      'The Home key.\nIt turns back to the first page of the book while a page shows (Live TV, an add-on\u2019s page). Most remotes send 773, which is used until another code is learned: learn it if Home does nothing on a page. Choose Start, then press the Home button on your remote.',
      [
        {
          label: 'Start',
          sub: k.home ? 'now: ' + k.home : 'now: 773 (the usual code)',
          fn: function () {
            kLearn('home');
          },
        },
        {
          label: 'Clear',
          sub: 'forget the code',
          dim: !k.home,
          fn: function () {
            if (k.home) kClear('home');
          },
        },
        { label: 'Close', fn: closeKeys },
      ]
    );
  if (n === 'voice')
    return kShow(
      'The voice button.\nChoose Start, then press the button you want to use for voice. The remote\u2019s microphone button may not reach the hook; any spare button works.',
      [
        {
          label: 'Start',
          sub: k.voice ? 'now: ' + k.voice : '',
          fn: function () {
            kLearn('voice');
          },
        },
        {
          label: 'Clear',
          sub: 'forget the code',
          dim: !k.voice,
          fn: function () {
            if (k.voice) kClear('voice');
          },
        },
        { label: 'Close', fn: closeKeys },
      ]
    );
  if (n === 'guide')
    return kShow(
      'The Guide key.\nChoose Start, then press the Guide button on your remote. It then opens the TV guide (LG tuner) when that add-on is on, else the Live TV channel guide, instead of LG\u2019s guide. It does nothing until one of them is on. Clear it to get LG\u2019s guide back.',
      [
        {
          label: 'Start',
          sub: k.guide ? 'now: ' + k.guide : '',
          fn: function () {
            kLearn('guide');
          },
        },
        {
          label: 'Clear',
          sub: 'LG\u2019s guide again',
          dim: !k.guide,
          fn: function () {
            if (k.guide) kClear('guide');
          },
        },
        { label: 'Close', fn: closeKeys },
      ]
    );
  if (n === 'test') return kTest();
  if (n === 'done')
    return api('/api/manager/keys-done', {})
      .then(function () {
        return api('/api/manager/status');
      })
      .then(
        function (s) {
          st = s;
          kShow(
            'Done.\nInput key ' +
              ((s.keys || {}).input || '241') +
              '.\nThe Home key turns back to Home from a page of the book (773 unless another code is learned): learn it from the main list if Home does nothing on a page.',
            [{ label: 'Close', fn: closeKeys }]
          );
        },
        function () {
          closeKeys();
        }
      );
}
function kClear(name) {
  api('/api/manager/clear-key', { name: name })
    .then(function () {
      return api('/api/manager/status');
    })
    .then(
      function (s) {
        st = s;
        kShow(
          name === 'input'
            ? 'Input key cleared.\nIt uses the default code (' + ((s.keys || {}).input || '241') + ').'
            : name === 'voice'
              ? 'Voice button cleared.'
              : name === 'guide'
                ? 'Guide key cleared. LG\u2019s guide is back.'
                : 'Home key cleared.',
          [{ label: 'Close', fn: closeKeys }]
        );
      },
      function () {
        closeKeys();
      }
    );
}
function kLearn(name) {
  api('/api/manager/learn-key', { name: name }).then(function () {
    kShow('Press the ' + kName(name) + ' button now\u2026', [
      {
        label: 'Cancel',
        fn: function () {
          kStep(name);
        },
      },
    ]);
    (function poll() {
      kTimer = setTimeout(function () {
        api('/api/manager/learn-state').then(
          function (l) {
            if (view !== 'keys') return;
            if (l.state === 'got') {
              kShow(kName(name) + ' key learned: code ' + l.code + '.', [
                {
                  label: name === 'input' ? 'Continue to the test' : 'Close',
                  fn: function () {
                    api('/api/manager/status').then(function (s) {
                      st = s;
                      if (name === 'input') kStep('test');
                      else closeKeys();
                    });
                  },
                },
              ]);
              return;
            }
            if (l.state === 'unsupported') {
              api('/api/manager/options', { inputKey: false });
              kShow(
                'The hook did not attach on this firmware, so keys cannot be learned. The Input key stays with LG\u2019s picker.\nUse Share log to report this.',
                [{ label: 'Close', fn: closeKeys }]
              );
              return;
            }
            if (l.state === 'blind') {
              api('/api/manager/options', { inputKey: false });
              kShow(
                'The hook is in LG’s input service, but no button reaches it on this TV, so keys cannot be learned. The Input key stays with LG’s picker.\nUse Share log to report this.',
                [{ label: 'Close', fn: closeKeys }]
              );
              return;
            }
            if (l.state === 'timeout') {
              kShow('Nothing was pressed.', [
                {
                  label: 'Try again',
                  fn: function () {
                    kLearn(name);
                  },
                },
                {
                  label: name === 'input' ? 'Skip' : 'Close',
                  fn: function () {
                    if (name === 'input') kStep('test');
                    else closeKeys();
                  },
                },
              ]);
              return;
            }
            poll();
          },
          function () {
            poll();
          }
        );
      }, 500);
    })();
  });
}
function kTest() {
  api('/api/manager/test-key').then(function (t0) {
    kShow('Test.\nPress the Input button once more. Our Inputs list should open over this screen.', [
      {
        label: 'Skip',
        fn: function () {
          kStep('done');
        },
      },
    ]);
    var until = Date.now() + 40000;
    (function poll() {
      kTimer = setTimeout(function () {
        api('/api/manager/test-key').then(
          function (t) {
            if (view !== 'keys') return;
            if (t.pickerShownAt > t0.now) {
              kShow('The Inputs list opened: the Input key works.', [
                {
                  label: 'Continue',
                  fn: function () {
                    kStep('done');
                  },
                },
              ]);
              return;
            }
            if (Date.now() > until) {
              kShow(
                'The Inputs list did not open.\nIf LG\u2019s own picker showed, the Input key is not mapped: learn it again or switch the Input key off.',
                [
                  {
                    label: 'Learn again',
                    fn: function () {
                      kStep('input');
                    },
                  },
                  {
                    label: 'Skip',
                    fn: function () {
                      kStep('done');
                    },
                  },
                ]
              );
              return;
            }
            poll();
          },
          function () {
            poll();
          }
        );
      }, 700);
    })();
  });
}
