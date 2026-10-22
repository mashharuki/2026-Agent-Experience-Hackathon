# 観戦画面デザイン改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026-10-23のデザインレビューの指摘を優先度順に直し、「予想して当たったか」を観戦画面の中心に据える。

**Architecture:** 表示用の計算（結果判定・順位行・差・戦術の種類・ラベル位置）を純粋関数として `src/presentation.ts` に切り出し、Vitest（node環境）で検証する。UIは `ObserverApp.tsx` のJSXとCSSで変更し、Playwrightで確認する。物理・風・判断の処理は変えない。

**Tech Stack:** React 19 / MUI 9 / Three.js 0.180.0 / Vitest 5（`environment: "node"`、`src/**/*.test.ts`）/ Playwright（`e2e/`、ポート5175）。新しいnpm依存は追加しない。

**Spec:** 2026-10-23のレビュー（下の「背景」に要約）、[DESIGN.md](../../apps/regatta-web/DESIGN.md)、[spec.md](spec.md)。

## 背景（レビューの指摘・優先度順）

1. 結果画面：コース図が先に来て、着順・自分の予想・スライダーがスクロールしないと見えない。的中の演出が弱い。
2. 予想艇：観戦中、順位表・判断ログ・3D上・計器のどこにも予想艇の印がない。順位表の値が艇速で差が読めない。計器は艇速が最大で、どの艇の値かも示していない。判断ログは「針路を維持」ばかりで変化が埋もれ、出所・状態が8pxで読めない。
3. 文字と色：8〜13pxが混在。灰青色が直書きで10種以上。注記の `#627c88` は4.21:1、時刻の `#69828c` は3.85:1。海上の白文字は推定1.8〜2.1:1。
4. 俯瞰では艇が点になり、どれがどの艇か区別できない。
5. 出走前は出走ボタンがパネル下部に押し込まれる。「レースを終了」は確認なしで即終了。「モデル接続を確認」がボタンに見えない。
6. 表示切替ボタンは高さ28px、順位表の行は約30px。コース図は152pxで航跡が読めない。

## Global Constraints

- `sailing-v2` / `wind-v2` / `fleet-v4` と物理・判断の処理を変えない。`fleetRanking` の並び順の結果を変えない。
- 新しいnpm/Python依存を追加しない。Three.jsの描画は手続き的に作り、外部画像・フォントは使わない（DESIGN.md）。
- 実モデルとルールのプレビューの区別を、エンジン欄・説明・ログ・フッターの4か所で保つ。confidenceを勝率・オッズとして表示しない。
- 予想・seed・未来の風を判断の観測に入れない。この計画の変更は表示側だけ。
- 日英の文言は両方を同じ変更で追加する（`ja` と `en: Record<keyof typeof ja, string>`）。
- 文字サイズの下限は11px、本文は12px以上。小さい文字のコントラストは4.5:1以上。押せる要素は高さ44px以上（PCの表示切替は36px以上）。
- `prefers-reduced-motion: reduce` では的中演出のアニメーションを止める。
- 旧操船画面 `App.tsx` は削除しない（AGENTS.md）。
- 既存のE2Eが参照する文言（「艇を選んでください」「この艇を予想して出走」「一時停止」「観戦を再開」「レースを終了」「レース不成立・予想判定なし」「次のレースを予想」）と、クラス名 `.prediction-options` `.locked-prediction` `.decision-item` `.fleet-standing` `.mark-indicator` `.engine-note` は残す。

## Review Focus

1. **同着**（`fleetWinners` が2艇以上）で予想がそのどちらか → 「的中」と表示し、勝者は両方の名前を出す。→ Task 1 のテスト `treats a tie containing the prediction as a hit`。
2. **途中終了・時間切れで一部だけ完走** → 未完走艇の差は「未完走」、完走艇は完走時刻。`timed_out` で完走者がいれば勝者あり。→ Task 2 のテスト `shows finish time for finishers and no gap for unfinished boats after timeout`。
3. **予想なしのまま終端状態になる**（再戦直後など `prediction === null`）→ 結果は「的中」にも「外れ」にもしない。→ Task 1 のテスト `never reports hit or miss without a prediction`。
4. **艇がカメラの後ろや画面外にいる** → 艇名ラベルを出さない（画面の反対側に鏡像で出さない）。→ Task 4 のテスト `hides labels behind the camera or outside the view`。
5. **終了確認ダイアログを開いている間にレースが時間切れで終わる** → 確認ダイアログを閉じ、結果画面だけを出す。二重の終了処理をしない。→ Task 5 のE2E `closes the end confirmation when the race finishes on its own`（`page.clock` で進める）。

