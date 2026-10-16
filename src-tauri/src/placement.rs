//! マウスとキーボードでの移動・サイズ変更と、画面の隅への配置の計算。
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

/// マウスでの移動か、どの辺・隅でのサイズ変更か。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DragKind {
    moving: bool,
    north: bool,
    south: bool,
    east: bool,
    west: bool,
}

impl DragKind {
    /// `"move"` か、辺と隅の方角(`"n"`、`"se"` など)。
    pub fn parse(name: &str) -> Option<Self> {
        if name == "move" {
            return Some(Self {
                moving: true,
                north: false,
                south: false,
                east: false,
                west: false,
            });
        }
        if name.is_empty() || name.len() > 2 || !name.chars().all(|c| "nsew".contains(c)) {
            return None;
        }
        let kind = Self {
            moving: false,
            north: name.contains('n'),
            south: name.contains('s'),
            east: name.contains('e'),
            west: name.contains('w'),
        };
        // "ns" や "nn" のような向かい合う・重なる指定は受けない
        let opposite = (kind.north && kind.south) || (kind.east && kind.west);
        (!opposite && name.len() == kind.edge_count()).then_some(kind)
    }

    fn edge_count(&self) -> usize {
        [self.north, self.south, self.east, self.west]
            .iter()
            .filter(|edge| **edge)
            .count()
    }

    pub fn is_move(&self) -> bool {
        self.moving
    }
}

/// つかんだときの位置と大きさ `start` に、カーソルの移動量 `(dx, dy)` を当てる。
/// サイズ変更では、つかんでいない側の辺を動かさずに最小サイズを守る。
/// 移動は OS のドラッグと同じく画面の外へも出せる(キーボードの移動とは違い収めない)。
pub fn drag(start: Rect, kind: DragKind, (dx, dy): (i64, i64), min: (i64, i64)) -> Rect {
    if kind.moving {
        return Rect {
            x: start.x + dx,
            y: start.y + dy,
            ..start
        };
    }
    let (x, width) = drag_axis(start.x, start.width, dx, kind.west, kind.east, min.0);
    let (y, height) = drag_axis(start.y, start.height, dy, kind.north, kind.south, min.1);
    Rect {
        x,
        y,
        width,
        height,
    }
}

/// 1軸ぶんのサイズ変更。`near` は左または上の辺、`far` は右または下の辺をつかんでいるとき。
fn drag_axis(pos: i64, size: i64, delta: i64, near: bool, far: bool, min: i64) -> (i64, i64) {
    if near {
        let size_next = (size - delta).max(min);
        (pos + size - size_next, size_next)
    } else if far {
        (pos, (size + delta).max(min))
    } else {
        (pos, size)
    }
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

    #[test]
    fn drag_kind_parses_move_and_directions() {
        assert!(DragKind::parse("move").unwrap().is_move());
        for name in ["n", "s", "e", "w", "ne", "nw", "se", "sw", "en"] {
            let kind = DragKind::parse(name).unwrap_or_else(|| panic!("{name}"));
            assert!(!kind.is_move());
        }
        for name in ["", "x", "ns", "ew", "nn", "nse", "MOVE"] {
            assert_eq!(DragKind::parse(name), None, "{name}");
        }
    }

    #[test]
    fn drag_moves_without_changing_size() {
        let start = rect(100, 100, 420, 480);
        let kind = DragKind::parse("move").unwrap();
        assert_eq!(drag(start, kind, (30, -50), MIN), rect(130, 50, 420, 480));
        // 画面の外へも出せる
        assert_eq!(drag(start, kind, (-500, 0), MIN), rect(-400, 100, 420, 480));
    }

    #[test]
    fn drag_resizes_from_each_edge() {
        let start = rect(100, 100, 420, 480);
        let resize = |name, delta| drag(start, DragKind::parse(name).unwrap(), delta, MIN);
        assert_eq!(resize("e", (40, 99)), rect(100, 100, 460, 480));
        assert_eq!(resize("s", (99, 40)), rect(100, 100, 420, 520));
        // 左と上の辺は、右と下の辺を動かさずに広げる
        assert_eq!(resize("w", (-40, 0)), rect(60, 100, 460, 480));
        assert_eq!(resize("n", (0, 30)), rect(100, 130, 420, 450));
        assert_eq!(resize("se", (10, 20)), rect(100, 100, 430, 500));
        assert_eq!(resize("nw", (-10, -20)), rect(90, 80, 430, 500));
    }

    #[test]
    fn drag_resize_keeps_minimum_and_the_opposite_edge() {
        let start = rect(100, 100, 420, 480);
        let resize = |name, delta| drag(start, DragKind::parse(name).unwrap(), delta, MIN);
        assert_eq!(resize("e", (-1000, 0)), rect(100, 100, 360, 480));
        // 左の辺を縮めすぎても、右の辺(520)は動かない
        assert_eq!(resize("w", (1000, 0)), rect(160, 100, 360, 480));
        assert_eq!(resize("n", (0, 1000)), rect(100, 360, 420, 220));
    }
}
