// A stand-in Android device for the tests: it speaks enough of ADB over a local port for adbclient.js (connect, sign-in with an RSA key,
// one shell command) and records what it was asked. It checks the signature the way a real box does.
//   device({trusted, prompt, auth, reply, refuse}) -> Promise<{port, seen: {keys, commands, signatures, good}, close()}>
//     trusted: PEM of the key this device already allows      prompt: 'accept' | 'deny' for a key it does not know
//     auth: false = no sign-in at all                         reply(command): the command's output
//     refuse: true = close the stream instead of running the command
// KEY and KEY_ENCODED are the private key and the public key as Android wants it, from the tests of
// https://github.com/cocool97/adb_client (MIT licence, Copyright (c) cocool97), used here as a known answer.
const net = require('net'),
  crypto = require('crypto');
const adb = require('../../helper/addons-bundled/androidbox/adbclient');

const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC4Dyn85cxDJnjM
uYXQl/w469MDKdlGdviLfmFMWeYLVfL2Mz1AVyvKqscrtlhbbgMQ/M+3lDvEdHS0
14RIGAwWRtrlTTmhLvM2/IO+eSKSYeCrCVc4KLG3E3WRryUXbs2ynA29xjTJVw+Z
xYxDyn/tAYPEyMm4v+HIJHcOtRzxtO2vjMJ2vBT/ywYxjhncXbFSO09q2E4XrHli
SIPyO82hZgCkpzTZRp+nyA17TYuV9++mvUr9lWH9RbC+o8EF3yitlBsE2uXr97EV
i2Qy8CE7FIxsihXlukppwKRuz+1rJrvmZPTn49ZS+sIS99WE9GoCpsyQvTpvehrM
SIDRsVZPAgMBAAECggEAWNXAzzXeS36zCSR1yILCknqHotw86Pyc4z7BGUe+dzQp
itiaNIaeNTgN3zQoGyDSzA0o+BLMcfo/JdVrHBy3IL1cAxYtvXTaoGxp7bGrlPk2
pXZhqVJCy/jRYtokzdWF5DHbk/+pFJA3kGE/XKzM54g2n/DFI61A/QdUiz2w1ZtI
vc5cM08EM8B/TSI3SeWB8zkh5SlIuLsFO2J2+tCak6PdFfKOVIrFv9dKJYLxx+59
+edZamw2EvNlnl/sewgUk0gaZvQKVf4ivHyM+KSHuV4RFfiLvGuVcyA6XhSjztsG
EA++jDHP5ib/Izes7UK09v9y7kow+z6vUtnDDQOvgQKBgQD8WWAn7FQt9aziCw19
gZynzHG1bXI7uuEVSneuA3UwJImmDu8W+Qb9YL9Dc2nV0M5pGGdXKi2jzq8gPar6
GPAmy7TOlov6Nm0pbMXTAfuovG+gIXxelp3US3FvyRupi0/7UQRRwvetFYbDFwJX
ydF5uEtZdGSHAjPeU5FLq6tBwQKBgQC6uN0JwwZn+eaxguyKOXvp0KykhFI0HI1A
MBDZ1uuKt6OW5+r9NeQtTLctGlNKVQ8wz+Wr0C/nLGIIv4lySS9WFyc5/FnFhDdy
LsEi6whcca4vq3jsMOukvQGFnERsou4LqBEI1Es7jjeeEq+/8WnNTi6Y1flZ6UAp
YAOeFI98DwKBgQDvyfHgHeajwZalOQF5qGb24AOQ9c4dyefGNnvhA/IgbCfMftZc
iwhETuGQM6R3A7KQFRtlrXOu+2BYD6Ffg8D37IwD3vRmL7+tJGoapwC/B0g+7nLi
4tZY+9Nv+LbrdbDry8GB+/UkKJdk3IFicCk4M5KOD1bTH5mwAtLHB/p1QQKBgDHi
k8M45GxA+p4wMUvYgb987bLiWyfq/N3KOaZJYhJkb4MwoLpXfIeRuFqHbvsr8GwF
DwIxE6s6U1KtAWaUIN5qPyOhxMYdRcbusNDIZCp2gKfhsuO/SiVwDYkJr8oqWVip
5SsrtJHLtBY6PdQVBkRAf/h7KiwYQfkL2suQCKmHAoGBAJAkYImBYPHuRcnSXikn
xGDK/moPvzs0CjdPlRcEN+Myy/G0FUrOaC0FcpNoJOdQSYz3F6URA4nX+zj6Ie7G
CNkECiepaGyquQaffwR1CAi8dH6biJjlTQWQPFcCLA0hvernWo3eaSfiL7fHyym+
ile69MHFENUePSpuRSiF3Z02
-----END PRIVATE KEY-----`;
const KEY_ENCODED =
  'QAAAAFH/pU9PVrHRgEjMGnpvOr2QzKYCavSE1fcSwvpS1uPn9GTmuyZr7c9upMBpSrrlFYpsjBQ7IfAyZIsVsffr5doEG5StKN8FwaO+sEX9YZX9Sr2m7/eVi017Dcinn0bZNKekAGahzTvyg0hieawXTthqTztSsV3cGY4xBsv/FLx2woyv7bTxHLUOdyTI4b+4ycjEgwHtf8pDjMWZD1fJNMa9DZyyzW4XJa+RdRO3sSg4Vwmr4GGSInm+g/w28y6hOU3l2kYWDBhIhNe0dHTEO5S3z/wQA25bWLYrx6rKK1dAPTP28lUL5llMYX6L+HZG2SkD0+s4/JfQhbnMeCZDzOX8KQ+4ThLy/gDTqCSTjjic8BykdUIqYPwAjBMgQwLOLY5WNJMpjGlFINRcCGhvFFZ73sJTLerECuV/OaenFRcORwnGIRgMrYXj4tjmxJC7sq3cfNX96YIcSCDE9SZFdlKXVK8Jc4YMLGF3MI8k1KoTby34uaIyxPJvwM1WR4Rdj60fwMyikFXNaOR2fPteZ3UMBA7CMrOEm9iYjntyEppA4hQXIO1TWTzkA/Kfl1i67k5NuLIQdhPFEc5ox5IYVHusauPQ7dAwu6BlgK37TUn0JdK0Z6Z4RaEIaNiEI0d5CoP6zQKV2QQnlscYpdsaUW5t9/FLioVXPwrz0tx35JyIUZPPYwEAAQA=';

function device(o) {
  const opts = o || {};
  const seen = { keys: [], commands: [], signatures: 0, good: 0 };
  const server = net.createServer(sock => {
    let token = null;
    const send = (c, a0, a1, d) => sock.write(adb.packet(c, a0, a1, d));
    const challenge = () => {
      token = crypto.randomBytes(20);
      send('AUTH', 1, 0, token);
    };
    const feed = adb.reader(p => {
      if (p.cmd === 'CNXN') {
        if (opts.auth === false) send('CNXN', adb.VERSION, 4096, Buffer.from('device::\0'));
        else challenge();
      } else if (p.cmd === 'AUTH' && p.a0 === 2) {
        seen.signatures++;
        let good = false;
        try {
          const plain = crypto.publicDecrypt({ key: opts.trusted || KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, p.data);
          good = !!opts.trusted && plain.equals(Buffer.concat([adb.SHA1_PREFIX, token]));
        } catch (_) {}
        if (good) {
          seen.good++;
          send('CNXN', adb.VERSION, 4096, Buffer.from('device::\0'));
        } else challenge();
      } else if (p.cmd === 'AUTH' && p.a0 === 3) {
        seen.keys.push(p.data.toString('ascii'));
        if (opts.prompt === 'accept') setTimeout(() => send('CNXN', adb.VERSION, 4096, Buffer.from('device::\0')), 20);
      } else if (p.cmd === 'OPEN') {
        if (opts.refuse) return send('CLSE', 0, p.a0);
        const cmd = p.data
          .toString('utf8')
          .replace(/\0$/, '')
          .replace(/^shell:/, '');
        seen.commands.push(cmd);
        send('OKAY', 7, p.a0);
        const out = opts.reply ? opts.reply(cmd) : '';
        if (out) send('WRTE', 7, p.a0, Buffer.from(out));
        send('CLSE', 7, p.a0);
      }
    });
    sock.on('data', c => {
      try {
        feed(c);
      } catch (_) {
        sock.destroy();
      }
    });
    sock.on('error', () => {});
  });
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, seen, close: () => server.close() }))
  );
}

module.exports = { device, KEY, KEY_ENCODED };
