// 入力欄を押したときだけ、キーボードを受け取る。
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));

const { watchEditableClicks } = await import("./keyboardFocus.js");

function press(element) {
  document.body.append(element);
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.remove();
}

describe("watchEditableClicks", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("入力欄では受け取り、ほかの場所では受け取らない", () => {
    const stop = watchEditableClicks();
    press(document.createElement("button"));
    press(document.createElement("div"));
    expect(invoke).not.toHaveBeenCalled();
    press(document.createElement("input"));
    press(document.createElement("textarea"));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("take_keyboard");
    stop();
    press(document.createElement("input"));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("バーの空いた場所のクリックでは受け取り、動かしただけなら受け取らない", () => {
    const bar = document.createElement("div");
    bar.setAttribute("data-drag-region", "");
    document.body.append(bar);
    const stop = watchEditableClicks();
    const fire = (type, screenX) => bar.dispatchEvent(new MouseEvent(type, { bubbles: true, screenX, screenY: 5 }));
    fire("mousedown", 10);
    fire("click", 40);
    expect(invoke).not.toHaveBeenCalled();
    fire("mousedown", 10);
    fire("click", 11);
    expect(invoke).toHaveBeenCalledWith("take_keyboard");
    stop();
    bar.remove();
  });

  it("受け取りに失敗しても、未処理のエラーにしない", async () => {
    invoke.mockRejectedValue("失敗");
    const stop = watchEditableClicks();
    press(document.createElement("input"));
    await Promise.resolve();
    stop();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