---

## ファイル構成

| ファイル | 責務 | 変更 |
| --- | --- | --- |
| `packages/sailing-sim/src/fleet.ts` | `fleetRanking` 内の残距離計算を `fleetRemaining` として公開 | 変更 |
| `packages/sailing-sim/test/fleet.test.ts` | `fleetRemaining` の検証 | 追記 |
| `apps/regatta-web/src/presentation.ts` | 結果判定・順位行・戦術の種類・ラベル位置の純粋関数 | 新規 |
| `apps/regatta-web/src/presentation.test.ts` | 上記の単体テスト | 新規 |
| `apps/regatta-web/src/ObserverApp.tsx` | 結果画面・強調・パネル順・終了確認 | 変更 |
| `apps/regatta-web/src/style.css` | 観戦画面のトークンとスタイル | 変更 |
| `apps/regatta-web/src/legacy.css` | 旧操船画面だけのスタイルを移す | 新規 |
| `apps/regatta-web/src/App.tsx` | `legacy.css` を読み込む1行だけ追加 | 変更 |
| `apps/regatta-web/src/style.test.ts` | トークンのコントラストと文字サイズの下限を検証 | 新規 |
| `apps/regatta-web/src/scene.ts`、`runtime.ts` | 艇名ラベルと予想艇の印 | 変更 |
| `apps/regatta-web/src/main.tsx` | MUIテーマの色をトークンに合わせる | 変更 |
| `apps/regatta-web/e2e/spectator.spec.ts` | 画面の流れの確認 | 追記 |
| `apps/regatta-web/DESIGN.md` | 決めたデザインルールを記録 | 追記 |

---

### Task 1: 結果画面の作り直し（優先度1）

**Files:**
- Create: `apps/regatta-web/src/presentation.ts`, `apps/regatta-web/src/presentation.test.ts`
- Modify: `apps/regatta-web/src/ObserverApp.tsx:850-924`（Dialog）, `apps/regatta-web/src/style.css`（`.result-*`）
- Test: `apps/regatta-web/e2e/spectator.spec.ts`

**Interfaces:**
- Produces: `export type Outcome = "hit" | "miss" | "no_result" | "unscored";` と `export function raceOutcome(winners: readonly string[], prediction: string | null): Outcome`。`presentation.ts` は後続タスクの関数もここに追加する。

- [ ] **Step 1: 失敗するテストを書く**（`presentation.test.ts`）

```ts
import { describe, expect, it } from "vitest";
import { raceOutcome } from "./presentation";

describe("raceOutcome", () => {
  it("is no_result when nobody finished", () =>
    expect(raceOutcome([], "aurora")).toBe("no_result"));
  it("is hit or miss against the winner", () => {
    expect(raceOutcome(["zephyr"], "zephyr")).toBe("hit");
    expect(raceOutcome(["zephyr"], "aurora")).toBe("miss");
  });
  it("treats a tie containing the prediction as a hit", () =>
    expect(raceOutcome(["coral", "jade"], "jade")).toBe("hit"));
  it("never reports hit or miss without a prediction", () =>
    expect(raceOutcome(["coral"], null)).toBe("unscored"));
});
```

