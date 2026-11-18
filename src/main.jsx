import { render } from "preact";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./components/App.jsx";
import { Panel } from "./components/Panel.jsx";

// 同じページを、本体と横の別ウィンドウ(プリセット・お気に入り)の両方で開く。ウィンドウの名前で分ける
const isPanel = getCurrentWindow().label === "panel";
document.documentElement.classList.toggle("panel-window", isPanel);
render(isPanel ? <Panel /> : <App />, document.getElementById("app"));
