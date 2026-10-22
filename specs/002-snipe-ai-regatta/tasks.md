# Tasks: Snipe AI Regatta

2026-10-22。spec/plan/research/data-model/contractsを入力とする。今回は実装開始。
チェックは実装と検証の証拠が揃った場合のみ付ける。G1の本人評価、G2の実モデル速度、G3の対戦比較、AWSは別のゲート。

## Phase 1 — Setup

- [ ] T001 `packages/sailing-sim/package.json` と `apps/regatta-web/package.json` にworkspaceと依存を設定する。
- [ ] T002 [P] `apps/regatta-web/DESIGN.md` に練習画面の配色・文字・レイアウトとG1の範囲を記録する。
- [ ] T003 `specs/002-snipe-ai-regatta/quickstart.md` に実行方法と未実装の境界を更新する。

## Phase 2 — Foundation

- [ ] T004 `packages/sailing-sim/src/types.ts` に版・単位・艇・風・レース状態を定義する。
- [ ] T005 `packages/sailing-sim/src/math.ts` と `wind.ts` に角度・決定的な風・可視ブローを実装する。
- [x] T005a 時間変化する海面を追加し、20秒周期の滑らかな風・可視ブロー・pause・版付き再生・未来情報除外を検証する（`weather.test.ts`、`runtime.test.ts`）。
- [ ] T006 `packages/sailing-sim/test/simulation.test.ts` に風上失速・風向境界・タック損失・回航の振る舞い検証を作る。

## Phase 3 — US1 操船できる練習（P1 / 最初のMVP）

単体の練習コースで、舵・帆・タック・回航・停止を試せること。

- [ ] T007 [US1] `packages/sailing-sim/src/boat.ts` に真風ポーラ、見かけ風トリム、旋回、タック／ジャイブを実装する。
- [ ] T008 [US1] `packages/sailing-sim/src/race.ts` に回航・ゴール・接触・180秒終了を実装する。
- [ ] T009 [US1] `apps/regatta-web/src/runtime.ts` に固定tick、入力、pause、非表示停止、再戦を実装する。
- [ ] T010 [US1] `apps/regatta-web/src/scene.ts` にThree.jsの艇・風・マーク・航跡とGPU解放を実装する。
- [x] T010a [US1] 本人依頼で海上描画を先行改善。`ocean.ts`・`boat-visual.ts`で波・空・光・帆・引き波を追加し、全面UI・艇上視点・軽量設定と物理からの分離を検証する。G1/G2合格やAWS公開とは別。
- [ ] T011 [US1] `apps/regatta-web/src/App.tsx` に日英UI、計器、舵・帆・タック・視点・終了を実装する。
- [ ] T012 [US1] `apps/regatta-web/src/runtime.test.ts` に停止・復帰・再戦・フレーム落ちの検証を追加する。
- [ ] T013 [US1] `apps/regatta-web/e2e/practice.spec.ts` に操作・シナリオ・途中終了・再戦のブラウザー検証を追加する。
- [ ] T014 [US1] `docs/reviews/2026-10-22-regatta-g1.md` に本人による一定風・振れ・ブローのG1評価を記録する。

## Phase 4 — US2 AIとの対戦（P1）

固定ルールの練習艇と実Deciderを区別し、同じ観測・艇性能で戦術を実行する。

- [ ] T015 [US2] `packages/sailing-sim/src/tactics.ts` に未来情報を除いた観測、候補制限、戦術から操船への接続を実装する。
- [ ] T016 [US2] `packages/sailing-sim/test/tactics.test.ts` に候補外・未来漏れ・選択による航路差の検証を追加する。
- [ ] T017 [US2] `apps/regatta-web/src/runtime.ts` に明示された固定ルール練習艇を接続する（実モデル艇として表示しない）。
- [ ] T018 [US2] `apps/regatta-worker/` に既存の型付きDecider出力検証を抽出し、新しい問いとoffline評価ハーネスを実装する。
- [ ] T019 [US2] `docs/reviews/2026-10-22-regatta-g2.md` に実Decider100判断の遅延・候補外・状態サイズを記録する。
- [ ] T020 [US2] `specs/002-snipe-ai-regatta/contracts/openapi.yaml` の内側・応答型を厳密化し `packages/api-spec/openapi.yaml` に正本化する。
- [ ] T021 [US2] `apps/regatta-api/` にCognito所有権・quota・lease・原子的受付・冪等・pause/終了を実装する。
- [ ] T022 [US2] `apps/regatta-worker/` に配送・期限・重複・終了後の結果抑止を実装する。
- [ ] T023 [US2] `apps/regatta-web/` に生成クライアントと期限・epoch付きの実モデル対戦を接続する。
- [ ] T024 [US2] `docs/reviews/2026-10-22-regatta-g3.md` に同条件20組の実モデル対ルール艇を記録する。

## Phase 5 — US3 振り返り（P2）

合成記録だけでも航跡と操作を再生でき、モデル再呼び出しを行わないこと。

- [ ] T025 [US3] `packages/sailing-sim/src/replay.ts` に入力・状態の版付き記録、再生、サイズ制限を実装する。
- [ ] T026 [US3] `apps/regatta-web/src/App.tsx` に結果・航跡・時点選択・記録のローカル書き出しを追加する。
- [ ] T027 [US3] `apps/regatta-api/` に分割記録・manifest固定・削除失敗の扱いを実装する。
- [ ] T028 [US3] `apps/regatta-worker/` に1回だけのBedrock解説と参照ID検証を実装する。

## Phase 6 — 検証と公開準備

- [ ] T029 `.github/workflows/ci.yml` に新workspaceの検証を追加しKnip・重複検出を確認する。
- [ ] T030 `docs/reviews/2026-10-22-regatta-local-validation.md` に自動検証・画面確認・残るゲートを分けて記録する。
- [ ] T031 `apps/cdk/` に新スタックを作り、画像関連を除いた最小IAM・停止・予算を検証する。
- [ ] T032 `docs/operations.md` に最新価格・旧利用分を含む残予算・新環境の停止と削除を記載してからAWS検証へ進む。
- [ ] T033 `docs/demo-script.md` と `docs/article/` を実モデルの実行証拠に基づき新企画へ更新する。

## 依存・実行順

T001〜T006 → US1（T007〜T014）→ US2の実環境接続 → US3の生成解説 → AWS。
T015〜T019とT025のローカル基盤はUS1の評価待ちでも準備できる。G1/G2未達のまま装飾強化や再デプロイを行わない。
T002は設定後に他の実装と並行可能。US1の物理テストとUIテストは別ファイル、US3の再生テストは保存APIと独立。
各段階で動く成果物を検証し、未実装を完了扱いしない。hooks設定は存在せず、before/after tasksの実行対象なし。
