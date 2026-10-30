#!/usr/bin/env python3
"""Interactive PC-side HOME experiment. No credentials or device identity in the report."""
import argparse
import getpass
import hashlib
import json
from pathlib import Path
import secrets
import shlex
import sys
import time

HERE = Path(__file__).resolve().parent
BASE = '/media/developer/cleanyourtv'
VARIANTS = (
    ('probe', 'Solo detectar HOME (no debe abrir LG ni CleanYourTV)'),
    ('plain', 'Abrir CleanYourTV: orden simple'),
    ('recent', 'Abrir CleanYourTV: orden recent'),
    ('public', 'Abrir CleanYourTV: bus publico'),
)
HELPER_SHA = 'ed1e72cd29e375452bbf03cad4ddc5bafb6936912a13004f5cb24c969a5cb8fc'
HELPER_RUN = '''#!/bin/sh
BASE=/media/developer/node-test/runtime/usr/palm/services/io.strem.tv.server/bin
DIR=/media/developer/cleanyourtv
export CYTV_WEBOS4_DIR="$DIR/state"
export CYTV_DIR="$DIR/state"
mkdir -p "$DIR/state"
exec /lib/ld-linux.so.3 --library-path "$BASE/lib:/lib:/usr/lib" "$BASE/node18" "$DIR/helper/webos4.js" --allow-launch
'''


def run(client, command, timeout=12):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    stdin.close()
    out = stdout.read().decode('utf-8', 'replace')
    error = stderr.read().decode('utf-8', 'replace')
    if stdout.channel.recv_exit_status() != 0:
        raise RuntimeError('La orden remota ha fallado: ' + error[:300])
    return out


def yes(prompt):
    return input(prompt + ' [s/N]: ').strip().lower() in ('s', 'si', 'sí')


def baseline(sftp):
    with sftp.open('/home/root/.config/lginputhook/keybinds.json') as f:
        if '773' in json.loads(f.read()):
            raise RuntimeError('HOME ya tiene una asignacion. No se reemplazara.')
    with sftp.open('/proc/mounts') as f:
        mounts = f.read().decode()
    if ' /usr/lib/qt5/qml/KeyFilters/systemUi.js ' in mounts:
        raise RuntimeError('Hay un parche QML de HOME montado. Restaurar primero LG; no se superpondran pruebas.')
    boot = sftp.listdir('/var/lib/webosbrew/init.d')
    if any('cleanyourtv' in name.lower() and 'home' in name.lower() for name in boot):
        raise RuntimeError('Hay un arranque HOME anterior. Revisarlo antes; esta prueba no lo borrara.')


