# Claude Codeへの引き継ぎ

更新日：2026-10-17。これは引き継ぎ時点の記録。作業開始時にGit差分と実ファイルを再確認する。
ユーザーとの会話は日本語で進める。

## 最初に読む資料

1. [AGENTS.md](../AGENTS.md)：リポジトリの作業ルール。
2. [憲章](../.specify/memory/constitution.md)：ハッカソン準拠、低コスト・サーバーレス優先、Cognitoと基本的セキュリティ。
3. [技術スタック一覧](tech-stack.md)：採用・推奨・条件付き・導入済みを区別。Spec Kitでの適用ルールを含む。
4. [MVP案](mvp.md)：撮影前の眉・前髪を一つ整え、前後比較から本人が選ぶ体験。
5. [アーキテクチャ](architecture/README.md)、[技術選定理由](architecture/technology-selection.md)、[費用試算](architecture/cost-estimate.md)。

## 合意事項

- AWSサービスのアーキテクチャはユーザー承認済み。編集可能な図は
  [photo-prep.drawio](architecture/diagrams/photo-prep.drawio)。AWS公式アイコン入りで2ページ。
- フロントはReact/Vite/TypeScript。ユーザー指定はVoidZero、TanStack Query、Material UI、React Bits。
  Vite+への具体的な移行は推奨案。pnpmを維持し、既存Biome/Turboとの重複を整理する。
- API仕様は **OpenAPI YAMLを正本** にする。Pythonから仕様を生成する方式へ黙って変更しない。
- Python＋Connexion 3＋Flask、Mangum、Orval、OpenAPI 3.0.3が現在の推奨案。
  結合検証は未実施。旧設計のTypeScript API／OpenAPI 3.1をそのまま実装しない。
- React Bitsの現行MIT＋Commons Clauseと、ハッカソンのOSIライセンス・公開条件の整合を確認する。
- ユーザーはイベント配布AWSクレジットを保有。BedrockのNova Liteを第一候補とするが、
  適用対象・期限・残高は未確認。Activate向け条件を流用せず、利用額ゼロと断定しない。
- 予算上限は未定。ユーザーは費用の目安を見て決めたい。

## 構成と現在の実装状況

SPAはS3＋CloudFront、認証はCognito、APIはHTTP API＋Lambda。
DynamoDBに状態を保存し、S3へ一時画像をアップロード、SQSからFargateワーカーへ渡す。
Bedrockが画像観察と説明、Strands Decider 2Bが次の支援を選択する。
禁止範囲・終了操作・利用枠・所有権は通常コードでも検証する。

Fargateは初期案4 vCPU/16 GB・同時処理1。デモ前に起動し、終了後停止する。
稼働中は待機も課金。停止状態から即座に自動復帰する構成ではない。
モデル性能・ピークメモリ・品質は未測定。

- `apps/frontend/`、`apps/cdk/` は雛形。
- `packages/api-spec/`、`packages/shared/` は初期パッケージ。
- `apps/api/`、`apps/worker/`、実際のOpenAPI YAMLは今後作成する。
- AWSリソースのデプロイはこの作業では行っていない。
- Spec Kitは導入済み、憲章はv1.0.0。機能spec/plan/tasksはまだ作成していない。
  導入した連携はCodex用。Claude Codeでのスキル・コマンドの利用可否を確認し、
  既存の憲章や設計を再初期化で上書きしない。

## 直近の変更と検証結果

ルートpackage.jsonのスクリプト：

| コマンド | 動作 | 直近の結果 |
| --- | --- | --- |
| `pnpm knip` | 未使用コード・依存の検出 | 解析可能。未使用判定が残り終了コード1 |
| `pnpm jscpd` | `apps/`・`packages/` の重複検出 | 直接バイナリ実行で成功。重複率2.86%、閾値5% |
| `pnpm check:quality` | Knip成功後にjscpd | 現状はKnipで停止する |

`.jscpd.json` はTSX/JSXを追加し、HTMLの形式名を`markup`へ、ファイル除外を`ignore`へ修正済み。
レポート出力先 `report/` はGit管理から除外している。

`@vitejs/plugin-react` の読込み失敗は修復済み。依存定義は存在したがワークスペースのインストールが不足していた。
`pnpm install --frozen-lockfile` がpnpm 10.32.1で成功し、lockfileを変更せず復旧した。
pnpm経由のKnipで設定読込みエラーが消えたことを確認済み。
Codexの制限環境ではpnpm取得時の通信エラーが出たが、ネットワーク許可付き実行で成功した。
署名検証を無効化する設定は追加していない。

残るKnipの指摘（引き継ぎ時点）：

- 未使用ファイル：`apps/cdk/bin/cdk.ts`、`apps/cdk/lib/cdk-stack.ts`。
- 未使用dependencies：`aws-cdk-lib`、`constructs`、`source-map-support`。
- 未使用devDependencies：`cdk-nag`、`ts-node`、`turbo`。
- root、api-spec、sharedの `main: index.js` に対応するファイルがないというヒント。

CDKの入口をKnipが認識していない可能性がある。`apps/cdk/cdk.json` のapp設定と
Knipのworkspace/entry設定を調べ、誤検知と実際の未使用を分ける。
設計上利用予定の依存もあるため、`knip --fix` で一括削除して通過させない。

## 次に進める作業

1. 残るKnip指摘の原因を整理し、必要な入口設定・実態に合う依存整理を行う。
2. Spec Kitのspecify/clarifyで機能仕様を確定する。技術構成は上記資料を共通入力とする。
3. plan/researchでConnexion＋Mangum、DeciderのFargate性能、画像品質、クレジット・ライセンス条件を検証項目にする。
4. tasksでOpenAPI契約、生成クライアント、認証・認可、ワーカー、UI、テスト、IaCへ分解する。

この一覧を全項目が新たに実装指示されたものとは扱わず、ユーザーの次の依頼に合わせて進める。
検証済み・仮説・モックを区別し、ハッカソンの要件と期限は公式情報で再確認する。
