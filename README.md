<div align="center">

# Clipglass

[![CI](https://github.com/kuronekorou39/clipglass/actions/workflows/ci.yml/badge.svg)](https://github.com/kuronekorou39/clipglass/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)](SPEC.md)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-FFC131?logo=tauri&logoColor=white)](https://v2.tauri.app/)

**コピーしたものが、いつも見える。半透明の小窓でクリップボードを確認する Windows アプリ**

![screenshot](assets/screenshot.png)

</div>

## インストール

[GitHub Releases](https://github.com/kuronekorou39/clipglass/releases) から最新の `Clipglass_x.y.z_x64-setup.exe` をダウンロードして実行してください。対応 OS は Windows 11 (x64) です。

## 主な機能

- クリップボードの最新 10 件を、常に手前の半透明ウィンドウに一覧表示
- 行をクリックすると再コピー。同じ内容は重複せず、先頭へ移動
- コピーに含まれる形式(テキスト / HTML / RTF / 画像 / ファイル)をバッジで表示
- 画像はプレビューし、元の寸法のまま PNG で保存
- 履歴はメモリー上だけに保持し、ディスクや外部には送らない

コピー内容は種類を問わずそのまま表示します。パスワードなども隠さないので、画面共有時は注意してください。

## 開発

```bash
npm install
npm run tauri dev           # 開発モードで起動
npm run tauri build         # インストーラーを作成
npm test                    # フロントエンドのテスト
cd src-tauri && cargo test  # Rust のテスト
```

前提: Node.js 22+、Rust (stable)。仕様は [SPEC.md](SPEC.md) を参照してください。

## リリース

1. `package.json` と `src-tauri/Cargo.toml` の `version` を上げる(修正のたびに必ず上げる)
2. `v` を付けた同じ番号のタグを push する(例: `v0.1.1`)
3. GitHub Actions がインストーラーをビルドし、ドラフトのリリースに添付する

## ライセンス

[MIT](LICENSE)
