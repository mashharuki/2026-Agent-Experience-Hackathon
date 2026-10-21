# レースAPI契約（設計用草案）

[openapi.yaml](openapi.yaml)は新機能の設計草案。現行 `packages/api-spec/openapi.yaml` は旧PhotoPrepの実装契約であり、今回は変更しない。
実装開始時にこの草案を正本へ統合し、operationId・handlerを実装、Connexion検証、Orval生成、認証・所有権テストを同じ変更で行う。
新APIはまだ公開されておらず、以下の呼び出しでゲームが動くわけではない。

| 操作 | 用途 | 主な制約 |
| --- | --- | --- |
| GET /service-status | 準備・空き枠を確認 | 認証必須、時刻と推論可能状態を区別 |
| POST /races | 1対1レース作成 | quota・全体同時1のleaseを原子的取得 |
| GET /races/{raceId} | レース・結果・削除状態 | ownerのみ |
| DELETE /races/{raceId} | 中断と記録削除 | 202は削除中、完了はGETで確認 |
| POST /races/{raceId}/control | pause/resumeとepoch更新 | 双方の時計を止め、leaseは延長しない |
| POST /races/{raceId}/decisions | 戦術job受付 | 同時1、24回、8秒以上間隔、最大64KiB |
| GET /jobs/{jobId} | 戦術／解説job取得 | ownerのみ、期限・適用可否は別確認 |
| PUT /races/{raceId}/replay/{chunkIndex} | 操作・航跡・適用記録の分割保存 | 8chunk・計512KiB、同index同hashのみ再送可能 |
| POST /races/{raceId}/finish | 完走／時間切れ／中断の確定 | epoch失効、manifest固定、遅い返答を拒否 |
| POST /races/{raceId}/debrief | Bedrock事後解説 | 終端のみ、1回、記録参照の検証 |

全POSTはIdempotency-Key必須。同じキー・同じ入力は元の応答、異なる入力は409。
GETで401、他人のIDは404、状態矛盾409、容量超過413、利用制限429、準備不可503を区別する。
JWTはaccess token、Cognito issuer/audienceと `regatta/race` scopeを検査。ログイン・サインアップ自体はCognito管理画面。

YAMLは外側のメッセージと上限の草案。Observation、ReplayEvent、DecisionRecordの内側の型は
[data-model.md](../data-model.md)の意味を、G1/G2後にYAMLへ具体化してから生成する。自由形式のまま本番実装しない。
受理時刻とモデル終了時刻だけで「適用済み」と表示せず、ブラウザーのapplyStatusを記録する。
