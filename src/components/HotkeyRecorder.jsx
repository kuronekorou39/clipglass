import { useEffect, useRef, useState } from "preact/hooks";
import { formatHotkey, readHotkey } from "../hotkey.js";

/**
 * ショートカットを、実際にキーを押して記録する。
 * 記録のあいだは今のショートカットを止める(押すとウィンドウが隠れてしまうため)。
 * Esc かほかの場所を押すと取りやめる。
 */
export function HotkeyRecorder({ hotkey, onChange, onSuspend }) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (recording) boxRef.current?.focus();
  }, [recording]);

  const start = () => {
    setPending([]);
    setError(null);
    setRecording(true);
    onSuspend(true);
  };

  const stop = (next) => {
    if (!recording) return;
    setRecording(false);
    setPending([]);
    if (next === undefined) onSuspend(false);
    else onChange(next);
  };

  const onKeyDown = (e) => {
    // 記録中のキーは、アプリのほかのショートカットに渡さない
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const noModifier = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (e.code === "Escape" && noModifier) {
      stop();
      return;
    }
    const result = readHotkey(e);
    if (result.hotkey) {
      setError(null);
      stop(result.hotkey);
    } else if (result.pending) {
      setError(null);
      setPending(result.pending);
    } else {
      setError(result.error);
    }
  };

  const onKeyUp = (e) => {
    e.stopPropagation();
    if (recording) setPending(readHotkey(e).pending ?? []);
  };

  let label = formatHotkey(hotkey) || "なし";
  if (recording) {
    label = pending.length > 0 ? `${formatHotkey(pending.join("+"))} + …` : "キーを押してください";
  }

  return (
    <div class="hotkey">
      <div class="field-row">
        <div
          ref={boxRef}
          class={`hotkey-box${recording ? " recording" : ""}${hotkey || recording ? "" : " empty"}`}
          role="button"
          tabIndex={0}
          aria-label="ショートカット"
          title={recording ? "Esc で取りやめ" : "クリックして、使いたいキーを押す"}
          onClick={() => !recording && start()}
          onKeyDown={recording ? onKeyDown : (e) => e.key === "Enter" && start()}
          onKeyUp={onKeyUp}
          onBlur={() => stop()}
        >
          {label}
        </div>
        {recording ? (
          <button class="row-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => stop()}>
            取消
          </button>
        ) : (
          <button
            class="row-btn"
            title="ショートカットを使わない"
            disabled={!hotkey}
            onClick={() => onChange("")}
          >
            なし
          </button>
        )}
      </div>
      {error && recording && <div class="hotkey-error">{error}</div>}
    </div>
  );
}
