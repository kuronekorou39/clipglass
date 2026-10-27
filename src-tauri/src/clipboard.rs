//! Windowsのクリップボードの読み取りと書き戻し。

use std::thread;
use std::time::Duration;

use windows::core::{w, HSTRING};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
    GetClipboardFormatNameW, GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW,
    SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

use crate::history::RichFormat;
use crate::imaging::RawImage;
use crate::limits::{
    MAX_IMAGE_PIXELS, MAX_RICH_BYTES, MAX_TEXT_BYTES, OPEN_RETRY_COUNT, OPEN_RETRY_INTERVAL_MS,
    READ_RETRY_COUNT, RICH_CAPTURE_MAX_TEXT_BYTES,
};

const CF_DIB: u32 = 8;
const CF_UNICODETEXT: u32 = 13;
const CF_HDROP: u32 = 15;
const CF_DIBV5: u32 = 17;

/// 定義済み形式には名前を取得するAPIがないので、定数名を表示に使う。
const PREDEFINED_FORMATS: &[(u32, &str)] = &[
    (1, "CF_TEXT"),
    (2, "CF_BITMAP"),
    (3, "CF_METAFILEPICT"),
    (4, "CF_SYLK"),
    (5, "CF_DIF"),
    (6, "CF_TIFF"),
    (7, "CF_OEMTEXT"),
    (CF_DIB, "CF_DIB"),
    (9, "CF_PALETTE"),
    (10, "CF_PENDATA"),
    (11, "CF_RIFF"),
    (12, "CF_WAVE"),
    (CF_UNICODETEXT, "CF_UNICODETEXT"),
    (14, "CF_ENHMETAFILE"),
    (CF_HDROP, "CF_HDROP"),
    (16, "CF_LOCALE"),
    (CF_DIBV5, "CF_DIBV5"),
    (0x80, "CF_OWNERDISPLAY"),
    (0x81, "CF_DSPTEXT"),
    (0x82, "CF_DSPBITMAP"),
    (0x83, "CF_DSPMETAFILEPICT"),
    (0x8E, "CF_DSPENHMETAFILE"),
];

/// テキストと一緒に保存し、再コピーで復元する書式付き形式。
const RICH_FORMAT_NAMES: &[&str] = &["HTML Format", "Rich Text Format"];
const UTF16_UNIT_BYTES: usize = 2;

/// 画像1件として受け入れるデータの最大バイト数。
const MAX_IMAGE_BYTES: usize = MAX_IMAGE_PIXELS as usize * 4 + 1024 * 1024;

pub enum Payload {
    Empty,
    Text { text: String, rich: Vec<RichFormat> },
    Image(RawImage),
    Files(Vec<String>),
    Unsupported,
    TooLarge,
}

pub struct Snapshot {
    /// 読み取った時点のシーケンス番号。
    pub sequence: u32,
    /// クリップボードが報告した形式名。コピー元が置いた順に並ぶ。
    pub formats: Vec<String>,
    pub payload: Payload,
}

struct OpenClipboardGuard;

impl OpenClipboardGuard {
    fn open(owner: HWND) -> Result<Self, String> {
        let mut last_error = String::new();
        for attempt in 0..OPEN_RETRY_COUNT {
            if attempt > 0 {
                thread::sleep(Duration::from_millis(OPEN_RETRY_INTERVAL_MS));
            }
            match unsafe { OpenClipboard(Some(owner)) } {
                Ok(()) => return Ok(Self),
                Err(e) => last_error = e.message(),
            }
        }
        Err(format!("クリップボードを開けませんでした: {last_error}"))
    }
}

impl Drop for OpenClipboardGuard {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

fn format_name(format: u32) -> String {
    if let Some((_, name)) = PREDEFINED_FORMATS.iter().find(|(id, _)| *id == format) {
        return (*name).to_string();
    }
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClipboardFormatNameW(format, &mut buffer) };
    if length > 0 {
        String::from_utf16_lossy(&buffer[..length as usize])
    } else {
        format!("0x{format:04X}")
    }
}

