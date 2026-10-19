# 修正計画：完成度レビュー R1〜R7

作成日：2026-10-19（JST）／確認したHEAD：`4d495f0`（`main`）。
状態：**2026-10-19にローカル実装・検証を実施**。当初の計画案を以下に保持する。実際の結果とAWS未検証項目は [検証記録](../../docs/reviews/2026-10-19-remediation-validation.md) と tasks.md の T117〜T124 を参照。
入力：[2026-10-18レビュー](../../docs/reviews/2026-10-18-completion-review.md)、[機能仕様](spec.md)。

## Summary

7件を、再現テスト・実装・受け入れテスト・文書更新の単位で修正する。本書は既存の
[plan.md](plan.md)への追補案であり、Spec Kitのplanコマンドを実行した成果物ではない。
着手時に差分を `spec.md` → `plan.md` / `data-model.md` / `research.md` / `contracts/`
→ `tasks.md` へ反映し、既存のタスクIDと完了記録を維持する。

**推奨順：R6 → R3 → R4 → R1 → R2 → R5 → R7の最終確認。**
R7の文書修正とCI準備は各変更に同梱する。R5はR2に依存せず、先に完了してもよい。
最優先の利用者向け修正はR1〜R4だが、モックと保存処理を先に直して検証基盤を整える。

対象外：技術スタック刷新、モデル変更、Vite+移行、新規有料サービス、公開・CFP提出。
R2で導入する新しい状態・API・保持データは、以下の計画上の提案であって既存の採用済み仕様ではない。

## Technical Context

技術選定の参照元は [docs/tech-stack.md](../../docs/tech-stack.md)。状態欄の古い記述はR7で更新する。

| 領域 | 維持する構成 | 今回の変更 |
| --- | --- | --- |
| Frontend | React 19、TypeScript、Vite、MUI、TanStack Query、日英辞書 | 制約の入力、確認質問のフォーム、取消・通信状態、モック初期化 |
| 契約 | OpenAPI 3.0.3 YAML、Connexion 3、Orval | YAMLを先に変更しクライアントを再生成。生成コードを手編集しない |
| API / Worker | Python 3.12、uv、Flask/Connexion＋Mangum、既存CPUワーカー | 原子的な受付、確認回答のジョブ、削除結果の確認 |
| 保存 / 配送 | DynamoDB、S3、SQS、既存の再配送・回収Lambda | トランザクション、短命な確認用コンテキスト、削除失敗の監視 |
| 推論 | Bedrock Nova Lite、Strands Decider 2B | 観察済み情報の限定再利用。選択とガードの分担は維持 |
| 検証 | pytest＋moto、Vitest＋Testing Library、Jest/CDK assertions | 障害・競合・画面連携の回帰テスト。少数のブラウザE2Eを追加 |
| ツール | pnpm 10.32.1、uv、Biome、Oxlint、Knip、jscpd | 既存設定の修正とCI追加。依存はlockfileで固定 |

回数上限は変更2回、解析受付3回、アップロード枠6回を維持する。回答後に新たな判断ジョブを
実行する場合も解析受付1回に含め、確認質問を無制限推論の抜け道にしない。
実モデルの性能・費用・品質は回帰テストの成功と別に記録する。

## Constitution Check

| 原則 | 修正で守ること | 完了判断に必要な証拠 |
| --- | --- | --- |
| ハッカソン準拠 | Bedrock生成、Deciderの意味のある選択、実際の処理への接続を維持 | 判断記録と実行処理の一致。公式Rulesと提出成果物の応募前確認 |
| 低コスト | 自動の有料POST再送を避け、確認回答にも回数上限を適用 | 二重配送・通信断・連打時のジョブ数、推論呼び出し数、利用枠のテスト |
| 認証・プライバシー | 新APIにもCognito JWTと所有権確認。写真・自由文をログへ出さない | 未認証・他ユーザー・終了後・期限切れの拒否、削除とログの検証 |

2026-10-19に公式Rulesの再取得を試みたが、取得エラーで本文を再確認できなかった。
本計画は憲章の既存要件を維持し、最新規約への準拠確認が完了したとは扱わない。
有料の検証は既存予算・利用制限と停止手順の範囲で、ローカル検証後に別工程として行う。

## 作業単位と依存関係

