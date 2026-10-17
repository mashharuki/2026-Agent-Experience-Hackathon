# Contracts

| ファイル | 内容 | 状態 |
|---|---|---|
| [openapi.draft.yaml](openapi.draft.yaml) | HTTP API の草案（OpenAPI 3.0.3） | 草案。lint・Connexion読込みは未実施 |
| [decider-decision.md](decider-decision.md) | Decider の型付きの問い・選択肢・動作への接続 | 仮。T-001で確定 |

- **正本**は tasks で作成する `packages/api-spec/openapi.yaml`。このディレクトリの草案から移す。
  Python側から仕様を生成する方式へ変えない。
- 生成クライアント（Orval）は直接編集しない。仕様を変えたら再生成して差分を確認する。
- OpenAPI 3.0.3 の構文のみ使う。草案が構文として正しいかは、YAML lint と Connexion での読込みで確認する（未実施）。
- UIの契約（四画面）は [spec.md](../spec.md) の FR-026 を参照。