/// クリップボードを開いている間だけ有効。
unsafe fn enum_formats() -> Vec<u32> {
    let mut formats = Vec::new();
    let mut format = EnumClipboardFormats(0);
    while format != 0 {
        formats.push(format);
        format = EnumClipboardFormats(format);
    }
    formats
}

/// 指定形式のデータをコピーして返す。`limit` を超える場合は `None`。
unsafe fn read_bytes(format: u32, limit: usize) -> Result<Option<Vec<u8>>, String> {
    let handle = GetClipboardData(format).map_err(|e| e.message())?;
    let global = HGLOBAL(handle.0);
    let size = GlobalSize(global);
    if size > limit {
        return Ok(None);
    }
    let pointer = GlobalLock(global) as *const u8;
    if pointer.is_null() {
        return Err("クリップボードのデータを参照できませんでした".into());
    }
    let bytes = std::slice::from_raw_parts(pointer, size).to_vec();
    let _ = GlobalUnlock(global);
    Ok(Some(bytes))
}

/// クリップボードの生データの読み取り口。実機は `WinClipboard`、テストは差し替える。
/// どのメソッドも、クリップボードが開かれている間に呼ぶ前提。
pub trait ClipboardSource {
    /// 利用できる形式のID(コピー元が置いた順)。
    fn formats(&self) -> Vec<u32>;
    /// 形式IDの表示名。
    fn format_name(&self, id: u32) -> String;
    /// 登録形式(例: "PNG")のID。
    fn registered_format(&self, name: &str) -> u32;
    /// 指定形式のデータ。`limit` を超える場合は `None`。
    fn read(&self, id: u32, limit: usize) -> Result<Option<Vec<u8>>, String>;
    /// CF_HDROP のファイル名の並び。
    fn file_names(&self) -> Result<Vec<String>, String>;
}

