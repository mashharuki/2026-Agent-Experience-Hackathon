# Phase 0 Research: 撮る前のひと手間

2026-10-17。Technical Context の未確定事項を、(1) 公式資料で確認できたもの、(2) 実測・実装が必要で
検証タスクに回すもの、に分けて記録する。**(2) は決定ではなく、暫定の方針と合否基準である。**
コードの追加・依存関係の導入・AWSへのデプロイは行っていない。

形式: Decision（方針）／Status（確認済み・暫定・要検証）／Rationale／Alternatives。

## R-001 Decider の入力と「ツール選択」への接続

- **確認した事実**（[公式推論資料](https://github.com/strands-labs/strands-decider/blob/main/docs/inference.md)）:
  - Decider はテキスト入力のみ。資料が画像入力を述べるのは Gemma 系で `--vision` が適用外と書かれた箇所のみで、Qwen 系（採用候補）の画像入力は記載がない。→ 設計どおり、**画像はBedrockで観察し、Deciderにはテキストの状態を渡す**。
  - 出力は型付きの問いへの回答: `noul`（真偽の確率）、`choice`（最上位の選択肢、選択肢ごとの確率、confidence）、`score`。
  - 重みは別: ベース重み `Qwen/Qwen3.5-2B-Base` 約4.5 GB を初回ロード時にHugging Faceから取得する。→ 設計の「ビルド時に固定・同梱、実行時ダウンロードなし」は妥当（実行時取得を避ける）。
  - CPU実行は可能だが「大幅に遅い」。公表されたCPU時間は64 vCPUホストの Gemma 系の値で、採用候補の Qwen 2B を 4 vCPU の Fargate で動かした値ではない。
- **実機確認の結果（T008、2026-10-17）**: `experiments/decider-spike/`（`spike.py`、実行ログ `run_cpu.log`）で、PyPI の `strands-decider 0.1.0`（torch 2.14.1、transformers 5.20.1、Python 3.12）をこの開発Mac（Apple silicon、CPU実行、16 GB）に入れ、`StrandsAgents/strands-decider-2B-qwen3.5-v1-2610` を動かした。**Fargate（x86_64）での測定ではない。**
  - **API形式を確認**: Python から `load_engine(checkpoint, device="cpu")` → `engine.ask(state, {名前: ChoiceQuestion(instructions=…, criteria={選択肢: 説明})})` で呼べる。`criteria` は**選択肢名→説明の辞書**で、選択肢ごとの説明を渡せる。応答は `answers[名前]` に `choice`（最上位の選択肢）、`probabilities`（選択肢ごとの確率）、`confidence` を持ち、`usage` は入力約200トークン・出力1トークン。公開資料に無かったフィールド名はこれで確定。
  - **4選択肢の問いは動作した**（日本語の状態・選択肢でも）。合成した5つの状態テキスト（写真なし）の結果:

    | ケース | 最上位 | confidence | 備考 |
    |---|---|---|---|
    | A 毛流れを整えたい・照明十分 | `grooming_tip` | 0.846 | 期待どおり |
    | B 逆光で眉が見えない | `capture_setup_tip` | 0.685 | 期待どおり。ただし confidence は 0.8 未満 |
    | C 相談範囲「まず見てほしい」・根拠が弱い | `clarify` | 0.688 | 期待どおり。ただし 0.8 未満 |
    | D 試行回数 2/2 | `offer_finish` | 0.932 | 期待どおり |
    | E 「眉には触れたくない」と明示・眉が乱れて見える | `grooming_tip` | 0.419 | **禁止に反する選択**（確率 0.565 で最上位） |

  - **判断の含意**: (1) E は、Decider が状態テキストに書いた禁止を守らない場合があることを示す。**禁止・上限・終了を通常コードで再検査する設計（FR-008、`contracts/decider-decision.md` の接続ガード）は必須**。(2) 暫定閾値 0.8 では B・C のような妥当な選択も `clarify` に退避される。**閾値の根拠はまだなく、評価データで調整する**（T087・T090）。0.8 のままにしない。(3) 5件の合成例は品質の証拠にならない。
  - **この環境での性能**（Fargate 4 vCPU の保証にならない）: 初回ロード約81秒（重みの取得後。ネットワーク取得は別、取得ファイル29個）、プロセスのピーク RSS 約5.7 GB、問い1件の推論は約4.5秒（3回測定、初回のみ約6.6秒）。ライブラリは `causal_conv1d` と `flash-linear-attention` が無く参照実装に退避すると警告していた（遅いが結果は正しいとされる）。**問い1件で約4.5秒かかるため、SC-005（中央値10秒）の予算の約半分を Decider が使う**。Bedrock の観察・説明・ポーリング遅延と合算すると超える恐れがあり、T014・T103 で優先して測る。
  - **ディスク**: Hugging Face キャッシュ約4.5 GB（チェックポイント＋`Qwen/Qwen3.5-2B-Base`）、仮想環境約0.7 GB。実行時の自動ダウンロードがあるため、Docker では**ビルド時に取得して同梱**する（T048）。
  - **未確認**: `strands-decider serve`（HTTP）の応答、MPS／GPU、fp32 以外、x86_64 Linux（T014）。ワーカーは HTTP サーバーを使わず、ライブラリを直接呼ぶ（Flask 不要の設計と整合）。
- **Decision**: 型付きの問い（`choice`）の選択肢に `grooming_tip` / `capture_setup_tip` / `clarify` / `offer_finish` を置き、**選択肢ごとの説明を `criteria` に渡す**。最上位の選択肢を通常コードが検査してから対応する処理を呼ぶ。[contracts/decider-decision.md](contracts/decider-decision.md) に契約として記す。
- **Status**: **API形式と4択の動作は実機で確認済み（開発Mac・CPU）**。Fargate での性能、閾値の設定、品質は未検証（T014・T015・T087・T090）。
- **Alternatives**: Strands Agents SDK の自律ループ（初版の必須要件にしない）。Bedrockだけでツール選択（憲章I違反＝Deciderの意味のある判断が必要なため不可）。

## R-002 Bedrock・Nova Lite の可用性と制約

- **確認した事実**（[Nova Liteモデルカード](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html)）:
  - `amazon.nova-lite-v1:0` は東京 `ap-northeast-1` で**リージョン内**の推論が利用可能。画像入力、Converse API 対応。ライフサイクルは Active。
  - **構造化出力（Structured outputs）は非対応**。クライアント側のツール呼び出しは対応。
  - 「EOL no sooner than 2025-12-05」と記載があり、本計画の日付（2026-10-17）以降の提供継続を実行時に確認する必要がある。
- **Decision**: Converse API＋クライアント側ツール呼び出し（またはJSON指示）で観察結果を得て、**スキーマ検証をワーカー側で必ず行い**、不正な形式は成功として扱わない。`apac.` プロファイル（東京から複数リージョンへ分散）は使わず、初版はリージョン内IDを使う（クロスリージョンを有効にしない設計に合わせる）。
- **Status**: 提供状況は確認済み。**画像観察の品質（逆光・変更なしの再撮影で根拠のない断定をしない）は未検証**（T-002）。クレジットの対象製品かは未確認（R-008）。
- **Alternatives**: 他モデルへの切替（品質評価の不合格時のみ。費用を再計算）。

## R-003 Connexion 3＋Flask＋Mangum（API）

- **ローカル検証の結果（T009、2026-10-17）**: `experiments/connexion-mangum/`（`app.py`、`test_spike.py` 23件、すべて成功）。connexion 3.3.0、mangum 0.22.0、flask 3.1.3、starlette 1.8.0、Python 3.12 を使用。**入力は、公開されている API Gateway HTTP API v2 のペイロード形式に従って自作した合成イベントで、実際のゲートウェイから取得したものではない。**
  - **動いたこと**: 草案 `openapi.draft.yaml`（6操作）が Connexion にそのまま読み込めた。`Mangum(connexion_app)` で v2 イベントが処理できた。`validate_responses=True` と `strict_validation=True` が働いた（未定義の本文項目・クエリ、型・列挙・長さ違反、必須項目の欠落、不正JSON、`Idempotency-Key` 欠落、パス変数の長さ違反はすべて400。スキーマに反するハンドラ出力は500）。base64 本文の復号、日本語本文、202応答も問題なし。
  - **JWT claims の引渡し**: JWT の検証は API Gateway が行い、アプリは Connexion のセキュリティ関数（環境変数 `BEARERINFO_FUNC` で指定。仕様に独自拡張を入れない）で `request.scope["aws.event"]["requestContext"]["authorizer"]["jwt"]["claims"]` を読む。**claims が無ければ401（fail closed）**。ハンドラは `user`（= `sub`）を引数で受け取れる。`x-user-sub` のような偽装ヘッダーは無視された。Bearer 文字列自体は信用・解析しない。
  - **見つかった落とし穴（対処を実装方針に反映）**:
    1. `x-bearerInfoFunc`（または環境変数）が無いと、`Authorization` ヘッダーがあっても**全リクエストが401**になる。→ セキュリティ関数を必ず定義する。
    2. 検証エラーの `detail` と、Connexion のログ（WARNING の `repr(exc)`、**INFO の「Validation error: <入力値>」**）に**利用者の入力値がそのまま出る**。FR-023・憲章III（希望文をログに出さない）に反する。→ 独自のエラーハンドラ（`ProblemException`／`HTTPException`／`Exception`）でクラス名とステータスのみを記録し、ログの redact フィルターと `connexion` 名前空間を WARNING 以上にする設定で解消。テストで応答とログに入力値が出ないことを確認。
    3. 既定のエラー応答は `application/problem+json`（`type/title/detail/status`）で、契約の `Error`（`code/message`）と**一致しない**。また Mangum は `application/problem+json` を base64 で返す。→ ハンドラで契約の `Error` と `application/json` に統一して解消。
    4. イベントに `content-length` ヘッダーが無いと、本文があっても**400「RequestBody is required」**になる。実際の API Gateway がチャンク転送等で欠くかは未確認。→ エントリポイントで本文長から補う薄い関数を置いて解消（テスト済み）。
  - **性能（この開発Mac）**: import＋アプリ構築 0.34秒、プロセス RSS 約51 MiB、site-packages 約40 MB。Lambda（x86_64、メモリ設定別）のコールドスタートは未測定。
  - **未確認**: 実際の API Gateway／Lambda での動作（イベントの実形式、`content-length`、CORS プリフライト、クォータ）、x86_64 Linux 向けの ZIP 作成、Swagger UI、Mangum の `asyncio.get_event_loop` の DeprecationWarning（Python 3.12 で警告のみ）。
- **Decision**: 設計どおり「OpenAPI 3.0.3 → Connexion が検証・ルーティング → Mangum で Lambda 化」を採用候補として継続する。上の落とし穴1〜4の対処を `apps/api` の実装要件にする（tasks T025・T038）。AsyncApp／FastAPI への切替は不要と判断できる材料は得られたが、実 AWS での確認が済むまで「確定」とは扱わない。
- **Status**: **ローカルのコンポーネント検証は合格**。実 API Gateway／Lambda での結合は未検証（T062 の初回デプロイ時に確認）。

## R-004 Fargate 上の Decider（性能・メモリ）

- **確認した事実**: 公式資料のCPU実行は fp32。ベース重み約4.5 GB。公表された遅延は別モデル・別ホストの値であり、Fargate 4 vCPU/16 GB の保証にならない。
- **Decision**: 4 vCPU/16 GB・同時処理1・x86_64 を初期値とし、ロード時のピークRSSと問い1件の遅延を**実測してから確定**する。
- **Status**: 要検証（T-004）。合格条件（アーキテクチャの目標）: ピークRSS 12 GB以内、warm時の判断が数秒以内。不合格なら24 GB案と費用（約$0.34/時）を再比較する。

## R-005 React Bits とライセンス（憲章Iとの整合）

- **確認した事実**（[LICENSE](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md)）: 「MIT＋Commons Clause License Condition v1.0」。アプリへの組込み・配布は許可されるが、**部品自体の販売・サブライセンス・再配布は不可**（単体・同梱・移植版を問わない）。ページはOSI承認の有無に触れていない。
- **評価**: 公式Rules全文（R-007）は「公開リポジトリは **approved OSI Open Source License** であること」を明記している。Commons Clause の公式サイト（commonsclause.com）は「Is this 'Open Source'? — No.」と答えており、OSI の承認一覧検索（`Commons Clause`）にも該当がない。部品のソースを公開リポジトリへ同梱すると「再配布」に当たる可能性があり、リポジトリ全体のOSI要件と衝突し得る。**この評価は法的助言ではない**。
- **Decision（暫定）**: **React Bits のソースは公開リポジトリへ取り込まない**。演出は MUI＋独自CSS を既定とし、React Bits は「採用しない」を初期値とする。ユーザーの指定（React Bits）は黙って外さず、OSI要件を満たすと確認できた場合にのみ導入する（T-005）。
- **Alternatives**: MUI＋独自CSS（採用）。ライセンスの問い合わせ。

## R-006 待ち時間（中央値10秒）の見積もり

- **事実の整理**: ポーリング間隔は 2→3→5 秒。結果が完成した後、最大で次のポーリングまで待つため、遅延の中央値は処理時間より平均で約1〜2.5秒伸びる。処理は「画像取得→Bedrock観察→Decider→（必要時）Bedrock説明」の直列。
- **Decision**: 10秒目標の達成可否は**実測するまで判断しない**。計測は(a)処理時間、(b)ポーリング遅延、(c)ワーカーのコールド状態を分けて記録する（T-006）。
- **Status**: 要検証。アーキテクチャの設計目標（warm時 p95 15秒）は中央値10秒と整合し得るが、同じ分布で測ったものではない。
- **対応案（不合格時）**: ポーリング初期間隔の短縮、説明生成の省略（`clarify`/`offer_finish` では不要）、Bedrock呼び出し回数の削減。SC-005 の変更はユーザーと合意して行う。

## R-007 公式要件：ライセンスと提出物（T011 完了・2026-10-17）

- **確認方法**: Builder Center の Rules タブ全文を、アプリ内ブラウザで取得して読んだ（Last Updated: October 9, 2026）。出典: [公式Rules](https://builder.aws.com/build/hackathons/4f50957c-1d08-37ab-b11c-97516b9adeb4/agent-experience-hackathon-strands-decider?tab=rules)。以前の取得結果（要約）は「ライセンス要件の記載なし」としたが、**それは誤りだった**。全文には明記されている。
- **憲章との照合結果: 不一致なし。憲章の修正は不要。**

| 項目 | 公式Rules全文 | 憲章・本計画 | 判定 |
|---|---|---|---|
| ライセンス | 「The code repository must be public with an approved OSI Open Source License」。IP節でも OSI ライセンスの公開リポジトリと判断パターンのコミュニティ利用を許諾することが前提 | 憲章I-3: OSI承認ライセンスを含める | 一致 |
| 必須3点 | 記事（Builder Centerで**公開**）、公開リポジトリ（ソース＋再利用可能な判断パターン）、動画。**1つでも欠けると審査に進めない（pass/fail、例外なし）** | 憲章I-2〜4 | 一致 |
| 判断パターン | 「型付きの問い・選択肢、判断をエージェントの経路に置く接続、使い方の短い説明」を**明示（clearly labeled）** | 憲章I-3、T097〜T099 | 一致 |
| 動画 | 3分未満（それ以降は審査員が見なくてよい）。YouTube／Vimeo／Facebook Video／Youku で**公開**。第三者の商標・著作物（音楽等）は許諾なしに使わない | 憲章I-4 | 一致 |
| タグ | `#strands-decider-2b` と判断パターンのタグ1つ（`#tool-selection`／`#guardrails`／`#policy`／`#model-routing`／`#context-memory`） | 憲章I-5 | 一致 |
| 期限 | 2026-10-23 23:59 PT（日本時間 2026-10-24 15:59） | 憲章I-7 | 一致 |
| 配点 | 創造性30%、Decider＋Bedrock の活用（再利用パターンの質を含む）30%、説明の明確さ25%、独創性15%。速度・費用の改善計測は加点 | 憲章の配点 | 一致 |
| 動作環境 | 「AWS上で動作する」エージェント。Bedrockを生成部に | 憲章I-1 | 一致 |
| オリジナル | 未発表のオリジナルエージェント。一人一応募 | 憲章I-6 | 一致 |

- **新たに分かった点（憲章・計画への影響）**:
  1. **デモは実際にAWS上で動く必要がある**。Rulesは「working agent on AWS」「動画でエージェントとDeciderの判断が動くことを示す」ことを求める。モックや再生データだけのデモは要件を満たさない恐れがある。再生データを使う場面は補助に限り、AWS上の実動作を必ず含める（T062・T101）。
  2. **記事は「公開済み」であること**が必須。下書き（T100）だけでは不足で、ユーザーによる公開が提出前に必要。
  3. 判断パターンの審査（配点30%の内訳）に、**再利用パターンの質**が含まれる。T097〜T099 を後回しにしない。
  4. 開始時刻の表記差（ヘッダは 10/16 0:00 GMT-7、本文は「00:00 a.m. PT」と「9:00 a.m. PT」が併記）は**残っている**。開始前に作ったコードの扱いはRulesに書かれていない（「original agent that has not been previously published」のみ）。開始前の作業が問題になるかは主催者に確認が必要（本計画は 2026-10-17 以降の作業のみで影響は小さいが、`docs/` 等の設計物は 10/17 作成）。
  5. 参加資格（18歳以上、builder.aws.com プロフィール、居住地の除外国リスト、Amazon関係者の除外、一人一応募）は**本人が確認**する。除外国には日本は含まれていない（確認日時点）。これはアシスタントが判定できる事項ではない。
  6. 賞のAWSクレジットは、イベント配布クレジット（R-008）とは別物。
- **Decision**: 憲章（OSIライセンス必須）を維持。`LICENSE` を応募時にOSI承認ライセンスとして確認する（T102）。React Bits は R-005 のとおり取り込まない。
- **Status**: 全文確認済み（2026-10-17）。応募直前（T109）に Last Updated の変更を再確認する。
- **ユーザー確認が必要な事項**: 開始前（10/16 9:00 PT より前）の設計作業が問題にならないかの確認要否、参加資格の自己確認。

## R-008 費用・クレジット・予算上限

- **事実**: 単価と試算は[費用試算](../../docs/architecture/cost-estimate.md)（Fargate 4 vCPU/16 GB＋IPv4で約$0.296/時、Nova Lite入力$0.000072・出力$0.000288/1,000トークン）。イベントクレジットの対象製品・期限・残高は未確認で、費用から差し引かない。
- **Decision（ユーザー承認 2026-10-17）**: 割引前の総利用額の上限は **$30**。ワーカー稼働は合計30時間以内。Budgets は50%・80%・100%で通知するが、通知は課金を止めないため、アプリ側の利用枠・受付停止スイッチ・毎晩のワーカー停止を併用する。詳細は[費用試算](../../docs/architecture/cost-estimate.md)の「予算上限」。
- **クレジット（ユーザー申告 2026-10-17）**: **AWS Community Builder の特典クレジット、残高 $450 以上**。以前の資料の「イベント配布クレジット」は誤りで、この特典を指す。
- **Status**: 上限は確定（ユーザーが残高 $450 以上を踏まえて $30 のままと再確認）。**対象製品（Bedrock・Fargate）、有効期限、正確な残高は未確認**だが、上限は割引前の利用額で管理するため、未確認でも上限の運用は変わらない（ユーザーが Billing → Credits の Applicable products 等で確認）。確認前は相殺されるとは扱わない。項目別の積算は最初のデプロイ前に実施（T012 の残り）。

## R-009 画像の保持と削除（仕様 FR-020/021 との整合）

- **事実**: 仕様は「処理後すぐ削除、失敗時も最長24時間」。アーキテクチャは「成功・失敗・取消し時に削除、15分周期で回収、1日Lifecycleを補助、最大1時間を利用可能期間」。S3 Lifecycle と DynamoDB TTL は非同期で、正確な時刻の削除手段にならない。
- **Decision**: 設計の方式（処理後削除＋周期回収＋Lifecycle）は仕様の「最長24時間」を満たす。**即時・厳密な物理削除は約束しない**。同意画面とデモでも、その範囲で表現する（「処理後に削除する。失敗しても24時間以内に消える」）。
- **Status**: 設計上は整合。削除の実測（T-009）。

## R-010 認証・認可

- **確認した事実**: 設計は Cognito User Pool（PKCE、公開クライアント）、招待制、HTTP API の JWT authorizer、`sub` による所有権確認。IDトークンをAPI認証に流用せず、アクセストークンと必要scopeを検証する。
- **Decision**: 設計を採用。ローカル開発では、任意のHTTPヘッダーを認証済みユーザーとして信用しない（テスト認証を明示的に切り分ける）。
- **Status**: 未実装。実装後に拒否ケースを検証（SC-007）。

## 検証タスク一覧（`$speckit-tasks` への引継ぎ）

| ID | 内容 | 合格条件の概要 | 関連 |
|---|---|---|---|
| T-001 | Decider の `choice` API 形式と4選択肢の接続を実機で確認（**完了 2026-10-17、開発Mac・CPU**） | 型付きの問い→選択肢確率が取得できた。Fargate・品質・閾値は別タスク | R-001, FR-015 |
| T-002 | Nova Lite の画像観察品質評価（開発用例と評価用データを分離） | 逆光・変更なしで根拠のない断定が0件 | R-002, SC-003 |
| T-003 | Connexion＋Mangum の結合確認（最小API）（**ローカルは完了 2026-10-17: 23件成功**。実 API Gateway／Lambda は未確認） | R-003 の項目がすべて確認できる | R-003 |
| T-004 | Fargate 4 vCPU/16 GB で Decider のピークRSSと遅延を測定 | ピークRSS 12 GB以内 | R-004 |
| T-005 | React Bits のライセンス適合確認、または MUI＋CSS で代替 | OSI要件と矛盾しない | R-005 |
| T-006 | 撮影→助言表示の待ち時間を分解して測定 | 中央値10秒以内か、見直し案をユーザーと合意 | R-006, SC-005 |
| T-007 | 公式Rules全文の再確認（ライセンス・提出物・期限）（**完了 2026-10-17: 不一致なし**。応募直前に再確認） | 憲章との不一致がないこと | R-007 |
| T-008 | クレジット適用範囲・予算上限・停止手順の確定（**上限 $30 は承認済み。クレジット確認と積算が残り**） | ユーザー承認済みの上限 | R-008 |
| T-009 | 画像削除（成功・失敗・取消し・取り残し）の実測 | 24時間以内に残らない | R-009, SC-007 |
| T-010 | Bedrockのモデル呼び出しログで画像・本文を保存しない設定の確認 | 保存されない | 憲章III |

## まとめ

Phase 0 で公式資料から**事実として確認できたのは次の3点のみ**: Deciderの入力はテキストである、Nova Liteは東京の
リージョン内で画像入力に対応する（構造化出力は非対応）、React BitsはMIT＋Commons Clauseである。
React Bits を取り込まない方針は暫定。他は設計上の方針であり、実測・実装で確認する。
