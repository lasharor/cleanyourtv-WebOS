function refreshDone() {
  load(true);
}
function run(path, body) {
  api(path, body).then(
    function (r) {
      if (r.error) banner(r.error, 'err');
      else poll();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function opt(o) {
  api('/api/manager/options', o).then(
    function (s) {
      st = s;
      build();
      draw();
    },
    function () {
      banner('The service did not answer', 'err');
    }
  );
}
function poll() {
  clearTimeout(pollT);
  api('/api/manager/status').then(
    function (s) {
      st = s;
      var j = s.job || {};
      if (j.state === 'working') {
        banner(j.message, 'work');
        build();
        draw();
        pollT = setTimeout(poll, 1000);
      } else {
        if (j.state === 'error') banner(j.message, 'err');
        else if (j.state === 'done') banner(j.message, 'ok');
        else banner('');
        build();
        draw();
      }
    },
    function () {
      banner('Waiting for the service…', 'work');
      pollT = setTimeout(poll, 2000);
    }
  );
}
function load(keep) {
  api('/api/manager/status').then(
    function (s) {
      offline = false;
      st = s;
      if (s.job && s.job.state === 'working') {
        poll();
        return;
      }
      if (!keep) banner('');
      build();
      if (idx >= rows.length) idx = 0;
      draw();
      if (wantTab >= 0) {
        var w = wantTab;
        wantTab = -1;
        setTab(w);
      }
      /* the Android box settings are read apart from the status, which stays as it is */
      api('/api/androidbox').then(
        function (r) {
          ab = r;
          if (view === 'main') {
            build();
            draw();
          }
        },
        function () {}
      );
      if (s.checking)
        setTimeout(function () {
          load(true);
        }, 2000);
    },
    function () {
      offline = true;
      build();
      idx = setupIdx;
      draw();
      banner('');
      if (!checkedOffline) {
        checkedOffline = true;
        setupDefaults();
        offlineCheck();
      }
    }
  );
}
