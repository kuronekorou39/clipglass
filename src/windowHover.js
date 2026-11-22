import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 本体か別ウィンドウのどちらかにマウスが乗っていることを Rust から受け取るイベント。 */
const HOVER_EVENT = "window-hover";
const LINKED_CLASS = "linked-hover";

const send = (hovered) => Promise.resolve(invoke("set_hovered", { hovered })).catch(() => {});

/**
 * 本体と別ウィンドウで、マウスが乗っているときの濃さをそろえる。
 * どちらかに乗っていれば、両方の <html> に印を付ける(濃さは style.css)。
 */
export function watchWindowHover(root = document.documentElement) {
  const apply = (hovered) => root.classList.toggle(LINKED_CLASS, Boolean(hovered));
  const onEnter = () => send(true);
  const onLeave = () => send(false);
  root.addEventListener("mouseenter", onEnter);
  root.addEventListener("mouseleave", onLeave);
  const unlisten = listen(HOVER_EVENT, (event) => apply(event.payload));
  Promise.resolve(invoke("get_hovered")).then(apply).catch(() => {});
  return () => {
    root.removeEventListener("mouseenter", onEnter);
    root.removeEventListener("mouseleave", onLeave);
    unlisten.then((stop) => stop());
  };
}
