// 本体と別ウィンドウで、マウスが乗っているときの濃さをそろえる。
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listeners = new Map();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args) => invoke(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name, handler) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  },
}));

const { watchWindowHover } = await import("./windowHover.js");

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("watchWindowHover", () => {
  let root;

  beforeEach(() => {
    root = document.createElement("html");
    listeners.clear();
    invoke.mockReset();
    invoke.mockResolvedValue(false);
  });

  it("マウスの出入りを Rust へ送る", async () => {
    const stop = watchWindowHover(root);
    root.dispatchEvent(new MouseEvent("mouseenter"));
    expect(invoke).toHaveBeenCalledWith("set_hovered", { hovered: true });
    root.dispatchEvent(new MouseEvent("mouseleave"));
    expect(invoke).toHaveBeenLastCalledWith("set_hovered", { hovered: false });
    stop();
    invoke.mockClear();
    root.dispatchEvent(new MouseEvent("mouseenter"));
    expect(invoke).not.toHaveBeenCalled();
    await flush();
    expect(listeners.size).toBe(0);
  });

  it("どちらかに乗っている間は、印を付ける", async () => {
    watchWindowHover(root);
    await flush();
    expect(root.classList.contains("linked-hover")).toBe(false);
    listeners.get("window-hover")({ payload: true });
    expect(root.classList.contains("linked-hover")).toBe(true);
    listeners.get("window-hover")({ payload: false });
    expect(root.classList.contains("linked-hover")).toBe(false);
  });

  it("開いた時点ですでに乗っていれば、印を付ける", async () => {
    invoke.mockResolvedValue(true);
    watchWindowHover(root);
    await flush();
    expect(root.classList.contains("linked-hover")).toBe(true);
  });

  it("送れなくても、未処理のエラーにしない", async () => {
    invoke.mockRejectedValue("失敗");
    watchWindowHover(root);
    root.dispatchEvent(new MouseEvent("mouseenter"));
    await flush();
    expect(root.classList.contains("linked-hover")).toBe(false);
  });
});
