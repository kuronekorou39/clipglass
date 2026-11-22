// ショートカットの記録。記録のあいだは今のショートカットを止め、終わったら必ず戻す。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { HotkeyRecorder } from "./HotkeyRecorder.jsx";

let root;
let onChange;
let onSuspend;

/** 本物と同じく、変えた値が次の描画で戻ってくるようにする。 */
function Host({ initial }) {
  const [hotkey, setHotkey] = useState(initial);
  return (
    <HotkeyRecorder
      hotkey={hotkey}
      onChange={(next) => {
        onChange(next);
        setHotkey(next);
      }}
      onSuspend={onSuspend}
    />
  );
}

async function mount(hotkey = "Alt+Q") {
  await act(async () => render(<Host initial={hotkey} />, root));
}

const box = () => root.querySelector('[aria-label="ショートカット"]');
const button = (label) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === label);

async function click(element) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
}

async function press(init) {
  await act(async () => box().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
}

async function release(init) {
  await act(async () => box().dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, ...init })));
}

beforeEach(() => {
  onChange = vi.fn();
  onSuspend = vi.fn();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("HotkeyRecorder", () => {
  it("枠で Enter を押しても記録を始められる。ほかのキーでは始まらない", async () => {
    await mount();
    await press({ key: "a", code: "KeyA" });
    expect(onSuspend).not.toHaveBeenCalled();
    await press({ key: "Enter", code: "Enter" });
    expect(onSuspend).toHaveBeenCalledWith(true);
    expect(box().textContent).toBe("キーを押してください");
    expect(document.activeElement).toBe(box());
  });

  it("記録中にもう一度枠を押しても、やり直しにならない", async () => {
    await mount();
    await click(box());
    await press({ code: "AltLeft", key: "Alt", altKey: true });
    await click(box());
    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(box().textContent).toBe("Alt + …");
  });

  it("修飾キーを離すと、途中の表示も戻る", async () => {
    await mount();
    await click(box());
    await press({ code: "ControlLeft", key: "Control", ctrlKey: true });
    expect(box().textContent).toBe("Ctrl + …");
    await release({ code: "ControlLeft", key: "Control" });
    expect(box().textContent).toBe("キーを押してください");
  });

  it("修飾キー以外を離しても、途中の表示を消す", async () => {
    await mount();
    await click(box());
    await press({ code: "AltLeft", key: "Alt", altKey: true });
    await release({ code: "KeyQ", key: "q", altKey: true });
    expect(box().textContent).toBe("キーを押してください");
  });

  it("押しっぱなしの繰り返しは記録しない", async () => {
    await mount();
    await click(box());
    await press({ code: "KeyW", key: "w", altKey: true, repeat: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(box().classList.contains("recording")).toBe(true);
  });

  it("使えないキーは理由を出し、次に正しく押せば消える", async () => {
    await mount();
    await click(box());
    await press({ code: "F13", key: "F13", ctrlKey: true });
    expect(root.querySelector(".hotkey-error").textContent).toBe("このキーはショートカットに使えません");
    await press({ code: "ControlLeft", key: "Control", ctrlKey: true });
    expect(root.querySelector(".hotkey-error")).toBeNull();
    await press({ code: "KeyW", key: "w", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith("Ctrl+W");
  });

  it("記録中のキーは、アプリのほかのショートカットへ渡さない", async () => {
    await mount();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    window.addEventListener("keyup", outer);
    try {
      await click(box());
      await press({ code: "Digit1", key: "1" });
      await release({ code: "Digit1", key: "1" });
      expect(outer).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outer);
      window.removeEventListener("keyup", outer);
    }
  });

  it("修飾キーを押したままの Esc は、取りやめではなく組み合わせとして読む", async () => {
    await mount();
    await click(box());
    await press({ code: "Escape", key: "Escape", ctrlKey: true });
    expect(box().classList.contains("recording")).toBe(true);
    expect(root.querySelector(".hotkey-error").textContent).toBe("このキーはショートカットに使えません");
  });

  it("「取消」で記録をやめ、今のショートカットを動かし直す", async () => {
    await mount();
    await click(box());
    await click(button("取消"));
    expect(onSuspend).toHaveBeenLastCalledWith(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(box().textContent).toBe("Alt + Q");
  });

  it("ほかの場所へ移ると記録をやめる", async () => {
    await mount();
    await click(box());
    await act(async () => box().blur());
    expect(onSuspend).toHaveBeenLastCalledWith(false);
    expect(box().classList.contains("recording")).toBe(false);
  });

  it("記録していないときに枠から離れても、ショートカットの停止や再開を送らない", async () => {
    await mount();
    box().focus();
    await act(async () => box().blur());
    expect(onSuspend).not.toHaveBeenCalled();
  });

  it("「取消」を押し始めても枠のフォーカスを奪わない(離れた扱いで先に記録が終わらない)", async () => {
    await mount();
    await click(box());
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => button("取消").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(box().classList.contains("recording")).toBe(true);
  });

  it("今と同じ組み合わせを押したら、変更にせず今のショートカットに戻す", async () => {
    await mount("Alt+Q");
    await click(box());
    await press({ code: "KeyQ", key: "q", altKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(onSuspend).toHaveBeenLastCalledWith(false);
    // 変えていないので「元に戻す」も出ない
    expect(button("元に戻す")).toBeUndefined();
  });

  it("「なし」でショートカットを外し、「元に戻す」で前の値に戻せる", async () => {
    await mount("Alt+Q");
    await click(button("なし"));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(box().textContent).toBe("なし");
    expect(box().classList.contains("empty")).toBe(true);
    // もう外れているので、もう一度は押せない
    expect(button("なし").disabled).toBe(true);
    await click(button("元に戻す"));
    expect(onChange).toHaveBeenLastCalledWith("Alt+Q");
    expect(box().textContent).toBe("Alt + Q");
    expect(button("元に戻す")).toBeUndefined();
  });

  it("なしの状態から設定したあとの「元に戻す」は、なしへ戻す", async () => {
    await mount("");
    await click(box());
    await press({ code: "KeyW", key: "w", altKey: true });
    expect(button("元に戻す").title).toBe("なし に戻す");
    await click(button("元に戻す"));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("記録中は注意の表示を隠す", async () => {
    await mount("Ctrl+Shift+V");
    expect(root.querySelector(".hotkey-warning")).toBeTruthy();
    await click(box());
    expect(root.querySelector(".hotkey-warning")).toBeNull();
  });
});
