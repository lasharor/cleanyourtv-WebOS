# Builds the CleanYourTV phone remote app (Android) into helper/addons-bundled/phoneremote/tv-remote.apk, with the Android SDK's own tools: no Gradle, no
# libraries, nothing downloaded. Run it from anywhere:
#   powershell -ExecutionPolicy Bypass -File mobile\android\build.ps1
# It needs Java 8 or newer (javac, keytool) and the Android SDK (ANDROID_HOME, or the usual place on Windows and macOS).
# The app is a shell around the TV's own phone remote page: see mobile/README.md.
param(
  [string]$Sdk = '',
  [string]$JavaHome = '',
  # the SDK parts the shipped app is built with: the same ones every time, not "the newest installed" (platform 34 is the app's target SDK)
  [string]$BuildTools = '34.0.0',
  [string]$Platform = 'android-34'
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
$out = Join-Path $here 'build'
# the phone remote add-on's folder: the TV serves the app from there and the release ships it, so the app that is committed is the app the QR code points at
$appDir = Join-Path $repo 'helper\addons-bundled\phoneremote'
$apk = Join-Path $appDir 'tv-remote.apk'

# ---- the tools ----
if (-not $Sdk) { $Sdk = $env:ANDROID_HOME; if (-not $Sdk) { $Sdk = $env:ANDROID_SDK_ROOT } }
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $Sdk)) { throw "Android SDK not found: pass -Sdk <path> or set ANDROID_HOME" }
$bt = Get-Item (Join-Path $Sdk "build-tools\$BuildTools") -ErrorAction SilentlyContinue
$plat = Get-Item (Join-Path $Sdk "platforms\$Platform") -ErrorAction SilentlyContinue
if (-not $bt) { throw "build-tools $BuildTools not found in $Sdk (install it with the SDK manager, or pass -BuildTools)" }
if (-not $plat) { throw "platform $Platform not found in $Sdk (install it with the SDK manager, or pass -Platform)" }
$androidJar = Join-Path $plat.FullName 'android.jar'
$aapt2 = Join-Path $bt.FullName 'aapt2.exe'
$zipalign = Join-Path $bt.FullName 'zipalign.exe'
$apksigner = Join-Path $bt.FullName 'apksigner.bat'
$d8 = Join-Path $bt.FullName 'd8.bat'
foreach ($t in $aapt2, $zipalign, $apksigner, $d8, $androidJar) { if (-not (Test-Path $t)) { throw "missing: $t" } }
if ($JavaHome) { $env:JAVA_HOME = $JavaHome }
if (-not (Get-Command javac -ErrorAction SilentlyContinue)) {
  $jdk = Get-ChildItem 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue | Select-Object -Last 1
  if (-not $jdk) { throw 'javac not found: install a JDK (or pass -JavaHome)' }
  $env:JAVA_HOME = $jdk.FullName
  $env:PATH = (Join-Path $jdk.FullName 'bin') + ';' + $env:PATH
}
# the java on PATH can be a shim folder without keytool in it: find the JDK that has both
$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool -or -not (Test-Path $keytool)) {
  $dirs = @()
  if ($env:JAVA_HOME) { $dirs += $env:JAVA_HOME }
  $dirs += Get-ChildItem 'C:\Program Files\Java' -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
  foreach ($d in $dirs) {
    $k = Join-Path $d 'bin\keytool.exe'
    if (Test-Path $k) { $keytool = $k; break }
  }
}
if (-not $keytool) { throw 'keytool not found: install a JDK (or pass -JavaHome)' }
Write-Host "SDK        $Sdk"
Write-Host "build-tools $($bt.Name), platform $($plat.Name)"

# ---- a clean folder ----
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
foreach ($d in 'assets', 'classes', 'dex') { New-Item -ItemType Directory -Path (Join-Path $out $d) | Out-Null }
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $repo 'mobile\web\start.html') (Join-Path $out 'assets\start.html')
Copy-Item (Join-Path $repo 'mobile\web\off.html') (Join-Path $out 'assets\off.html')
Write-Host 'start and off pages copied into the assets'

# ---- 1. resources and the package: the icon (a vector), the manifest and the assets ----
& $aapt2 compile --dir (Join-Path $here 'res') -o (Join-Path $out 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }
& $aapt2 link -o (Join-Path $out 'base.apk') -I $androidJar --manifest (Join-Path $here 'AndroidManifest.xml') `
  -A (Join-Path $out 'assets') `
  --min-sdk-version 21 --target-sdk-version 34 --version-code 1 --version-name 1.0.0 `
  (Join-Path $out 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

# ---- 2. compile, then 3. dex ----
$sources = Get-ChildItem (Join-Path $here 'java') -Filter *.java -Recurse | Select-Object -ExpandProperty FullName
& javac -nowarn -source 8 -target 8 -classpath $androidJar -d (Join-Path $out 'classes') @sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
$classes = Get-ChildItem (Join-Path $out 'classes') -Filter *.class -Recurse | Select-Object -ExpandProperty FullName
& $d8 --lib $androidJar --min-api 21 --release --output (Join-Path $out 'dex') @classes
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

# ---- 4. the dex goes inside the package (aapt2 does not know about it) ----
$py = @'
import sys, zipfile, shutil
base, dex, out = sys.argv[1], sys.argv[2], sys.argv[3]
shutil.copyfile(base, out)
with zipfile.ZipFile(out, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
print('classes.dex added')
'@
$pyFile = Join-Path $out 'adddex.py'
Set-Content -Path $pyFile -Value $py -Encoding ASCII
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw 'python is needed to add classes.dex to the package (or install it from python.org)' }
& $python $pyFile (Join-Path $out 'base.apk') (Join-Path $out 'dex\classes.dex') (Join-Path $out 'unaligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'adding classes.dex failed' }

# ---- 5. align, then sign with a local key: the key lives outside build\, which every run wipes ----
& $zipalign -f 4 (Join-Path $out 'unaligned.apk') (Join-Path $out 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }
$ks = Join-Path $here 'build-keystore\debug.keystore'
if (-not (Test-Path $ks)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ks) | Out-Null
  & $keytool -genkeypair -keystore $ks -alias androiddebugkey -storepass android -keypass android `
    -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}
& $apksigner sign --ks $ks --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --v4-signing-enabled false `
  --out $apk (Join-Path $out 'aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }
$verify = & $apksigner verify --verbose $apk
if ($LASTEXITCODE -ne 0) { throw 'the package did not verify' }
$verify | Select-Object -First 3 | Write-Host

$size = [math]::Round((Get-Item $apk).Length / 1KB)
$sha = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLower()
Write-Host ''
Write-Host "APK  $apk  ($size KB)" -ForegroundColor Green
Write-Host "SHA-256  $sha"
Write-Host 'Put that SHA-256 in mobile/README.md (the test compares it with the file).'
