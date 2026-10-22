# 契約の段階

`local-experiment.yaml`はlocalhost限定の実モデル実験用スナップショット。Pydanticで厳密に検証する現時点の形式を記録し、テストで型との不一致を検出する。
旧`packages/api-spec/openapi.yaml`を置換せず、公開契約・Cognito API・Connexion自動検証・Orval生成が完成したとは扱わない。
クラウド段階では003のレース・予想・判断・記録をYAML正本として厳密化・昇格し、ミドルウェアとクライアントを生成する。
実験用サーバーを外部公開して代用しない。
