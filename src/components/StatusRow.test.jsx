// クリップボードを一覧に出せないときの案内。状態ごとに利用者へ見せる文を確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { StatusRow } from "./StatusRow.jsx";

let root;

async function mount(status) {
  await act(async () => render(<StatusRow status={status} />, root));
  return root.querySelector(".status-row");
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

describe("StatusRow", () => {
  it("空のときはそう伝え、形式の一覧は出さない", async () => {
    const row = await mount({ kind: "empty" });
    expect(row.textContent).toBe("クリップボードは空です");
    expect(row.querySelector("details")).toBeNull();
  });

  it("読み取りの失敗は理由を添えて、エラーの見た目で出す", async () => {
    const row = await mount({ kind: "error", message: "開けません" });
    expect(row.textContent).toBe("読み取りに失敗しました: 開けません");
    expect(row.classList.contains("status-error")).toBe(true);
  });

  it.each([
    ["unsupported", "この内容はプレビューに対応していません"],
    ["too_large", "サイズが大きいため表示できません"],
  ])("%s は案内と、クリップボードの形式の一覧を出す", async (kind, message) => {
    const row = await mount({ kind, formats: ["CF_DIB", "PNG"] });
    expect(row.firstElementChild.textContent).toBe(message);
    expect(row.querySelector("summary").textContent).toBe("形式 2件");
    expect([...row.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["CF_DIB", "PNG"]);
  });

  it("形式の一覧を開くクリックは、外側へ伝えない", async () => {
    const row = await mount({ kind: "unsupported", formats: ["PNG"] });
    const outer = vi.fn();
    root.addEventListener("click", outer);
    row.querySelector("summary").click();
    expect(outer).not.toHaveBeenCalled();
  });
});