/// UTF-16のバイト列を、最初のヌル文字までの文字列にする。
fn decode_text_bytes(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .take_while(|unit| *unit != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

/// テキストと一緒に保存する書式付き形式かどうか。
fn is_rich_format(name: &str) -> bool {
    RICH_FORMAT_NAMES.contains(&name)
}

/// 書式付きデータを要求してよい大きさか。大きいコピーでは要求せず、コピー元を待たせない。
fn wants_rich(text: &str) -> bool {
    text.encode_utf16().count() * UTF16_UNIT_BYTES <= RICH_CAPTURE_MAX_TEXT_BYTES
}

fn read_text(src: &impl ClipboardSource) -> Result<Option<String>, String> {
    Ok(src
        .read(CF_UNICODETEXT, MAX_TEXT_BYTES)?
        .map(|bytes| decode_text_bytes(&bytes)))
}

/// 書式付きデータを読み取る。読めない形式や大きすぎる形式は黙って飛ばす。
fn read_rich(src: &impl ClipboardSource, ids: &[u32], formats: &[String]) -> Vec<RichFormat> {
    let mut rich = Vec::new();
    for (id, name) in ids.iter().zip(formats) {
        if !is_rich_format(name) {
            continue;
        }
        if let Ok(Some(data)) = src.read(*id, MAX_RICH_BYTES) {
            rich.push(RichFormat {
                name: name.clone(),
                data,
            });
        }
    }
    rich
}

/// 利用できる形式から、読み取るペイロードを決める。OSに触れない純粋な判定。
fn read_payload(src: &impl ClipboardSource) -> Result<(Vec<String>, Payload), String> {
    let ids = src.formats();
    let formats: Vec<String> = ids.iter().map(|&id| src.format_name(id)).collect();
    if ids.is_empty() {
        return Ok((formats, Payload::Empty));
    }

    // テキストがあればテキストを優先する(Excelのセル範囲など)。
    if ids.contains(&CF_UNICODETEXT) {
        match read_text(src)? {
            None => return Ok((formats, Payload::TooLarge)),
            Some(text) if !text.is_empty() => {
                let rich = if wants_rich(&text) {
                    read_rich(src, &ids, &formats)
                } else {
                    Vec::new()
                };
                return Ok((formats, Payload::Text { text, rich }));
            }
            Some(_) => {}
        }
    }

    // DIBとDIBV5は一方からもう一方が自動合成される。合成された側は
    // アルファ値が信用できないので、コピー元が先に置いた方を読む。
    let png = src.registered_format("PNG");
    let image_format = if ids.contains(&png) {
        Some(png)
    } else {
        ids.iter()
            .copied()
            .find(|id| *id == CF_DIB || *id == CF_DIBV5)
    };
    if let Some(format) = image_format {
        let payload = match src.read(format, MAX_IMAGE_BYTES)? {
            None => Payload::TooLarge,
            Some(bytes) if format == png => Payload::Image(RawImage::Png(bytes)),
            Some(bytes) => Payload::Image(RawImage::Dib(bytes)),
        };
        return Ok((formats, payload));
    }

    if ids.contains(&CF_HDROP) {
        return Ok((formats, Payload::Files(src.file_names()?)));
    }
    Ok((formats, Payload::Unsupported))
}

unsafe fn read_file_names() -> Result<Vec<String>, String> {
    const QUERY_COUNT: u32 = u32::MAX;
    let handle = GetClipboardData(CF_HDROP).map_err(|e| e.message())?;
    let drop = HDROP(handle.0);
    let count = DragQueryFileW(drop, QUERY_COUNT, None);
    let mut names = Vec::with_capacity(count as usize);
    for index in 0..count {
        let length = DragQueryFileW(drop, index, None) as usize;
        let mut buffer = vec![0u16; length + 1];
        let written = DragQueryFileW(drop, index, Some(&mut buffer)) as usize;
        names.push(String::from_utf16_lossy(&buffer[..written]));
    }
    Ok(names)
}

/// 実機のクリップボード。`read_once` が `OpenClipboardGuard` を保持している間だけ使う。
struct WinClipboard;

impl ClipboardSource for WinClipboard {
    fn formats(&self) -> Vec<u32> {
        unsafe { enum_formats() }
    }
    fn format_name(&self, id: u32) -> String {
        format_name(id)
    }
    fn registered_format(&self, name: &str) -> u32 {
        unsafe { RegisterClipboardFormatW(&HSTRING::from(name)) }
    }
    fn read(&self, id: u32, limit: usize) -> Result<Option<Vec<u8>>, String> {
        unsafe { read_bytes(id, limit) }
    }
    fn file_names(&self) -> Result<Vec<String>, String> {
        unsafe { read_file_names() }
    }
}

fn read_once(owner: HWND) -> Result<(Vec<String>, Payload), String> {
    let _guard = OpenClipboardGuard::open(owner)?;
    read_payload(&WinClipboard)
}

/// 現在の内容を読み取る。読み取り中に内容が変わった場合は取り直す。
pub fn read(owner: HWND) -> Result<Snapshot, String> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let sequence = unsafe { GetClipboardSequenceNumber() };
        let (formats, payload) = read_once(owner)?;
        let unchanged = unsafe { GetClipboardSequenceNumber() } == sequence;
        if unchanged || attempt >= READ_RETRY_COUNT {
            return Ok(Snapshot {
                sequence,
                formats,
                payload,
            });
        }
    }
}

/// データをグローバルメモリーへ移してクリップボードに渡す。
unsafe fn set_data(format: u32, bytes: &[u8]) -> Result<(), String> {
    let global = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| e.message())?;
    let pointer = GlobalLock(global) as *mut u8;
    if pointer.is_null() {
        let _ = GlobalFree(Some(global));
        return Err("メモリーを確保できませんでした".into());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer, bytes.len());
    let _ = GlobalUnlock(global);
    // 成功するとメモリーの所有権はシステムへ移る。
    if let Err(e) = SetClipboardData(format, Some(HANDLE(global.0))) {
        let _ = GlobalFree(Some(global));
        return Err(e.message());
    }
    Ok(())
}

