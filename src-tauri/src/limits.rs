//! 実装上の上限値と調整値。

/// 履歴に保持する項目数の初期値。固定した項目は数えない。
pub const DEFAULT_HISTORY_MAX_ITEMS: usize = 10;
/// 設定で選べる履歴の件数の上限。
pub const HISTORY_MAX_ITEMS_LIMIT: usize = 200;
/// 取り込む画像の最大画素数(32メガピクセル)。
pub const MAX_IMAGE_PIXELS: u64 = 32_000_000;
/// 取り込むテキストの最大サイズ(UTF-16でのバイト数)。
pub const MAX_TEXT_BYTES: usize = 5 * 1024 * 1024;
/// 書式付きデータ(HTML・RTF)も読み取るテキストの最大サイズ(UTF-16でのバイト数)。
/// 書式付きデータはコピー元がその場で生成することがあり、大きな範囲では
/// コピー元を待たせる。これを超えるコピーは文字だけを保存する。
pub const RICH_CAPTURE_MAX_TEXT_BYTES: usize = 256 * 1024;
/// 保存する書式付きデータの、1形式あたりの最大サイズ。
pub const MAX_RICH_BYTES: usize = 5 * 1024 * 1024;
/// UIへ渡すテキストの最大文字数。超えた分は省略として示す。
pub const TEXT_PREVIEW_CHARS: usize = 20_000;
/// 一覧に出すサムネイルの長辺(ピクセル)。
pub const THUMBNAIL_MAX_EDGE: u32 = 160;

/// 他のプロセスがクリップボードを使用中のときの再試行。
pub const OPEN_RETRY_COUNT: u32 = 10;
pub const OPEN_RETRY_INTERVAL_MS: u64 = 20;
/// 読み取り中に内容が変わった場合の取り直し回数。
pub const READ_RETRY_COUNT: u32 = 3;

/// 変更通知から読み取りまでの待ち時間。コピー元がデータを置き終える前に
/// クリップボードを開くと、コピー元の処理を失敗させることがある。
pub const CLIPBOARD_SETTLE_DELAY_MS: u32 = 50;

/// 操作不能にならないための不透明度の下限。
pub const MIN_WINDOW_OPACITY: f64 = 0.2;
