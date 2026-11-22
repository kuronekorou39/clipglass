//! 一覧の上から9件を貼り付ける、修飾キー+数字のショートカット。
//!
//! ほかのアプリの同じ操作を奪わないよう、ウィンドウを出しているあいだだけ登録する
//! (登録と解除は `lib.rs` の `sync_quick_keys`)。ここでは組み合わせの決まりだけを持つ。

/// 組み合わせの初期値。
pub const DEFAULT_MODE: &str = "ctrl";
const MODES: [(&str, Option<&str>); 4] = [
    (DEFAULT_MODE, Some("Control")),
    ("ctrl+shift", Some("Control+Shift")),
    ("ctrl+alt", Some("Control+Alt")),
    ("off", None),
];
/// 数字で選べる行の数。
const ROWS: usize = 9;

pub fn is_mode(mode: &str) -> bool {
    MODES.iter().any(|(name, _)| *name == mode)
}

/// 登録するショートカットと、選ぶ行の位置(0〜8)。数字キーとテンキーの両方を返す。
pub fn shortcuts(mode: &str) -> Vec<(String, usize)> {
    let Some(prefix) = MODES
        .iter()
        .find(|(name, _)| *name == mode)
        .and_then(|(_, prefix)| *prefix)
    else {
        return Vec::new();
    };
    (0..ROWS)
        .flat_map(|index| {
            let number = index + 1;
            [
                (format!("{prefix}+Digit{number}"), index),
                (format!("{prefix}+Numpad{number}"), index),
            ]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn modes_are_validated() {
        for mode in ["ctrl", "ctrl+shift", "ctrl+alt", "off"] {
            assert!(is_mode(mode), "{mode}");
        }
        assert!(!is_mode(""));
        assert!(!is_mode("CTRL"));
        assert!(!is_mode("alt"));
    }

    #[test]
    fn each_mode_covers_nine_rows_on_both_key_groups() {
        let keys = shortcuts("ctrl");
        assert_eq!(keys.len(), ROWS * 2);
        assert_eq!(keys[0], ("Control+Digit1".to_string(), 0));
        assert_eq!(keys[1], ("Control+Numpad1".to_string(), 0));
        assert_eq!(keys[17], ("Control+Numpad9".to_string(), 8));
        assert_eq!(shortcuts("ctrl+shift")[2].0, "Control+Shift+Digit2");
        assert_eq!(shortcuts("ctrl+alt")[3].0, "Control+Alt+Numpad2");
    }

    #[test]
    fn off_and_unknown_modes_register_nothing() {
        assert!(shortcuts("off").is_empty());
        assert!(shortcuts("unknown").is_empty());
    }

    #[test]
    fn every_shortcut_can_be_parsed_and_is_unique() {
        for (mode, _) in MODES {
            let ids: Vec<u32> = shortcuts(mode)
                .iter()
                .map(|(text, _)| text.parse::<Shortcut>().unwrap().id())
                .collect();
            for (i, id) in ids.iter().enumerate() {
                assert!(!ids[..i].contains(id));
            }
        }
    }
}