- [ ] **Step 2: 失敗を確認** — `pnpm --filter regatta-web test -- presentation` → `raceOutcome` が存在せずFAIL。
- [ ] **Step 3: `raceOutcome` を実装** — 勝者なし→`no_result`、予想なし→`unscored`、含まれる→`hit`、それ以外→`miss`。
- [ ] **Step 4: 通過を確認** — 同じコマンドでPASS。
- [ ] **Step 5: 結果ダイアログの構成を変える**（`ObserverApp.tsx`）。上から順に：
  1. 見出し（`raceOutcome` で `hit`→`text.hit`、`miss`→`text.miss`、`no_result`→`text.noWinner`、`unscored`→新しい文言 `unscored`：ja「予想なし・判定対象外」en「No prediction — not scored」。勝者の表示はそのまま出す）。`hit` のときは見出しの領域に `.result-hit` を付ける。
  2. 予想と勝者を横に並べた要約：「あなたの予想」＋艇の色の点と名前、「勝者」＋名前（同着は ` / ` 区切り）。
  3. 本体は `.result-layout`（2列。左にコース図とスライダー、右に着順表）。着順表は順位・色の点・名前・完走時刻または `text.dns`。予想艇の行に `.is-prediction` と `text.yourPick` の札。
  4. 振り返り（既存の `canDebrief` 部分）を下に置く。
  - `DialogContent` の見出しに `id="result-summary"` を付け、`Dialog` に `aria-describedby="result-summary"` を付ける。
  - 新しい文言 `yourPick`：ja「あなたの予想」と同じ意味の短い札「予想」、en「Your pick」。
- [ ] **Step 6: CSSを書く**（`style.css`）。`.result-layout` は `grid-template-columns: minmax(0, 1.4fr) minmax(220px, 1fr)`、680px以下で1列（図を着順の後ろに）。`.result-hit` は的中を示す色の帯（`--accent` 系）と、`@media (prefers-reduced-motion: no-preference)` の中だけで0.6秒の拡大アニメーション。旧画面用の `.result-stats` の扱いはTask 3で決めるので、ここでは触らない。
- [ ] **Step 7: E2Eを追記** — 既存テストのダイアログ確認の後に、`await expect(dialog.getByRole("slider")).toBeInViewport()` と、`dialog.locator(".is-prediction")` が「Aurora」を含むことを確認する（1440×900のPC設定のまま）。
- [ ] **Step 8: 検証** — `pnpm --filter regatta-web test && pnpm --filter regatta-web build && pnpm --filter regatta-web test:e2e` がすべてPASS。
- [ ] **Step 9: コミット**

```bash
git add apps/regatta-web/src/presentation.ts apps/regatta-web/src/presentation.test.ts apps/regatta-web/src/ObserverApp.tsx apps/regatta-web/src/style.css apps/regatta-web/e2e/spectator.spec.ts
git commit -m "Lead the race result with the prediction outcome and finish order"
```

---

### Task 2: 予想艇の強調・先頭との差・計器と判断ログ（優先度2）

**Files:**
- Modify: `packages/sailing-sim/src/fleet.ts:331-343`, `packages/sailing-sim/src/index.ts`（公開されていなければ）
- Test: `packages/sailing-sim/test/fleet.test.ts`
- Modify: `apps/regatta-web/src/presentation.ts`, `presentation.test.ts`, `ObserverApp.tsx`（順位表・判断ログ・計器）, `style.css`

**Interfaces:**
- Produces（sailing-sim）: `export function fleetRemaining(boat: Boat): number` — 現在 `fleetRanking` 内にある `remaining` をそのまま移す。完走艇は `-1`。`fleetRanking` はこれを使う。
- Produces（presentation）:
  - `export type StandingRow = { id: string; rank: number; isPrediction: boolean; finishTime: number | null; gapMeters: number | null };`
  - `export function standings(race: FleetRace, prediction: string | null): StandingRow[]` — 並び順は `fleetRanking(race)`。`gapMeters` は未完走艇だけ、未完走艇の中で残距離が最小の艇との差を `Math.round` した値（その艇は `0`）。完走艇は `null`。
  - `export type TacticKind = "hold" | "maneuver" | "pressure" | "mark";`
  - `export function tacticKind(selected: string): TacticKind` — `hold_course`→`hold`、`tack_now`/`jibe_now`→`maneuver`、`seek_visible_pressure_*`→`pressure`、`approach_mark`/`head_to_finish`→`mark`。