/// CF_UNICODETEXT の中身。UTF-16LE に終端の0を付けたもの。
fn utf16_with_terminator(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

/// テキストを置く。`rich` があれば、保存してあった書式付きデータも一緒に置く。
pub fn write_text(owner: HWND, text: &str, rich: &[RichFormat]) -> Result<(), String> {
    let bytes = utf16_with_terminator(text);
    unsafe {
        let _guard = OpenClipboardGuard::open(owner)?;
        EmptyClipboard().map_err(|e| e.message())?;
        for format in rich {
            let id = RegisterClipboardFormatW(&HSTRING::from(format.name.as_str()));
            set_data(id, &format.data)?;
        }
        set_data(CF_UNICODETEXT, &bytes)
    }
}

/// DROPFILES構造体と、それに続くファイル名の並び(CF_HDROPの中身)を作る。
fn build_drop_files(paths: &[String]) -> Vec<u8> {
    const HEADER_SIZE: u32 = 20;
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&HEADER_SIZE.to_le_bytes()); // pFiles: 名前の並びの開始位置
    bytes.extend_from_slice(&[0u8; 12]); // pt と fNC は使わない
    bytes.extend_from_slice(&1u32.to_le_bytes()); // fWide: 名前はUTF-16
    for path in paths {
        bytes.extend(path.encode_utf16().chain([0]).flat_map(u16::to_le_bytes));
    }
    bytes.extend_from_slice(&0u16.to_le_bytes()); // 並びの終端
    bytes
}

/// ファイルのコピーとして置く。エクスプローラーへ貼り付けると複製になる。
pub fn write_files(owner: HWND, paths: &[String]) -> Result<(), String> {
    const DROPEFFECT_COPY: u32 = 1;
    unsafe {
        let _guard = OpenClipboardGuard::open(owner)?;
        EmptyClipboard().map_err(|e| e.message())?;
        set_data(CF_HDROP, &build_drop_files(paths))?;
        set_data(
            RegisterClipboardFormatW(w!("Preferred DropEffect")),
            &DROPEFFECT_COPY.to_le_bytes(),
        )
    }
}

