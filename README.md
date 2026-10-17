# 2026-Agent-Experience-Hackathon

[AWS Agent Experience Hackathon: Strands Decider](https://builder.aws.com/build/hackathons/4f50957c-1d08-37ab-b11c-97516b9adeb4/agent-experience-hackathon-strands-decider) 向けのプロジェクトです。

撮影前の眉・前髪を一つ整えて試し、前後を比べて本人が選ぶ体験を検討しています。現在の案は [MVP仕様書](docs/mvp.md)、開発上の案内は [AGENTS.md](AGENTS.md) を参照してください。

## Spec Kitで設計を進める

Specify CLI **1.0.3** のCodex連携を導入済みです。

- `.agents/skills/speckit-*/`：Codexから呼び出すスキル。
- `.specify/templates/`：仕様・計画・タスクのテンプレート。
- `.specify/scripts/bash/`：仕様書作成を支援するスクリプト。
- `.specify/memory/constitution.md`：プロジェクト原則。現時点では未記入のテンプレートです。
- `specs/`：今後、機能ごとの仕様・計画・タスクを作成する場所。

このリポジトリを開いたCodexのチャットで、順番に次のスキルを使います。ターミナルのコマンドではありません。

| スキル | 進めること |
| --- | --- |
| `$speckit-constitution` | 開発と体験設計の原則を決める |
| `$speckit-specify` | `docs/mvp.md` を出発点に、利用体験と要件をまとめる |
| `$speckit-clarify` | 曖昧な点を質問で詰める |
| `$speckit-plan` | 技術構成と実装計画をまとめる |
| `$speckit-tasks` | 実装する作業に分解する |
| `$speckit-analyze` | 仕様・計画・タスクの整合性を確認する |
| `$speckit-implement` | タスクに沿って実装する |

まずは原則と要件を一緒に検討します。MVP案の仮置き事項は、確定事項と区別して仕様へ反映します。スキルが候補に表示されない場合は、このリポジトリでCodexのチャットを開き直してください。

## CLIの確認と再セットアップ

```sh
specify version
specify integration status --json
```

別の開発環境でCLIが必要な場合は、Python 3.11以上とuvを用意して導入します。スキルとテンプレートはこのリポジトリで共有します。

```sh
uv tool install specify-cli==1.0.3
```

今回の初期化コマンドは次のとおりです。既存環境での再実行は管理ファイルを上書きする可能性があるため、変更差分を確認してから使ってください。

```sh
specify init --here --force --non-interactive --integration codex --script sh
```

参考：[Spec Kit公式ドキュメント](https://github.github.com/spec-kit/installation.html)
