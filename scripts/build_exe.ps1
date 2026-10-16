# exe とインストーラーをビルドして、配布用の zip にまとめる。
#   .\scripts\build_exe.ps1
# 出力: release\Clipglass-<版>\(Clipglass.exe、LICENSE、README.md)、release\Clipglass-<版>-portable.zip、
#       release\Clipglass_<版>_x64-setup.exe
# 前提: Node.js 22+ と Rust (stable)。node_modules が無ければ npm ci を先に実行する。
$ErrorActionPreference = "Continue"  # npm と cargo は経過を標準エラーに出す。失敗は終了コードで見る
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 版は package.json と Cargo.toml の両方に書くので、食い違っていたら止める
$version = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$cargoVersion = (Select-String -Path src-tauri\Cargo.toml -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
if ($version -ne $cargoVersion) {
    throw "版が食い違っています: package.json $version / Cargo.toml $cargoVersion"
}

if (-not (Test-Path node_modules)) {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci に失敗しました" }
}

npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "ビルドに失敗しました" }

$target = Join-Path $root "src-tauri\target\release"
$installer = Join-Path $target "bundle\nsis\Clipglass_${version}_x64-setup.exe"
if (-not (Test-Path $installer)) { throw "インストーラーが見つかりません: $installer" }

$release = Join-Path $root "release"
$folder = Join-Path $release "Clipglass-$version"
$zip = Join-Path $release "Clipglass-$version-portable.zip"
# 前回の中身が混ざらないよう、同じ版のフォルダは作り直す
if (Test-Path $folder) { Remove-Item $folder -Recurse -Force }
New-Item -ItemType Directory -Force $folder | Out-Null

Copy-Item (Join-Path $target "clipglass.exe") (Join-Path $folder "Clipglass.exe")
Copy-Item LICENSE, README.md $folder
Copy-Item $installer $release
# 古い zip が残っていると Compress-Archive が追記してしまうので、作り直す
Compress-Archive -Path $folder -DestinationPath $zip -CompressionLevel Optimal -Force

$zipSize = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$setupSize = [math]::Round((Get-Item $installer).Length / 1MB, 1)
Write-Host ""
Write-Host "出力:         $folder"
Write-Host "zip:          $zip ($zipSize MB)"
Write-Host "インストーラー: $(Join-Path $release (Split-Path -Leaf $installer)) ($setupSize MB)"