| 作業ID | 対応 | 変更単位 | 依存 | 相対規模 |
| --- | --- | --- | --- | --- |
| RP-00 | 全体 | 再現条件と仕様差分を記録、既存テストの基準値を取得 | なし | 小 |
| RP-01 | R6 | StrictMode下のモック初期化・シナリオ切替 | RP-00 | 小 |
| RP-02 | R3 | Storeのトランザクションと解析受付の一括保存 | RP-00 | 大 |
| RP-03 | R4 | 通信期限・エラー表示・終了と遅延応答の抑制 | RP-01、RP-02と再送仕様を共有 | 中 |
| RP-04 | R1 | 禁止事項UI→API→ガードの接続 | RP-01 | 中 |
| RP-05 | R2 | 確認待ち状態・回答API・回答後の判断 | RP-02〜04 | 大 |
| RP-06 | R5 | S3部分失敗の集計・再試行・監視 | RP-00 | 中 |
| RP-07 | R7 | Knip、CI、文書の同期 | 各変更で進め、RP-01〜06後に確定 | 中 |
| RP-08 | 全体 | ブラウザE2E、AWS受け入れ検証、検証記録 | RP-01〜07 | 中 |

相対規模は工数保証ではない。特にRP-05は単なる画面修正として見積もらない。
各作業は独立したPRを基本とし、R2は「契約・API・worker」と「画面・通し検証」に分けてもよい。
機能の一部だけが公開されないよう、デプロイは後述の切替手順でまとめる。

## R6 / RP-01：モックを一つの実行環境に揃える

**対象：** `apps/frontend/src/{main.tsx,App.tsx,config.ts,api/custom-fetch.ts,mock/mock-api.ts}`、`App.test.tsx`。

- AppのuseState初期化内から `setFetchImplementation` の副作用を取り除く。
- エントリーポイントで `createAppRuntime`（仮称）を一度生成し、解決済みconfigと同じmockを
  API通信・署名付きアップロード・MockBannerへ渡す。Reactのrender開始前に通信先を確定する。
- 既存の生成クライアント用通信層は維持できる。テストは同じ初期化関数を使い、終了時に通信先と
  QueryClientをリセットする。単にStrictModeを外したり、effectの順序に依存して解決しない。

**受け入れ条件：** StrictModeで通常・確認質問・撮影条件・終了のシナリオを切り替え、
選択とAPI応答が一致する。モックの署名付きアップロードを含め、外部AWS通信は0件。
異なる設定のテスト間で状態が漏れない。

## R3 / RP-02：解析受付を原子的に保存する

**対象：** `packages/photoprep-common/src/photoprep_common/store.py`、
`apps/api/src/photoprep_api/services/analysis.py`、APIのstore・atomic_guards・review_fixesテスト、
`apps/cdk/lib/constructs/api.ts`。共通Storeを使うworkerのテストも対象。

### 保存の境界

Storeに必要最小限のトランザクション操作を追加し、DynamoStoreとInMemoryStoreを同じ契約で検証する。
解析要求では次の4レコードの変更を一括で行う。

| レコード | 書き込みと条件 |
| --- | --- |
| IDEM | 未作成の場合だけ、jobId・正規化リクエストのfingerprint・有効期限を保存 |
| UPLOAD | 所有者・session・phase・期限・未使用を確認し、使用済みへ |
| SESSION | 所有者・同意・期限・期待状態・残り回数を確認し、ANALYZING、activeJobId、analysesUsed＋1を保存 |
| JOB | 未作成の場合だけPENDING_DISPATCHで作成。復旧用prevStateと索引を含める |

同一アイテムへの条件はそのUpdate/Putにまとめ、別のConditionCheckを重ねない。
トランザクション成功後だけSQSへ送信する。SQS送信失敗は既存の再配送処理で扱う。
受付停止との競合を防ぐサービス状態の条件確認も、別アイテムとしてトランザクションへ組み込む。
トランザクションに必要なテーブル上のIAM操作が許可されることをCDKの合成結果で確認する。

### 再送と復旧

- 同一キー・同一入力：所有権を確認し、実在する同一ジョブを返す。同一キー・異なる入力：409。
- 同じUPLOADを異なるキーで同時送信：成功は一つ。敗者は409、利用枠の増加も一つ。
- AWS応答が失われた場合：IDEM/JOBを強整合読み取りして確定結果を調べる。
  応答不明を即座に失敗扱いして返金・予約解除しない。
