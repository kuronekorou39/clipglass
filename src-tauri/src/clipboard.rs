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

unsafe fn read_text() -> Result<Option<String>, String> {
    let Some(bytes) = read_bytes(CF_UNICODETEXT, MAX_TEXT_BYTES)? else {
        return Ok(None);
    };
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .take_while(|unit| *unit != 0)
        .collect();
    Ok(Some(String::from_utf16_lossy(&units)))
}

/// 書式付きデータを読み取る。読めない形式や大きすぎる形式は黙って飛ばす。
unsafe fn read_rich(ids: &[u32], formats: &[String]) -> Vec<RichFormat> {
    let mut rich = Vec::new();
    for (id, name) in ids.iter().zip(formats) {
        if !RICH_FORMAT_NAMES.contains(&name.as_str()) {
            continue;
        }
        if let Ok(Some(data)) = read_bytes(*id, MAX_RICH_BYTES) {
            rich.push(RichFormat {
                name: name.clone(),
                data,
            });
        }
    }
    rich
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

unsafe fn read_once(owner: HWND) -> Result<(Vec<String>, Payload), String> {
    let _guard = OpenClipboardGuard::open(owner)?;
    let ids = enum_formats();
    let formats: Vec<String> = ids.iter().copied().map(format_name).collect();
    if ids.is_empty() {
        return Ok((formats, Payload::Empty));
    }

    // テキストがあればテキストを優先する(Excelのセル範囲など)。
    if ids.contains(&CF_UNICODETEXT) {
        match read_text()? {
            None => return Ok((formats, Payload::TooLarge)),
            Some(text) if !text.is_empty() => {
                // 大きなコピーでは書式付きデータを要求しない(コピー元を待たせないため)。
                let small =
                    text.encode_utf16().count() * UTF16_UNIT_BYTES <= RICH_CAPTURE_MAX_TEXT_BYTES;
                let rich = if small {
                    read_rich(&ids, &formats)
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
    let png = RegisterClipboardFormatW(w!("PNG"));
    let image_format = if ids.contains(&png) {
        Some(png)
    } else {
        ids.iter()
            .copied()
            .find(|id| *id == CF_DIB || *id == CF_DIBV5)
    };
    if let Some(format) = image_format {
        let payload = match read_bytes(format, MAX_IMAGE_BYTES)? {
            None => Payload::TooLarge,
            Some(bytes) if format == png => Payload::Image(RawImage::Png(bytes)),
            Some(bytes) => Payload::Image(RawImage::Dib(bytes)),
        };
        return Ok((formats, payload));
    }

    if ids.contains(&CF_HDROP) {
        return Ok((formats, Payload::Files(read_file_names()?)));
    }
    Ok((formats, Payload::Unsupported))
}

/// 現在の内容を読み取る。読み取り中に内容が変わった場合は取り直す。
pub fn read(owner: HWND) -> Result<Snapshot, String> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let sequence = unsafe { GetClipboardSequenceNumber() };
        let (formats, payload) = unsafe { read_once(owner)? };
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
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        assert_eq!(u32::from_le_bytes(bytes[..4].try_into().unwrap()), 20);
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 1);
        assert_eq!(String::from_utf16_lossy(&units), "C:\\a\0b\0\0");
    }

    /// 実際のクリップボードを書き換えるので、通常のテストでは実行しない。
    /// `cargo test -- --ignored` で実行する。終了時に元のテキストへ戻す。
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
