# Implementation Plan: 観戦と勝者予想

**Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

002の帆走・海上描画を再利用し、4艇の観戦レースへ拡張。既存の人間操船・写真支援コードは保持する。
本人指定のリアルタイム方式。推論を待ってシミュレーションを止めず、古い返答を破棄する。

## Technical Context

[技術一覧](../../docs/tech-stack.md)に従う。React19/Vite8/MUI/Three.js0.180.0、純粋TypeScript30Hz、Python3.12/uv、固定revisionのStrands Decider0.1.0を再利用。
ローカル接続はloopback専用の実験用サーバーとVite dev proxy。公開APIの代用ではない。正本OpenAPI・Connexion/Flask・Orvalはクラウド実装時にまとめて昇格する。
実モデルは既存検証済みキャッシュを読み、ダウンロード・外部通信・AWS呼び出しを行わない。
保存はローカルJSON、合計512KiB。検証はVitest、pytest、Ruff、Biome、Oxlint、ブラウザー。新しいnpm/Python依存の追加は原則不要。

## Constitution Check

- 規約: 各艇のDecider選択を実操船へ接続。Bedrock解説・AWS・公開提出物は未実施として維持。
- 費用: ローカルから先に検証。総$30・30worker時間はリセットしない。旧利用分・最新単価確認前にデプロイしない。
- 安全: 実験用APIはloopbackのみ・ローカルトークン・厳密なJSONとサイズ制限・同時1。公開にはCognitoと所有権が必須。

## Architecture and timing

4艇の観測を順番に作る。各艇8シミュレーション秒以上、全体同時1推論、1レース96判断まで。
観測から適用まで3実秒、目標p95≤2秒。sequence/raceId/epoch/艇ID/観測tick/レグを検証し、次tickに適用する。
pause・終了・再戦でepoch失効。クライアントのAbortがモデル停止を意味しないため、サーバーは実行終了まで枠を保持し、busyはキューに積まない。
同一レースで期限超過2回が続く場合は中断。モデルエラーも明示し、ルール艇へ勝手に置き換えない。
艇のモーターや瞬間旋回を使わず、通常の舵制御で目標相対風向・可視ブロー・回航点・フィニッシュへ進む。
境界と接触の安全制御は共通。最適航路をコードで先に決めてモデルに追認させない。
4艇の性能は共通で、方針だけを観測へ含める。予想・seed・未来の風は含めない。

## Records and outcomes

選択・出所・要求/適用tick・失効を保存。再生では記録済みの適用戦術のみ使用し再推論しない。
暫定順位は残距離の近似。勝者は実フィニッシュの補間時刻で判定し、未完走だけなら勝者なし。
全体480判断/日の維持案では96判断×5レースが上限。旧案の20レース/日をそのまま流用しない。

## Project Structure

- packages/sailing-sim/src/fleet.ts: 多艇・戦術・予想・順位。
- apps/regatta-web/src/fleet-runtime.ts: 実時間期限・非同期・記録。
- apps/regatta-web/src/ObserverApp.tsx: 予想・順位・追従・判断・結果。
- apps/regatta-worker/: ローカル実Decider接続と評価。旧workerの型付き出力検証とキャッシュ検証を再利用。

## Gates

1. 決定的な多艇とプレビュー、予想の固定、再生・中断の自動検証。
2. 実モデル100判断・4艇への接続・遅延/失効の実測。高速なfakeの結果を転用しない。
3. 本人の観戦評価、方針/開始位置の偏り、同条件比較、モデル品質を確認。
4. 新OpenAPI正本化・認証・原子受付・残予算・AWS・Bedrock。今回はローカルを先行。