- [ ] **Step 1: sailing-simのテストを書く** — `fleetRemaining(完走艇) === -1`。`createFleetRace` 直後の任意の2艇で `fleetRanking` の順序が `fleetRemaining` の昇順と一致すること。
- [ ] **Step 2: FAILを確認** — `pnpm --filter sailing-sim test`。
- [ ] **Step 3: `fleetRemaining` を切り出して公開**し、`fleetRanking` から使う。
- [ ] **Step 4: PASSを確認** — `pnpm --filter sailing-sim test && pnpm --filter sailing-sim build`。既存の43テストも全件通ること。
- [ ] **Step 5: presentationのテストを書く**

```ts
it("ranks with gaps to the leading unfinished boat and flags the prediction", () => {
  const rows = standings(createFleetRace(1, "steady"), "coral");
  expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  expect(rows[0].gapMeters).toBe(0);
  expect(rows.every((r) => r.gapMeters !== null && r.gapMeters >= 0)).toBe(true);
  expect(rows.filter((r) => r.isPrediction).map((r) => r.id)).toEqual(["coral"]);
});
it("shows finish time for finishers and no gap for unfinished boats after timeout", () => {
  // createFleetRace の結果を複製し、boats[0] に finishTime: 80, leg: "finished"、status: "timed_out" を設定
  // → その艇の行は finishTime 80・gapMeters null、ほかの艇は gapMeters が数値
});
it("classifies tactics", () => {
  expect(tacticKind("hold_course")).toBe("hold");
  expect(tacticKind("jibe_now")).toBe("maneuver");
  expect(tacticKind("seek_visible_pressure_gust_3")).toBe("pressure");
  expect(tacticKind("head_to_finish")).toBe("mark");
});
```

`createFleetRace(seed, scenario)` の順（`packages/sailing-sim/src/fleet.ts:67`）。
- [ ] **Step 6: FAILを確認 → 実装 → PASSを確認**（`pnpm --filter regatta-web test -- presentation`）。
- [ ] **Step 7: 順位表を変える** — `standings()` で描画する。右側は、完走艇なら `clock(finishTime)`、先頭は `text.leader`、ほかは `+{gap} m`。予想艇の行は `.is-prediction`（左に艇色の3pxの縦線と `text.yourPick` の札）。文言 `leader`：ja「先頭」、en「Leader」。注記 `rankNote` はそのまま。
- [ ] **Step 8: 判断ログを変える** — 各 `.decision-item` に `data-kind={tacticKind(log.selected)}` と、予想艇なら `.is-prediction` を付ける。`hold` は文字色を弱め、`maneuver`/`pressure`/`mark` は種類の色の小さなアイコン（↺・≋・⚑のテキスト記号。画像は使わない）を付ける。出所はバッジ `.source-badge.source-{decider|preview|fallback}` にし、状態を続けて書く。最小11px。
- [ ] **Step 9: 計器帯を変える** — 列の順番を「残り時間（最大）」「予想艇の暫定順位（`n / 4`、大）」「追従艇の艇速」「真風」「針路」「判断エンジン」にする。タック数は外す。艇速・針路のラベルを `{追従艇名} の艇速` のように追従艇名付きにする（文言 `speedOf`：ja「{name}の艇速」、en「{name} speed」。`{name}` を置換）。予想がない（出走前）ときの順位欄は「—」。文言 `predictedRank`：ja「予想艇の順位」、en「Your pick」。
- [ ] **Step 10: E2Eを追記** — 出走後、`.fleet-standing .is-prediction` が「Aurora」を含むこと。Jadeを追従しても `.is-prediction` はAuroraのままであること。
- [ ] **Step 11: 検証** — `pnpm --filter sailing-sim test && pnpm --filter regatta-web test && pnpm --filter regatta-web build && pnpm --filter regatta-web test:e2e`。
- [ ] **Step 12: コミット** — `Highlight the predicted boat and show gaps to the leader`。

---

### Task 3: デザイントークン・文字サイズ・コントラスト（優先度3）