- SDKのClientRequestTokenを使う場合は、同一のトランザクション内容を再送する。
  時刻やjobIdが変わる別リクエストへ同じトークンを流用しない。10分の有効期間だけに頼らず、
  アプリのIDEMを既存の保持期間で維持する。
- workerの結果適用・復旧はactiveJobIdと期待状態を条件にして、古いジョブが別の実行を戻さないようにする。
- 既存のIDEMだけが残った不整合は、まず運用用の読み取り診断で検出する。
  実行履歴が不明なら自動再推論しない。対象を終了扱いにして再開始を案内する手順を文書化し、
  既存データを一括消去する移行は行わない。

**受け入れ条件：** 保存前失敗なら4レコードとも未変更、成功なら全件存在する。
応答喪失・同時要求・SQS送信失敗でもジョブ/利用枠は一つで、復旧後の再配送が可能。
メモリ実装とmotoで同じ不変条件を確認し、AWSで競合・権限も検証する。

セッション作成にも同型の部分保存があるため、同じPR群で確認する。IDEM・SESSION・利用枠・同意を
一括確定できるようにする場合は別コミットに分け、失敗時に利用枠だけ増えないことを追加検証する。

## R4 / RP-03：通信が止まっても終了できる状態にする

**対象：** `features/session/{useAnalysis.ts,SessionFlow.tsx}`、`screens/{TrialCapture.tsx,TryOne.tsx}`、
`api/{custom-fetch.ts,upload.ts}`、関連辞書・テスト（すべて `apps/frontend/src/` 以下）。

- アップロードとAPI要求にAbortSignalを渡す。解析受付後の60秒期限は、取得データの更新とは
  独立したタイマーで管理する。各HTTP要求の期限は初期案15秒、S3送信は30秒として設定化する。
  これらは新しい初期設定案であり、実機通信で調整する。
- 取得エラーを扱う：401は既存の再認証経路、403/404は取得不可、429は上限案内、
  通信断/5xxは再確認可能な表示にする。自動有料POST再送はしない。
- `idle / uploading / waiting / timeout / failed / done / cancelled` を明確にし、
  timeout・failedからの「結果を確認」は同じjobIdのGETだけにする。
- 解析POSTの応答だけ失われた場合は、uploadId・phase・Idempotency-Keyをメモリに維持する。
  明示的な「受付を確認」で同じPOSTを再送する。新しい画像・キーを勝手に発行しない（RP-02が前提）。
- 終了時はrunの世代IDを無効にし、対象queryをcancel、ローカル写真URLを解放して画面を終了させる。
  feedbackの応答を待ってから終了する現在の順序を改め、DELETEは独立した期限付き処理にする。
- 中断は外部推論の取消保証ではない。サーバーには終了を通知し、workerは終了後の結果を破棄する。
  DELETEを確認できない場合は削除完了と表示せず、期限回収の案内と必要なら再送操作を示す。
- 終了・再認証・アンマウント後の遅延応答は、画面・jobId・写真状態に反映しない。

**受け入れ条件：** 最初のGETから失敗、永遠に応答しない通信、途中の5xx、期限直前の完了を
fake timerで検証。送信中/待機中でも終了でき、終了後の新規POSTと助言再表示は0件。
再確認で解析枠は増えない。ブラウザを閉じずに通信断から抜けられる。

## R1 / RP-04：禁止事項を確定してから撮影する

**対象：** `screens/Consult.tsx`、`features/session/SessionFlow.tsx`、日英辞書、モック、
`services/session.py`、workerの `guards.py` / `explain.py`、関連テスト。

- 既存のRestriction enumを使い「眉に触れない」「眉の形を変えない」「前髪に触れない」を
  MUIの選択UIにする。ConsultResultとcreateSessionへrestrictionsを渡す。
- 自由文は希望の補足とし、適用する禁止事項を選択済み一覧で本人に確認してもらう。
  自由文の意味を完全にコードで解釈できるとは説明しない。自然言語からの自動抽出は今回導入しない。
- 重複は正規化し、不明enumは契約検証で拒否する。no_touchとkeep_shapeの併記は
  より強いno_touchを優先し、制限を黙って解除しない。
