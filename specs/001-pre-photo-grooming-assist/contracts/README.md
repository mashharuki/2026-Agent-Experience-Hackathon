# Contracts

| ファイル | 内容 | 状態 |
|---|---|---|
| [`packages/api-spec/openapi.yaml`](../../../packages/api-spec/openapi.yaml) | HTTP API の**正本**（OpenAPI 3.0.3、8操作） | 作成済み（T016・T017）。lint と Connexion 読込みは `pnpm --filter api-spec check` で確認 |
| [decider-decision.md](decider-decision.md) | Decider の型付きの問い・選択肢・動作への接続 | 呼び出し形式は実機確認済み（T008）。閾値は未確定 |

- 草案（`openapi.draft.yaml`）は正本へ移し、削除した。以降は正本だけを編集する。
  Python側から仕様を生成する方式へ変えない。
- 生成クライアント（Orval）は `apps/frontend/src/api/generated/` に出力し、直接編集しない。
  仕様を変えたら `pnpm --filter frontend api:generate` で再生成して差分を確認する。
- OpenAPI 3.0.3 の構文のみ使う。
- UIの契約（四画面）は [spec.md](../spec.md) の FR-026、受付状態は FR-027 を参照。

- 確認回答は `POST /sessions/{sessionId}/clarifications`。202で判断ジョブ、200で再撮影が必要なことを返す。回答も認証・所有権・冪等性・解析上限を適用する。
