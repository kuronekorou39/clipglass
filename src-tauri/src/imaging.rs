//! クリップボード画像のデコード、PNG化、サムネイル、DIB変換。

use std::hash::Hasher;
use std::io::Cursor;

use image::codecs::bmp::BmpDecoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ExtendedColorType, ImageEncoder, ImageFormat, ImageReader, RgbaImage};

use crate::limits::{MAX_IMAGE_PIXELS, THUMBNAIL_MAX_EDGE};

/// クリップボードから取り出したままの画像データ。
pub enum RawImage {
    Png(Vec<u8>),
    /// ファイルヘッダーのないDIB(CF_DIB / CF_DIBV5)。
    Dib(Vec<u8>),
}

#[derive(Debug)]
pub enum DecodeError {
    TooLarge,
    Invalid(String),
}

const DIB_HEADER_SIZE: usize = 40;
const BYTES_PER_PIXEL: usize = 4;

fn invalid(e: image::ImageError) -> DecodeError {
    DecodeError::Invalid(e.to_string())
}

fn check_size(width: u32, height: u32) -> Result<(), DecodeError> {
    if u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(DecodeError::TooLarge);
    }
    Ok(())
}

fn dib_dimensions(dib: &[u8]) -> Option<(u32, u32)> {
    let width = i32::from_le_bytes(dib.get(4..8)?.try_into().ok()?);
    let height = i32::from_le_bytes(dib.get(8..12)?.try_into().ok()?);
    Some((width.unsigned_abs(), height.unsigned_abs()))
}

/// 32bitのDIBはアルファ値を使っていないのに0で埋めてあることが多い。
/// すべて0なら不透明な画像として扱う。
fn make_opaque_if_alpha_unused(image: &mut RgbaImage) {
    if image.pixels().all(|p| p.0[3] == 0) {
        for pixel in image.pixels_mut() {
            pixel.0[3] = u8::MAX;
        }
    }
}

/// 寸法の上限を確認してからRGBAへデコードする。
pub fn decode(raw: &RawImage) -> Result<RgbaImage, DecodeError> {
    match raw {
        RawImage::Png(bytes) => {
            let (width, height) = ImageReader::with_format(Cursor::new(bytes), ImageFormat::Png)
                .into_dimensions()
                .map_err(invalid)?;
            check_size(width, height)?;
            let image =
                image::load_from_memory_with_format(bytes, ImageFormat::Png).map_err(invalid)?;
            Ok(image.into_rgba8())
        }
        RawImage::Dib(bytes) => {
            let (width, height) = dib_dimensions(bytes)
                .ok_or_else(|| DecodeError::Invalid("DIBヘッダーが不正です".into()))?;
            check_size(width, height)?;
            let decoder =
                BmpDecoder::new_without_file_header(Cursor::new(bytes)).map_err(invalid)?;
            let mut image = DynamicImage::from_decoder(decoder)
                .map_err(invalid)?
                .into_rgba8();
            make_opaque_if_alpha_unused(&mut image);
            Ok(image)
        }
    }
}

pub fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::Adaptive)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    Ok(out)
}

/// 縦横比を保って長辺を `THUMBNAIL_MAX_EDGE` 以下に縮小する。
pub fn thumbnail(image: &RgbaImage) -> RgbaImage {
    let (width, height) = image.dimensions();
    let longest = width.max(height);
    if longest <= THUMBNAIL_MAX_EDGE {
        return image.clone();
    }
    let scale = |edge: u32| {
        let scaled = u64::from(edge) * u64::from(THUMBNAIL_MAX_EDGE) / u64::from(longest);
        (scaled as u32).max(1)
    };
    image::imageops::thumbnail(image, scale(width), scale(height))
}