- 対象の両方が禁止なら、変更を提案しないまま終了できる導線を設ける。
  scopeと禁止が衝突する場合は、許可された対象の再選択か終了へ接続する。
- `keep_brow_shape` は選択ガードだけでなく説明文の検証まで扱う。
  既存の語句検査で防げる範囲と、任意の言い換えへの限界は区別し、完全保証とは書かない。

**受け入れ条件：** UIで選んだenumがAPI保存値とworker入力に一致する。
fake Deciderが禁止対象のgrooming_tipを選んでも、禁止する助言は表示されない。
形の変更を含む説明文をfake Bedrockが返した場合も拒否する。正常な毛流れの提案は妨げない。
日本語・英語、未選択、全禁止、自由文との矛盾を確認する。

## R2 / RP-05：確認質問を回答可能な処理へ接続する

**対象：** OpenAPI YAML、API `handlers/` / `services/`、共通 `states.py`、workerの
`schemas.py` / `explain.py` / `pipeline.py`、フロントのSessionFlowと新しい確認フォーム、
モック、CDKのAPIルート、契約・認可・状態遷移テスト。

### 契約と状態の変更案

- サーバー状態に `CLARIFYING`、画面には既存の相談画面内の確認用状態を追加する。
  `capture_setup_tip` と分離し、質問を表示しただけで再撮影へ進めない。
- Adviceへclarify時の構造化情報を追加する：`clarificationId`、`reason`、`allowedScopes`、
  `requiresDetail`。reasonは `choose_scope / specify_detail / restricted_scope` の固定enum案。
  自由なモデル文章を解析してフォームの種類を決めない。
- `POST /sessions/{sessionId}/clarifications`、operationId `answerClarification` を追加する。
  入力案は `{clarificationId, scope, detail?}`。detailは最大200文字。
  `Idempotency-Key` を必須にし、選択可能な対象・必須回答・所有権・期限・終了状態を検証する。
- 初回のrestrictionsは引き継ぎ、このAPIから解除できない。両対象が禁止なら確認ループにせず終了。
  `look_first` への戻しを回答として認めず、許可されたbrow/bangsのいずれかを選ぶ。
- 通常応答は202とJobAccepted。古い/回答済みの質問や入力変更を伴うキー再利用は409、
  他人の対象は404、未認証は401、回数上限は429。終了操作は既存DELETEを使う。
- ConnexionのHANDLERS、CDKのROUTES、JWT scope、CORS、モック、Orval生成物を同じ変更で揃える。

### 回答後の判断と費用

画像は現行どおり処理後に削除し、回答待ちのために残さない。その代わり、clarifyになったときだけ、
構造化Observationと元scope、sourceJobId、質問情報をサーバーの短命な確認用レコードへ保存する案とする。
保持する文章も個人に関するデータとして扱い、ログやDecisionRecordへ複製しない。

- 確認用レコードは10分を初期有効期限案とする。APIで期限を厳密に検査し、終了・回答成功時に削除する。
  TTLは最終回収に使うが即時削除の保証にはしない。同意文とdata-modelに利用目的・保持方針を追記し、
  追加データ保持を既存の同意で説明できなければ同意文の版を更新する。
- RP-02のトランザクションを使い、質問の一回限りの消費、回答の保存、解析枠、JOB、IDEMを一括確定する。
  終了との競合ではどちらか一方だけが成立する。
- JOBへ入力種別 `image / clarification` を追加する。旧レコードで未設定ならimageとして扱う。
  有効な観察が回答対象を覆う場合だけ再利用し、画像取得・Bedrock観察を飛ばして
  回答を含む状態でDeciderを再実行する。必要な説明生成のみBedrockを最大1回呼ぶ。
- 「まず見てほしい」で得た観察はbrow/bangsへ絞れるが、browだけの観察からbangsの状態を推測しない。
  対象範囲外や期限切れなら、回答を保存して `capture_required` を返す契約分岐を用意し、
  写真の再送が必要な理由を表示する。この分岐ではモデルを呼ばず解析枠も消費しない。
- 回答後の新規判断は解析枠1回を消費する。画像の再観察は0回、Deciderは1回、説明は最大1回。
  同じ元画像に対する回答後の再clarifyは一回までの対応で打ち切り、理由を添えて終了を案内する。
  再利用するObservationやその有効期限を延長して確認ループを続けない。