/// PNGに対応しないアプリでも貼り付けられるよう、DIBも一緒に置く。
pub fn write_image(owner: HWND, png: &[u8], dib: &[u8]) -> Result<(), String> {
    unsafe {
        let _guard = OpenClipboardGuard::open(owner)?;
        EmptyClipboard().map_err(|e| e.message())?;
        set_data(RegisterClipboardFormatW(w!("PNG")), png)?;
        set_data(CF_DIB, dib)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unicode_text_is_encoded_with_surrogates_and_terminator() {
        let bytes = utf16_with_terminator("aé😀");
        assert_eq!(
            bytes,
            [0x61, 0x00, 0xE9, 0x00, 0x3D, 0xD8, 0x00, 0xDE, 0x00, 0x00]
        );
        assert_eq!(utf16_with_terminator(""), [0, 0]);
    }

    #[test]
    fn predefined_format_ids_are_unique_and_named() {
        for (i, (id, _)) in PREDEFINED_FORMATS.iter().enumerate() {
            assert!(
                !PREDEFINED_FORMATS[..i].iter().any(|(other, _)| other == id),
                "0x{id:X} が重複しています"
            );
        }
        assert_eq!(format_name(CF_UNICODETEXT), "CF_UNICODETEXT");
        assert_eq!(format_name(CF_HDROP), "CF_HDROP");
        // 登録されていない番号は16進で示す
        assert_eq!(format_name(0xFFFE), "0xFFFE");
    }

    #[test]
    fn drop_files_layout() {
        let bytes = build_drop_files(&["C:\\a".to_string(), "b".to_string()]);
        let units: Vec<u16> = bytes[20..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        assert_eq!(u32::from_le_bytes(bytes[..4].try_into().unwrap()), 20);
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 1);
        assert_eq!(String::from_utf16_lossy(&units), "C:\\a\0b\0\0");
    }

    /// 実際のクリップボードを書き換えるので、通常のテストでは実行しない。
    /// `cargo test -- --ignored` で実行する。終了時に元のテキストへ戻す。
    #[test]
    fn drop_files_layout_handles_network_paths() {
        let bytes = build_drop_files(&[
            "\\\\srv\\共有\\a.txt".to_string(),
            "\\\\srv\\共有\\b.txt".to_string(),
        ]);
        let units: Vec<u16> = bytes[20..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u16::from_le_bytes(*pair))
            .collect();
        assert_eq!(
            String::from_utf16_lossy(&units),
            "\\\\srv\\共有\\a.txt\0\\\\srv\\共有\\b.txt\0\0"
        );
    }

    use std::collections::HashMap;

    const PNG_ID: u32 = 49_999;
    const HTML_ID: u32 = 49_001;

    /// テスト用のクリップボード。形式とデータを持ち、OSには触れない。
    struct Fake {
        ids: Vec<u32>,
        names: HashMap<u32, String>,
        data: HashMap<u32, Option<Vec<u8>>>,
        files: Vec<String>,
    }

    impl Fake {
        fn new(ids: &[u32]) -> Self {
            Fake {
                ids: ids.to_vec(),
                names: HashMap::new(),
                data: HashMap::new(),
                files: Vec::new(),
            }
        }
        fn name(mut self, id: u32, name: &str) -> Self {
            self.names.insert(id, name.to_string());
            self
        }
        /// None は「上限を超えて読めない」を表す。
        fn bytes(mut self, id: u32, data: Option<&[u8]>) -> Self {
            self.data.insert(id, data.map(|d| d.to_vec()));
            self
        }
        fn with_files(mut self, files: &[&str]) -> Self {
            self.files = files.iter().map(|f| f.to_string()).collect();
            self
        }
    }

    impl ClipboardSource for Fake {
        fn formats(&self) -> Vec<u32> {
            self.ids.clone()
        }
        fn format_name(&self, id: u32) -> String {
            self.names
                .get(&id)
                .cloned()
                .unwrap_or_else(|| format!("0x{id:04X}"))
        }
        fn registered_format(&self, name: &str) -> u32 {
            if name == "PNG" {
                PNG_ID
            } else {
                0
            }
        }
        fn read(&self, id: u32, _limit: usize) -> Result<Option<Vec<u8>>, String> {
            Ok(self.data.get(&id).cloned().unwrap_or(None))
        }
        fn file_names(&self) -> Result<Vec<String>, String> {
            Ok(self.files.clone())
        }
    }

    fn utf16(text: &str) -> Vec<u8> {
        text.encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect()
    }

    #[test]
    fn no_formats_is_empty() {
        let (_, payload) = read_payload(&Fake::new(&[])).unwrap();
        assert!(matches!(payload, Payload::Empty));
    }

    #[test]
    fn text_is_preferred_and_small_text_keeps_rich() {
        let fake = Fake::new(&[CF_UNICODETEXT, HTML_ID, CF_DIB])
            .name(HTML_ID, "HTML Format")
            .bytes(CF_UNICODETEXT, Some(&utf16("こんにちは")))
            .bytes(HTML_ID, Some(b"<b>hi</b>"))
            .bytes(CF_DIB, Some(&[0u8; 60]));
        let (_, payload) = read_payload(&fake).unwrap();
        match payload {
            Payload::Text { text, rich } => {
                assert_eq!(text, "こんにちは");
                assert_eq!(rich.len(), 1);
                assert_eq!(rich[0].name, "HTML Format");
            }
            _ => panic!("テキストにならなかった"),
        }
    }

    #[test]
    fn large_text_skips_rich() {
        let big = "a".repeat(RICH_CAPTURE_MAX_TEXT_BYTES / UTF16_UNIT_BYTES + 1);
        let fake = Fake::new(&[CF_UNICODETEXT, HTML_ID])
            .name(HTML_ID, "HTML Format")
            .bytes(CF_UNICODETEXT, Some(&utf16(&big)))
            .bytes(HTML_ID, Some(b"<b>hi</b>"));
        let (_, payload) = read_payload(&fake).unwrap();
        match payload {
            Payload::Text { text, rich } => {
                assert_eq!(text.len(), big.len());
                assert!(rich.is_empty());
            }
            _ => panic!("テキストにならなかった"),
        }
    }

    #[test]
    fn text_over_limit_is_too_large() {
        let fake = Fake::new(&[CF_UNICODETEXT]).bytes(CF_UNICODETEXT, None);
        let (_, payload) = read_payload(&fake).unwrap();
        assert!(matches!(payload, Payload::TooLarge));
    }

    #[test]
    fn empty_text_falls_through_to_unsupported() {
        // 文字が空のときは画像やファイルを探し、どれも無ければ対象外にする
        let fake = Fake::new(&[CF_UNICODETEXT]).bytes(CF_UNICODETEXT, Some(&utf16("")));
        let (_, payload) = read_payload(&fake).unwrap();
        assert!(matches!(payload, Payload::Unsupported));
    }

    #[test]
    fn png_is_preferred_over_dib() {
        let fake = Fake::new(&[CF_DIB, PNG_ID])
            .bytes(PNG_ID, Some(&[1, 2, 3]))
            .bytes(CF_DIB, Some(&[9, 9]));
        let (_, payload) = read_payload(&fake).unwrap();
        assert!(matches!(payload, Payload::Image(RawImage::Png(b)) if b == [1, 2, 3]));
    }

    #[test]
    fn first_of_dib_and_dibv5_is_read_when_no_png() {
        // コピー元が先に置いた方(ここではDIBV5)を読む
        let fake = Fake::new(&[CF_DIBV5, CF_DIB])
            .bytes(CF_DIBV5, Some(&[5]))
            .bytes(CF_DIB, Some(&[8]));
        let (_, payload) = read_payload(&fake).unwrap();
        assert!(matches!(payload, Payload::Image(RawImage::Dib(b)) if b == [5]));
    }

    #[test]
    fn image_over_limit_is_too_large() {
        let fake = Fake::new(&[PNG_ID]).bytes(PNG_ID, None);
        let (_, payload) = read_payload(&fake).unwrap();
        assert!(matches!(payload, Payload::TooLarge));
    }

    #[test]
    fn hdrop_becomes_files() {
        let fake = Fake::new(&[CF_HDROP]).with_files(&["C:\\a.txt", "C:\\b.txt"]);
        let (_, payload) = read_payload(&fake).unwrap();
        assert!(matches!(payload, Payload::Files(f) if f.len() == 2));
    }

    #[test]
    fn unknown_format_is_unsupported() {
        let fake = Fake::new(&[0x4242]).name(0x4242, "Something");
        let (formats, payload) = read_payload(&fake).unwrap();
        assert_eq!(formats, ["Something"]);
        assert!(matches!(payload, Payload::Unsupported));
    }

    #[test]
    #[ignore]
    fn roundtrip_through_real_clipboard() {
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
        };
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!("clipglass-test"),
                WINDOW_STYLE::default(),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
            .unwrap()
        };
        let original = read(hwnd).unwrap().payload;

        let html = RichFormat {
            name: "HTML Format".to_string(),
            data: b"Version:0.9\r\n<b>clipglass</b>".to_vec(),
        };
        write_text(hwnd, "clipglass 書式テスト", std::slice::from_ref(&html)).unwrap();
        let snapshot = read(hwnd).unwrap();
        let Payload::Text { text, rich } = snapshot.payload else {
            panic!("テキストとして読めませんでした");
        };
        assert_eq!(text, "clipglass 書式テスト");
        assert_eq!(rich.len(), 1);
        assert_eq!(rich[0].name, html.name);
        assert_eq!(rich[0].data, html.data);
        assert!(snapshot.formats.contains(&html.name));

        write_text(hwnd, "clipglass 書式テスト", &[]).unwrap();
        let Payload::Text { rich, .. } = read(hwnd).unwrap().payload else {
            panic!("テキストとして読めませんでした");
        };
        assert!(rich.is_empty());

        let paths = vec![std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned()];
        write_files(hwnd, &paths).unwrap();
        let Payload::Files(read_back) = read(hwnd).unwrap().payload else {
            panic!("ファイルとして読めませんでした");
        };
        assert_eq!(read_back, paths);

        if let Payload::Text { text, rich } = original {
            write_text(hwnd, &text, &rich).unwrap();
        }
        unsafe { DestroyWindow(hwnd).unwrap() };
    }
}
