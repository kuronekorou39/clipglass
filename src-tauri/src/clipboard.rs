//! Windowsのクリップボードの読み取りと書き戻し。

use std::thread;
use std::time::Duration;

use windows::core::w;
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

use crate::imaging::RawImage;
use crate::limits::{
    MAX_IMAGE_PIXELS, MAX_TEXT_BYTES, OPEN_RETRY_COUNT, OPEN_RETRY_INTERVAL_MS, READ_RETRY_COUNT,
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

/// 画像1件として受け入れるデータの最大バイト数。
const MAX_IMAGE_BYTES: usize = MAX_IMAGE_PIXELS as usize * 4 + 1024 * 1024;

pub enum Payload {
    Empty,
    Text(String),
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
    let formats = ids.iter().copied().map(format_name).collect();
    if ids.is_empty() {
        return Ok((formats, Payload::Empty));
    }

    // テキストがあればテキストを優先する(Excelのセル範囲など)。
    if ids.contains(&CF_UNICODETEXT) {
        match read_text()? {
            None => return Ok((formats, Payload::TooLarge)),
            Some(text) if !text.is_empty() => return Ok((formats, Payload::Text(text))),
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

pub fn write_text(owner: HWND, text: &str) -> Result<(), String> {
    let bytes: Vec<u8> = text
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    unsafe {
        let _guard = OpenClipboardGuard::open(owner)?;
        EmptyClipboard().map_err(|e| e.message())?;
        set_data(CF_UNICODETEXT, &bytes)
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