- 複数回のやり取りで比較用の解析枠が残らない場合、実行できない変更を勧めず終了へ誘導する。
  最大3解析を緩めず、残り枠による動作を仕様と画面に明記する。

期限切れ/対象変更の分岐は `200 {status: capture_required, session: ...}`、再判断は
`202 JobAccepted` としてYAMLに明示する案とする。同じキーの再送は元の応答を再現する。
確認質問は初回・別提案のbefore段階を対象にし、afterで比較可能な場合は既存の比較画面を優先する。

**受け入れ条件：** 質問表示→回答→判断状態への反映→次の支援/終了まで通る。
回答によりDeciderの入力が変わることを検証し、固定回答で進むモックだけで合格にしない。
重複回答・古い質問・禁止対象・他ユーザー・終了競合・期限切れを検証する。
再利用可能な回答では画像再送0、観察呼び出し0。再利用不能なら明示操作まで追加課金0。

## R5 / RP-06：削除結果を正しく集計し監視する

**対象：** `apps/api/src/photoprep_api/ops/sweeper.py`、`tests/unit/test_sweeper.py`、
共通ログの許可フィールド、`apps/cdk/lib/constructs/operations.ts`、運用手順。

- QuietモードでもErrorsを読み、対象キーの集合から成功/失敗を数える。
  戻り値を `attempted / deleted / failed / retried` に分け、削除件数へtoken_countを流用しない。
- 部分失敗のうち一時エラーだけ、失敗したキーに限定して最大2回追加再試行する。
  SDKのHTTP再試行との合計を把握し、Lambdaの残り実行時間を超えて繰り返さない。
  AccessDenied等は無限再試行せず失敗として残す。
- 未解決の部分失敗はメタデータだけをログへ出す。failed_countのメトリクスフィルタから
  CloudWatch Alarmを作り、既存SNSへ接続する。SweeperのLambda Errorsも既存監視へ追加する。
- 次回の定期回収でも残存物を検出する。権限不備は運用手順で調査・修正後に再実行する。
  S3 Lifecycleは最終回収であり、「24時間以内に必ず消える」という実時間保証には使わない。

**受け入れ条件：** 成功、部分失敗、全件失敗、例外、複数ページ、1,000件超、再試行後の成功を確認。
同じキーを再試行しても成功件数を二重計上しない。新しい画像や対象外prefixは削除しない。
ログに画像・ユーザー文章・生のエラー本文・オブジェクトキーを含めない。CDKテストで監視を確認する。

## R7 / RP-07：品質ゲートと文書を実装状態に合わせる

- KnipでCDKの実エントリ `apps/cdk/bin/cdk.ts`、フロント、各workspaceを認識させる。
  Orval生成ディレクトリの不要export指摘は対象を限定して設定する。uvは外部コマンドとして扱う。
- ts-node/source-map-supportはCDK起動設定との対応を確認する。用途があるものを削除して緑にしない。
  turboやplaceholderのmainなど本当に不要な項目は確認して整理する。警告全体の無効化はしない。
- `.github/workflows/ci.yml` を追加し、PR/pushでlockfile固定インストール→契約→静的検査→テスト→ビルドを行う。
  Node/pnpm/Python/uvの版を実際に成功した組で固定し、Actionsの実行権限は最小限にする。
  通常CIはAWS認証情報や実モデル重みを不要とし、課金を伴う検証や重いモデル試験は別ジョブにする。
- Orval再生成後の変更だけでなく未追跡の生成ファイルも検出する。
  `git diff --exit-code` に加え、生成ディレクトリの `git status --porcelain` が空であることを確認する。
- AGENTS、tech-stack、README（日英）、architecture、operations、quickstart、tasksを更新する。
  「採用」「実装」「ローカル検証」「AWS検証」を分け、対象コミット・日時・実行コマンドを記録する。
  前回の698件という件数は基準記録であり、今回再実行済みの数値として転載しない。
- 旧handoffやMVP案には履歴文書である旨と現行仕様へのリンクを付ける。
  package名とLICENSE表記の不一致も関連メタデータとして整理する。

### CIとローカルのコマンド

