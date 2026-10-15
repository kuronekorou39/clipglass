//! キーボードでの移動・サイズ変更と、画面の隅への配置の計算。
//! リモートデスクトップなどでマウスの細かい操作がしづらいときの代わりに使う。
//! 座標はすべて物理ピクセル。

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

impl Rect {
    fn center(&self) -> (i64, i64) {
        (self.x + self.width / 2, self.y + self.height / 2)
    }

    fn contains(&self, (x, y): (i64, i64)) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "top-left" => Some(Self::TopLeft),
            "top-right" => Some(Self::TopRight),
            "bottom-left" => Some(Self::BottomLeft),
            "bottom-right" => Some(Self::BottomRight),
            _ => None,
        }
    }
}

/// 大きさを最小値と作業領域の間に収め、位置を作業領域の中に収める。
pub fn clamp_into(rect: Rect, area: Rect, min: (i64, i64)) -> Rect {
    let width = rect.width.min(area.width).max(min.0);
    let height = rect.height.min(area.height).max(min.1);
    // 最小サイズが作業領域より大きいときは左上をそろえる。
    let x = rect.x.min(area.x + area.width - width).max(area.x);
    let y = rect.y.min(area.y + area.height - height).max(area.y);
    Rect {
        x,
        y,
        width,
        height,
    }
}

/// 中心を含む作業領域を選ぶ。どれにも入らなければ `fallback`(今いるモニター)。
/// 隣のモニターへはキーボードでもそのまま移れる。
fn area_for(rect: Rect, areas: &[Rect], fallback: Rect) -> Rect {
    areas
        .iter()
        .copied()
        .find(|area| area.contains(rect.center()))
        .unwrap_or(fallback)
}

/// 位置を `(dx, dy)`、大きさを `(dw, dh)` だけ変え、画面からはみ出さないように収める。
pub fn nudge(
    rect: Rect,
    delta: (i64, i64, i64, i64),
    min: (i64, i64),
    areas: &[Rect],
    current_area: Rect,
) -> Rect {
    let (dx, dy, dw, dh) = delta;
    let moved = Rect {
        x: rect.x + dx,
        y: rect.y + dy,
        width: rect.width + dw,
        height: rect.height + dh,
    };
    clamp_into(moved, area_for(moved, areas, current_area), min)
}

/// 大きさを保ったまま、作業領域の隅から `margin` だけ離して置く。
pub fn snap(rect: Rect, corner: Corner, area: Rect, margin: i64, min: (i64, i64)) -> Rect {
    let fitted = clamp_into(rect, area, min);
    let left = area.x + margin;
    let top = area.y + margin;
    let right = area.x + area.width - fitted.width - margin;
    let bottom = area.y + area.height - fitted.height - margin;
    let (x, y) = match corner {
        Corner::TopLeft => (left, top),
        Corner::TopRight => (right, top),
        Corner::BottomLeft => (left, bottom),
        Corner::BottomRight => (right, bottom),
    };
    // 余白を取ると入らない小さな画面でも、はみ出させない。
    clamp_into(Rect { x, y, ..fitted }, area, min)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: (i64, i64) = (360, 220);
    const SCREEN: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    const RIGHT_SCREEN: Rect = Rect {
        x: 1920,
        y: 0,
        width: 1280,
        height: 1000,
    };

    fn rect(x: i64, y: i64, width: i64, height: i64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn move_and_resize_by_steps() {
        let start = rect(100, 100, 420, 480);
        assert_eq!(
            nudge(start, (20, -20, 0, 0), MIN, &[SCREEN], SCREEN),
            rect(120, 80, 420, 480)
        );
        assert_eq!(
            nudge(start, (0, 0, 40, -20), MIN, &[SCREEN], SCREEN),
            rect(100, 100, 460, 460)
        );
    }

    #[test]
    fn size_never_goes_below_minimum_or_above_screen() {
        let start = rect(100, 100, 370, 230);
        assert_eq!(
            nudge(start, (0, 0, -100, -100), MIN, &[SCREEN], SCREEN),
            rect(100, 100, 360, 220)
        );
        let huge = nudge(start, (0, 0, 5000, 5000), MIN, &[SCREEN], SCREEN);
        assert_eq!(huge, rect(0, 0, 1920, 1040));
    }

    #[test]
    fn window_stays_on_screen_at_edges() {
        let at_right = rect(1500, 600, 420, 440);
        assert_eq!(
            nudge(at_right, (100, 100, 0, 0), MIN, &[SCREEN], SCREEN),
            rect(1500, 600, 420, 440)
        );
        let at_left = rect(0, 0, 420, 480);
        assert_eq!(
            nudge(at_left, (-20, -20, 0, 0), MIN, &[SCREEN], SCREEN),
            rect(0, 0, 420, 480)
        );
    }

    #[test]
    fn keyboard_move_can_cross_to_the_next_monitor() {
        let areas = [SCREEN, RIGHT_SCREEN];
        // 中心が右のモニターに入ったら、右のモニターの中に収める
        let near_edge = rect(1600, 100, 420, 480);
        let moved = nudge(near_edge, (200, 0, 0, 0), MIN, &areas, SCREEN);
        assert_eq!(moved, rect(1920, 100, 420, 480));
        let further = nudge(moved, (20, 0, 0, 0), MIN, &areas, RIGHT_SCREEN);
        assert_eq!(further, rect(1940, 100, 420, 480));
    }

    #[test]
    fn window_left_outside_every_monitor_comes_back() {
        // モニターを外したあとなど、どの画面にも入っていない位置から戻る
        let lost = rect(4000, 2000, 420, 480);
        assert_eq!(
            nudge(lost, (0, 0, 0, 0), MIN, &[SCREEN], SCREEN),
            rect(1500, 560, 420, 480)
        );
    }

    #[test]
    fn snap_to_each_corner_with_margin() {
        let start = rect(500, 500, 420, 480);
        let margin = 8;
        assert_eq!(
            snap(start, Corner::TopLeft, SCREEN, margin, MIN),
            rect(8, 8, 420, 480)
        );
        assert_eq!(
            snap(start, Corner::TopRight, SCREEN, margin, MIN),
            rect(1492, 8, 420, 480)
        );
        assert_eq!(
            snap(start, Corner::BottomLeft, SCREEN, margin, MIN),
            rect(8, 552, 420, 480)
        );
        assert_eq!(
            snap(start, Corner::BottomRight, RIGHT_SCREEN, margin, MIN),
            rect(1920 + 1280 - 428, 1000 - 488, 420, 480)
        );
    }

    #[test]
    fn snap_on_a_tiny_screen_does_not_overflow() {
        let tiny = rect(0, 0, 400, 300);
        let snapped = snap(rect(0, 0, 420, 480), Corner::BottomRight, tiny, 8, MIN);
        assert_eq!(snapped, rect(0, 0, 400, 300));
    }

    #[test]
    fn corner_names() {
        assert_eq!(Corner::parse("top-left"), Some(Corner::TopLeft));
        assert_eq!(Corner::parse("bottom-right"), Some(Corner::BottomRight));
        assert_eq!(Corner::parse("middle"), None);
    }
}