def helper(client, sftp):
    def health():
        return json.loads(run(client, 'curl -fsS --max-time 3 http://127.0.0.1:8765/api/service'))
    try:
        state = health()
    except (RuntimeError, ValueError):
        with sftp.open(BASE + '/helper/webos4.js', 'rb') as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        with sftp.open(BASE + '/run_helper.sh', 'rb') as f:
            script = f.read().decode().replace('\r\n', '\n')
        if digest != HELPER_SHA or script.strip() != HELPER_RUN.strip():
            raise RuntimeError('El helper difiere de la version validada. No se arrancara automaticamente.')
        if not yes('El helper esta parado. ¿Arrancar el helper manual validado, sin cambiar el arranque?'):
            raise RuntimeError('Sin helper: prueba cancelada')
        run(client, 'nohup sh ' + BASE + '/run_helper.sh </dev/null >>' + BASE + '/helper.log 2>&1 &')
        state = None
        for _ in range(8):
            time.sleep(1)
            try:
                state = health()
                break
            except (RuntimeError, ValueError):
                pass
        if state is None:
            raise RuntimeError('El helper no responde. No se cambiara HOME.')
    if state.get('readOnly') is not False:
        raise RuntimeError('El helper no permite abrir apps. No se cambiara HOME.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', help='IP de la TV (se pregunta si se omite)')
    parser.add_argument('--list', action='store_true', help='Mostrar el plan sin conectar ni cambiar nada')
    parser.add_argument('--observe', action='store_true', help='Leer HOME directamente sin cambiar su asignacion a LG')
    args = parser.parse_args()
    variants = (('observe', 'Observar HOME sin cambiar la asignacion de LG'),) if args.observe else VARIANTS
    print('HOME temporal: observacion directa, dos minutos.' if args.observe else 'HOME temporal: 1 diagnostico y 3 variantes, de dos minutos cada una.')
    print('Una variante cada vez. Sin cerrar apps, actualizar, reiniciar ni tocar el arranque.')
    for number, (_, label) in enumerate(variants):
        print(str(number) + ': ' + label)
    if args.list:
        return
    try:
        import paramiko
    except ImportError:
        raise RuntimeError('Este PC necesita Paramiko: python -m pip install paramiko') from None
    host = args.host or input('IP de la TV: ').strip()
    password = getpass.getpass('Contrasena SSH (vacia para usar clave): ')
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(host, username='root', password=password or None, timeout=8, banner_timeout=8, auth_timeout=15)
    password = None
    sftp = None
    active = None
    session = str(int(time.time() * 1000)) + '-' + secrets.token_hex(4)
    remote = BASE + '/home-lab-' + session
    output = HERE.parent / 'dist' / 'webos4' / ('home-test-' + session + '.json')
    report = {'session': session, 'tests': [], 'finished': False}
    output.parent.mkdir(parents=True, exist_ok=True)

    def save():
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def command(*words):
        return 'node ' + shlex.quote(remote + '/home-lab.js') + ' ' + ' '.join(shlex.quote(w) for w in words)

    def status():
        return json.loads(run(client, command('status')))

    def restore():
        nonlocal active
        if active:
            run(client, command('restore', active))
            state = status()
            if not state or state.get('id') != active or state.get('phase') != 'restored':
                raise RuntimeError('No se ha confirmado la restauracion de HOME')
            active = None

    try:
        run(client, 'node --version')
        run(client, 'command -v luna-send')
        sftp = client.open_sftp()
        baseline(sftp)
        if args.observe:
            with sftp.open('/sys/class/input/event1/device/name') as f:
                if f.read().decode().strip() != 'LGE RCU':
                    raise RuntimeError('La entrada del mando difiere de la observada; no se adivinara otro dispositivo.')
        app = json.loads(run(client, 'luna-send -n 1 -w 5000 luna://com.webos.applicationManager/getAppLoadStatus '
                                  + shlex.quote('{"appId":"com.cleanyourtv.webos4"}') + ' </dev/null'))
        if app.get('exist') is not True:
            raise RuntimeError('LG no confirma que CleanYourTV este instalada')
        if not yes('Desde LG, ¿funcionan ahora Live TV, HDMI 1 y HOME?'):
            return
        print('Se copiaran herramientas separadas en ' + remote)
        print('El observador se detendra en 120 s; HOME conserva su asignacion de LG.' if args.observe
              else 'HOME volvera a LG en 120 s, tambien si se desconecta el PC.')
        if input('Escribe PROBAR para autorizar esta prueba temporal: ').strip() != 'PROBAR':
            return
        helper(client, sftp)
        sftp.mkdir(remote, mode=0o700)
        for name in ('home-bind.js', 'home-lab.js', 'home-lab.sh'):
            content = (HERE / name).read_bytes().replace(b'\r\n', b'\n')
            with sftp.open(remote + '/' + name, 'wb') as f:
                f.write(content)
            sftp.chmod(remote + '/' + name, 0o600)
        # Parse with the TV's actual Node before allowing any binding mutation.
        run(client, 'node -e ' + shlex.quote('require(' + json.dumps(remote + '/home-lab.js') + ')'))
        for number, (variant, label) in enumerate(variants):
            if variant == 'public':
                try:
                    run(client, 'command -v luna-send-pub')
                except RuntimeError:
                    report['tests'].append({'variant': variant, 'skipped': 'luna-send-pub unavailable'})
                    save()
                    continue
            print('\nPrueba ' + str(number) + ': ' + label)
            print('Preparacion: Live TV o HDMI 1 desde LG. No pulses HOME hasta que diga LISTO.')
            if not yes('¿Empezar esta variante?'):
                break
            helper(client, sftp)
            active = str(int(time.time() * 1000)) + '-' + secrets.token_hex(4)
            result = {'variant': variant, 'id': active, 'restored': False,
                      'undo': command('restore', active)}
            report['tests'].append(result)
            save()
            run(client, 'nohup ' + command('run', variant, active) + ' </dev/null >>' + shlex.quote(remote + '/guardian.log') + ' 2>&1 &')
            deadline = time.monotonic() + 8
            while True:
                state = status()
                if state and state.get('id') == active and state.get('phase') == 'ready':
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError('La variante no ha quedado preparada. No pulses HOME.')
                time.sleep(0.5)
            print('LISTO. Pulsa HOME una vez. Tienes como maximo dos minutos.')
            print('Si abre CleanYourTV: prueba HOME otra vez, luego YouTube, HOME, Live TV e Input -> HDMI 1.')
            print('Si alguna fuente queda negra, escribe negro y para. No se enviaran nuevas aperturas.')
            result['observed'] = input('Resultado (bien / LG / nada / negro / otro; anade detalles): ').strip()[:1000]
            restore()
            result['restored'] = True
            result['status'] = status()
            save()
            print('Asignacion retirada. Pulsa HOME: debe salir LG (puede requerir una segunda pulsacion).')
            result['lg_restored'] = yes('¿Abre LG y siguen funcionando Live TV y HDMI 1?')
            save()
            if not result['lg_restored'] or 'negr' in result['observed'].lower():
                print('Prueba detenida. No se reiniciara la TV ni se probaran mas variantes.')
                break
            if variant == 'probe' and not result['status'].get('presses'):
                print('HOME no llego al script. Se detiene: probar otras aperturas no resolveria el remapeo.')
                break
            # Let the guardian and any previously sent ten-second Luna request settle.
            time.sleep(12)
        report['finished'] = True
    except BaseException as error:
        report['stopped'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        try:
            restore()
            if sftp:
                try:
                    with sftp.open(remote + '/events.jsonl') as f:
                        report['events'] = [json.loads(line) for line in f.read().decode().splitlines()]
                except OSError:
                    pass
        except Exception:
            report['recovery'] = 'No se pudo confirmar por SSH; esperar 120 s y comprobar HOME fisicamente.'
            print(report['recovery'])
        finally:
            if sftp:
                sftp.close()
            client.close()
            save()
            print('Informe local: ' + str(output))
            print('El helper se deja activo. No se ha configurado HOME permanente ni arranque.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nPrueba interrumpida. Espera hasta dos minutos y comprueba HOME de LG.')
        sys.exit(1)
    except Exception as error:
        print('Prueba detenida: ' + str(error), file=sys.stderr)
        sys.exit(1)