**Files:**
- Create: `apps/regatta-web/src/legacy.css`, `apps/regatta-web/src/style.test.ts`
- Modify: `apps/regatta-web/src/style.css`, `apps/regatta-web/src/App.tsx`（`import "./legacy.css";` のみ）, `apps/regatta-web/src/main.tsx`（テーマ）, `apps/regatta-web/DESIGN.md`

**Interfaces:**
- Produces: `style.css` の `:root` に以下のトークン。後続タスクはこれだけを使い、色を直書きしない。

| トークン | 値 | 用途 |
| --- | --- | --- |
| `--ink` | `#102f43` | 本文・数値 |
| `--text-muted` | `#4b6573` | 注記・ラベル（`#f5fbf9` 上で5.88:1、`#e2eef0` 上で5.2:1） |
| `--surface` | `#f5fbf9` | パネルの下地（不透明度は既存どおり各所で `color-mix` か8桁hex） |
| `--surface-selected` | `#e2eef0` | 選択行 |
| `--line` | `#cedee2` | 区切り線 |
| `--brand` | `#244d61` | 主ボタン・選択中 |
| `--accent` | `#ef8354` | 的中・注目 |
| `--on-sea` | `#e9f5f6` | 海上の文字 |
| `--scrim` | `#1d4b5cd9` | 海上の文字の下敷き（不透明時の `--on-sea` は7.04:1） |
| `--fs-xs` / `--fs-sm` / `--fs-md` / `--fs-lg` / `--fs-xl` | `11px` / `12px` / `14px` / `17px` / `22px` | 文字サイズ（計器の大数字は個別に指定可） |
| `--radius-sm` / `--radius-md` | `6px` / `10px` | 角丸 |

- [ ] **Step 1: 旧画面用CSSを分ける** — `style.css` から旧操船画面（`App.tsx`）だけが使うセレクタ（`.trim-control` `.helm-actions` `.sheet-labels` `.model-notice` `.weather-help` `.opponent-switch` `.sea-caption` `.player-key` `.rival-key` `.result-stats` `.track-large` `.render-notice` と、それらのメディアクエリ内の定義）を `legacy.css` へ移し、`App.tsx` から読み込む。移す前に `grep -n "className" src/ObserverApp.tsx` で観戦画面が使っていないことを確認する。
- [ ] **Step 2: 失敗するテストを書く**（`style.test.ts`、node環境で `readFileSync(new URL("./style.css", import.meta.url), "utf8")`）
  - `:root` の `--text-muted` と `--surface`・`--surface-selected` のコントラスト比が4.5以上。`--on-sea` と `--scrim` の不透明色（先頭6桁）が4.5以上。比はWCAGの相対輝度で計算する（ヘルパーはテストファイル内に置く）。
  - `style.css` の `font-size: Npx` がすべて11以上。
  - `:root` 以外に `#` で始まる色リテラルが残っていない（`rgba(` も同様）。例外は艇色を受け取る `style={{...}}` 側なのでCSSには出てこない。
- [ ] **Step 3: FAILを確認** — `pnpm --filter regatta-web test -- style`。
- [ ] **Step 4: トークンを定義し、`style.css` の色・文字サイズ・角丸をトークンに置き換える。** 8〜10pxの文字は `--fs-xs` 以上へ。海上の文字（`.keyboard-strip` `.rules-note` `.sea-footer` `.app-footer` `.wind-dial small`）には `--scrim` の下敷き（角丸 `--radius-sm`、左右8px・上下4pxの余白）を付ける。
- [ ] **Step 5: PASSを確認**し、`pnpm --filter regatta-web build` も通す。
- [ ] **Step 6: MUIテーマを合わせる**（`main.tsx`）— `primary.main` を `--brand` と同じ `#244d61`、`secondary.main` を `#ef8354`、`text.secondary` を `#4b6573` にする（CSS変数はMUIのパレット計算に使えないため値を写す。DESIGN.mdに「`main.tsx` と `:root` を同時に変える」と書く）。
- [ ] **Step 7: 目視確認** — `pnpm --filter regatta-web dev` で出走前・レース中・結果を1440×900と390×844で見て、文字が重なっていないこと、海上の文字が読めることを確認。画面写真は撮ってPRに付ける。
- [ ] **Step 8: DESIGN.mdに「トークンと下限」の節を追加**（上の表、11px下限、4.5:1、海上の文字は下敷き必須）。
- [ ] **Step 9: 検証とコミット** — `pnpm --filter regatta-web test && pnpm --filter regatta-web build && pnpm --filter regatta-web lint && pnpm --filter regatta-web test:e2e && pnpm exec biome check apps/regatta-web` → `Unify colors and type sizes into tokens with readable contrast`。