/// 書き戻し用のCF_DIB(32bit、BI_RGB、ボトムアップ)を作る。
pub fn to_dib(image: &RgbaImage) -> Vec<u8> {
    let (width, height) = image.dimensions();
    let row_bytes = width as usize * BYTES_PER_PIXEL;
    let pixel_bytes = row_bytes * height as usize;

    let mut dib = Vec::with_capacity(DIB_HEADER_SIZE + pixel_bytes);
    dib.extend_from_slice(&(DIB_HEADER_SIZE as u32).to_le_bytes());
    dib.extend_from_slice(&(width as i32).to_le_bytes());
    dib.extend_from_slice(&(height as i32).to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    dib.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    dib.extend_from_slice(&0u32.to_le_bytes()); // biCompression = BI_RGB
    dib.extend_from_slice(&(pixel_bytes as u32).to_le_bytes());
    dib.extend_from_slice(&[0u8; 16]); // 解像度とパレット情報は使わない

    if row_bytes > 0 {
        for row in image.as_raw().chunks_exact(row_bytes).rev() {
            for rgba in row.as_chunks::<BYTES_PER_PIXEL>().0 {
                dib.extend_from_slice(&[rgba[2], rgba[1], rgba[0], rgba[3]]);
            }
        }
    }
    dib
}

/// 重複判定用のハッシュ。寸法と画素が同じなら同じ値になる。
pub fn hash_image(image: &RgbaImage) -> u64 {
    let mut hasher = std::hash::DefaultHasher::new();
    hasher.write_u32(image.width());
    hasher.write_u32(image.height());
    hasher.write(image.as_raw());
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn sample() -> RgbaImage {
        RgbaImage::from_fn(5, 3, |x, y| {
            Rgba([(x * 40) as u8, (y * 70) as u8, 200, 255 - (x * 50) as u8])
        })
    }

    #[test]
    fn png_roundtrip_keeps_pixels_and_hash() {
        let image = sample();
        let png = encode_png(&image).unwrap();
        let decoded = decode(&RawImage::Png(png)).unwrap();
        assert_eq!(decoded, image);
        assert_eq!(hash_image(&decoded), hash_image(&image));
    }

    #[test]
    fn dib_roundtrip_keeps_colors_and_orientation() {
        let image = sample();
        let decoded = decode(&RawImage::Dib(to_dib(&image))).unwrap();
        assert_eq!(decoded.dimensions(), image.dimensions());
        for (expected, actual) in image.pixels().zip(decoded.pixels()) {
            assert_eq!(expected.0[..3], actual.0[..3]);
        }
    }

    #[test]
    fn bi_rgb_dib_is_opaque() {
        let transparent = RgbaImage::from_pixel(2, 2, Rgba([10, 20, 30, 0]));
        let decoded = decode(&RawImage::Dib(to_dib(&transparent))).unwrap();
        assert!(decoded.pixels().all(|p| p.0 == [10, 20, 30, 255]));
    }

    #[test]
    fn all_zero_alpha_becomes_opaque() {
        let mut image = RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 0]));
        make_opaque_if_alpha_unused(&mut image);
        assert!(image.pixels().all(|p| p.0[3] == 255));
    }

    #[test]
    fn partial_alpha_is_kept() {
        let mut image = sample();
        image.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
        let before = image.clone();
        make_opaque_if_alpha_unused(&mut image);
        assert_eq!(image, before);
    }

    #[test]
    fn oversized_dib_is_rejected_before_decoding() {
        let mut dib = vec![0u8; DIB_HEADER_SIZE];
        dib[..4].copy_from_slice(&(DIB_HEADER_SIZE as u32).to_le_bytes());
        dib[4..8].copy_from_slice(&8000i32.to_le_bytes());
        dib[8..12].copy_from_slice(&(-8000i32).to_le_bytes());
        assert!(matches!(
            decode(&RawImage::Dib(dib)),
            Err(DecodeError::TooLarge)
        ));
    }

    #[test]
    fn thumbnail_keeps_aspect_ratio() {
        let image = RgbaImage::new(THUMBNAIL_MAX_EDGE * 4, THUMBNAIL_MAX_EDGE * 2);
        let thumb = thumbnail(&image);
        assert_eq!(
            thumb.dimensions(),
            (THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE / 2)
        );
    }

    #[test]
    fn small_image_is_not_enlarged() {
        assert_eq!(thumbnail(&sample()).dimensions(), (5, 3));
    }
}