| 作業ディレクトリ | コマンド | 目的 |
| --- | --- | --- |
| repository root | `pnpm install --frozen-lockfile` | JS依存固定 |
| `apps/api`、`apps/worker` のそれぞれ | `uv sync --frozen` | Python依存固定 |
| repository root | `pnpm --filter api-spec check` | YAMLと契約の検証 |
| repository root | `pnpm --filter frontend api:check` | 再生成差分。未追跡ファイル検出も別途追加 |
| repository root | `pnpm exec biome check .` | 書き換えない整形・lint検査 |
| repository root | `pnpm --filter frontend lint` | Oxlint |
| repository root | `pnpm --filter frontend test` / `pnpm --filter frontend build` | UI回帰・型検査・ビルド |
| `apps/api`、`apps/worker` のそれぞれ | `uv run pytest` / `uv run ruff check .` | API/workerの回帰と静的検査 |
| repository root | `pnpm --filter cdk test` / `pnpm --filter cdk build` | インフラ定義と型検査 |
| repository root | `pnpm check:quality` / `git diff --check` | Knip・jscpd・差分の検査 |

これらは既存定義に基づく実装時の実行計画。今回は実行して合格を確認したものではない。
CDK synthは既存の必要contextとLambda成果物を揃え、AWS lookup不要の条件で別途確認する。

## RP-08：通し検証・切替・完了条件

### リリースを止める回帰シナリオ

1. 禁止事項を選択→写真解析→モデルが禁止対象を選んでもガードが拒否。
2. clarify→回答→回答内容が判断へ反映→次の支援または終了。必要のない再撮影は発生しない。
3. 同じ解析を二重送信、保存応答喪失、SQS失敗→ジョブ・利用枠は一つ、存在しないjobIdを返さない。
4. 取得が最初から失敗／応答しない→期限表示またはエラー表示、いつでも終了可能。
5. 終了後に成功結果が到着→写真・助言が戻らず、サーバーのDONEも巻き戻らない。
6. 一部画像の削除失敗→正しい件数とアラーム、権限復旧後の再回収。
7. 初回相談→一手実行→比較→「前が好き」→終了。日英とスマホ相当画面で通す。

既存Vitest/pytestの回帰に加えて、Playwrightを開発依存として導入し、1・2・4・7から
少数のブラウザE2Eを自動化する。画像は合成fixture、APIは制御可能なモックを使う。
モックE2EとAPI/workerの統合試験を別々に記録し、両者が同じ境界契約を満たすことを確認する。
実モデルがどの選択肢を選ぶかの評価は、固定fakeを用いるアプリの決定的な試験とは分ける。

### デプロイと互換性

- 新規受付を閉じ、実行中ジョブを処理してから停止する。旧セッションは無理に移行せず、
  必要な場合は終了・再開始を案内する。未処理の個人画像を移行資料に含めない。
- OpenAPI変更、API/workerの新しいジョブ種別と状態、CDKルートを揃えた後にフロントを公開する。
  古いworkerがclarificationジョブを画像ジョブとして処理しないよう、同時混在させない。
- PWAの更新導線で新版への切替を確認する。バージョン混在時は不明な入力を安全に拒否する。
- AWSでは新しい認可ルート、トランザクション、回答後の判断、終了・削除、監視を確認する。
  同意のある写真のみ使用し、実行回数と費用を記録して終了後にワーカーを停止する。
- ロールバック時も受付を閉じてdrainし、新ジョブを旧workerへ配送しない。旧版が新状態を理解できない
  セッションは明示的に終了する。フロントだけの巻き戻しで済ませない。

**完了条件：** 7指摘の受け入れ条件が満たされ、品質ゲートが成功し、失敗系を含む検証証拠があること。
テスト件数の増加、チェックボックスの完了、デモの成功一回だけでは完了にしない。
AWS未検証の項目がある場合は「ローカル修正完了／AWS確認待ち」と分けて報告する。

## 設計上の根拠

- DynamoDBの原子性、同一アイテムへの複数操作禁止、ClientRequestTokenの期限：
  [TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)。
- 一括削除のHTTP成功と個別削除エラーの違い：
  [S3 DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html)。
- 開発時の再レンダーで副作用が露呈する理由：
  [React StrictMode](https://react.dev/reference/react/StrictMode)。
- query取消とAbortSignalの伝播：
  [TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)。
  取消はサーバー上の既に受理された処理を巻き戻すものではない。