---

### Task 4: 3D上の艇名ラベルと予想艇の印（優先度4）

**Files:**
- Modify: `apps/regatta-web/src/presentation.ts`, `presentation.test.ts`, `scene.ts`, `runtime.ts`（`SceneRuntime`）, `style.css`

**Interfaces:**
- Consumes: Task 3のトークン。
- Produces:
  - `export function labelPosition(ndc: { x: number; y: number; z: number }, width: number, height: number): { x: number; y: number } | null` — `THREE.Vector3.project(camera)` 後の正規化座標から画面のpx位置を返す。`z` が `[-1, 1]` の外、または `|x| > 1.05`・`|y| > 1.05` なら `null`。
  - `SceneRuntime` に `prediction?: string | null` を追加（`FleetRuntime` は既に `prediction` を持つので型だけ）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("maps the view center to the middle of the canvas", () =>
  expect(labelPosition({ x: 0, y: 0, z: 0.5 }, 800, 600)).toEqual({ x: 400, y: 300 }));
it("hides labels behind the camera or outside the view", () => {
  expect(labelPosition({ x: 0, y: 0, z: 1.2 }, 800, 600)).toBeNull();
  expect(labelPosition({ x: 1.3, y: 0, z: 0.5 }, 800, 600)).toBeNull();
});
```

- [ ] **Step 2: FAILを確認 → `labelPosition` を実装**（`x = (ndc.x + 1) / 2 * width`、`y = (1 - ndc.y) / 2 * height`）**→ PASSを確認。**
- [ ] **Step 3: `scene.ts` にラベルを付ける** — `mountScene` で艇ごとに `div.boat-label`（`aria-hidden="true"`。中身は艇色の点と名前、予想艇なら `.is-prediction` と★）を `host` に追加。描画ループで艇の位置＋マスト上（y+7）を `project(camera)` → `labelPosition` → `transform: translate(...)`、`null` なら `hidden`。名前と色は `FLEET` から取る。追従・艇上視点では追従艇のラベルを出さない（艇そのものが大きく見えるため）。dispose時にラベルのDOMを取り除く。
- [ ] **Step 4: CSS** — `.boat-label` は `--scrim` 下地・`--on-sea` 文字・`--fs-xs`・`pointer-events: none`・`position: absolute; left: 0; top: 0`。`.is-prediction` は `--accent` の枠。
- [ ] **Step 5: 目視確認** — 俯瞰で4艇の名前が読め、画面外の艇のラベルが端に張り付いたり反対側に出たりしないこと。画質「軽量」でもfpsが極端に落ちないこと（変更前後のfps表示を記録）。
- [ ] **Step 6: 検証とコミット** — test・build・lint・e2e → `Label boats on the water and mark the predicted boat`。

---

### Task 5: 操作パネルの並び替え・終了確認・接続表示（優先度5）

**Files:**
- Modify: `apps/regatta-web/src/ObserverApp.tsx:636-796`, `style.css`
- Test: `apps/regatta-web/e2e/spectator.spec.ts`

**Interfaces:**
- Consumes: Task 3のトークン。

- [ ] **Step 1: E2Eを先に書く**（新しい `test(...)` を2つ）
  - `asks before ending a race`：出走 →「レースを終了」→ 確認ダイアログが出て、レースは `レース中` のまま →「観戦を続ける」で閉じる → もう一度「レースを終了」→「終了する」で結果画面が出る。
  - `closes the end confirmation when the race finishes on its own`：`await page.clock.install()` の後に出走 → 確認ダイアログを開く → `page.clock.runFor(200_000)` で時間切れまで進める → 確認ダイアログが消え、結果ダイアログが1つだけ見えること。シミュレーションの進行が `requestAnimationFrame` の時刻に依存しているため、`clock` で進まない場合はこのテストを実ブラウザーでの手動確認に切り替え、その旨をPRに書く。
  - 既存テストの「レースを終了」クリックの後に「終了する」のクリックを追加する。
- [ ] **Step 2: FAILを確認** — `pnpm --filter regatta-web test:e2e`。
- [ ] **Step 3: 終了確認を実装** — `confirmEnd` のstateとMUIの小さい `Dialog`。文言 `endConfirm`：ja「レースを終了しますか？予想の判定は行われません。」en「End the race? Your prediction will not be scored.」、`keepWatching`：ja「観戦を続ける」en「Keep watching」、`endNow`：ja「終了する」en「End race」。確認ダイアログを開いても一時停止はしない。`terminal` になったら `confirmEnd` を `false` にする（既存の `useEffect([terminal])` に追加）。
- [ ] **Step 4: パネルの並びを変える** — 出走前：見出し → 予想の4艇 → 出走ボタン → `<details className="race-settings">`（`<summary>` は `text.settings`：ja「レースの設定」en「Race settings」。中に判断エンジン、接続状態、海面の条件）。レース中・終了後：見出しを隠し、「あなたの予想」→ 操作ボタン → 順位表。`details` は実モデルが未接続でユーザーが `decider` を選べない場合も開いて操作できること。
- [ ] **Step 5: 接続状態をバッジにする** — `<span className="engine-status status-{health}">` に色の点と `text.ready`/`text.loading`/`text.offline`/`text.signedOut`/`text.workerStopped`。「モデル接続を確認」は `variant="outlined"` にする。
- [ ] **Step 6: PASSを確認** — `pnpm --filter regatta-web test:e2e`。既存テストも通ること。
- [ ] **Step 7: 目視確認**（1440×900で出走ボタンがスクロールなしで見えること、390×844でパネルが崩れないこと）**とコミット** — `Put the prediction first and confirm before ending a race`。

---

### Task 6: 押しやすさとコース図（優先度6）

**Files:**
- Modify: `apps/regatta-web/src/style.css`, `ObserverApp.tsx`（コース図の拡大）
- Test: `apps/regatta-web/e2e/spectator.spec.ts`

- [ ] **Step 1: E2Eを書く** — 390×844のビューポートで `.view-switch button` と `.fleet-standing button` の `boundingBox().height` が44以上。1440×900では `.view-switch button` が36以上。
- [ ] **Step 2: FAILを確認。**
- [ ] **Step 3: CSSを直す** — `.view-switch button` は `min-height: 36px`、680px以下で44px。`.fleet-standing button` と `.prediction-options button` は `min-height: 44px`。
- [ ] **Step 4: コース図を大きくする** — 通常幅を200pxにし、`.course-chart` を `<button>` にして押すと `.course-chart.is-expanded`（幅360px、`aria-expanded`）に切り替える。高さ850px以下のPCで隠している既存の指定は、判断ログと重ならない位置へ移したうえで外せるか確認し、重なる場合は隠したままにする。
- [ ] **Step 5: PASSを確認**し、`pnpm --filter regatta-web build` を通す。
- [ ] **Step 6: コミット** — `Enlarge touch targets and the course chart`。

---

## 完了時の確認

- [ ] `pnpm --filter sailing-sim test && pnpm --filter sailing-sim build`
- [ ] `pnpm --filter regatta-web test && pnpm --filter regatta-web build && pnpm --filter regatta-web lint && pnpm --filter regatta-web test:e2e`
- [ ] `pnpm exec biome check .`、`pnpm check:quality`、`git diff --check`（既存の警告と新しい失敗を区別する）
- [ ] ルールのプレビューで1レースを最後まで観戦し、出走前・レース中（追従・俯瞰）・結果・英語表示の画面写真を撮る。実モデルでの確認は別途（この計画は表示だけの変更）。
- [ ] `docs/reviews/` に検証記録を残し、スマホ実機での確認が未実施ならそう書く。
