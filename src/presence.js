import { useEffect, useState } from "preact/hooks";

/** 閉じるアニメーションの長さ(ms)。style.css の --fade-duration と合わせる。 */
export const EXIT_DURATION_MS = 140;

/**
 * 閉じたあとも、閉じるアニメーションのあいだだけ描画を残す。
 * `mounted` が描画するか、`closing` が閉じる途中か(このあいだは操作させない)。
 */
export function usePresence(open, duration = EXIT_DURATION_MS) {
  const [lingering, setLingering] = useState(false);

  useEffect(() => {
    if (open) {
      setLingering(true);
      return undefined;
    }
    const timer = setTimeout(() => setLingering(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);

  return { mounted: open || lingering, closing: !open && lingering };
}
