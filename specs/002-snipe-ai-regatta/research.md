# 調査・設計判断

2026-10-21。設計上の判断であり実装結果ではない。公式資料と現行コード、旧検証、設計レビューを参照した。

## 操船と戦術の分離

**Decision**: Three.jsは描画、純粋なシミュレーションは艇の運動、Deciderは型付きの戦術ツール選択。
**Rationale**: 画面の動きを推論待ちにせず、AIの選択が航路を変える責務を明確にする。
**Alternatives**: 毎フレームのLLM制御は費用・遅延・再現性から不採用。ルール艇は練習・比較用。
**Sources**: [Decider公式](https://github.com/strands-labs/strands-decider)、[公式紹介](https://strandsagents.com/blog/introducing-strands-decider/)。ゲームへの応用例はあるがヨットの戦術精度の保証ではない。

## Three.jsの利用

**Decision**: 初版は直接利用。ReactはUI、毎tickの艇状態はシミュレーションと描画側で保持。
**Rationale**: 既存Reactに過剰な再描画を持ち込まない。公式資料をContext7でも確認し、ループ停止とGPU資産の明示的破棄を要件化した。
**Alternatives**: React Three Fiberは後続候補。Three.jsの版は実装時に固定する。
**Sources**: [描画ループ](https://threejs.org/manual/en/creating-a-scene.html)、[資産の破棄](https://threejs.org/manual/en/how-to-dispose-of-objects.html)。

## スナイプの再現範囲

**Decision**: 舵・メイン、風上タック、ブローへ寄せる戦術を先に検証する近似モデル。
**Rationale**: 競技経験者本人が「判断を迷う」「再戦したい」と感じるかを確認する。
**Alternatives**: 全トリム・波乗り・全競技規則・乗員重心は初版に含めない。
**Sources**: [SCIRA操船解説](https://www.snipe.org/articles-advices-and-education/technical-experts/tuning/preparing-and-sailing-a-snipe/)、[クラス規則](https://snipe.org/class-rules/)。資料にはメイン・ジブ・ポール・乗員連携の説明があるが、検証済み性能曲線とは異なる。
**未検証**: ポーラ、失速角、旋回・タック損失、コース長。実艇値と偽らず本人の試走で調整する。

## 既存ゲームの参考

**Decision**: Pancake Sailorを操船と視点の参考にする。
**Rationale**: 紹介記事をブラウザーで確認。公式ページでも舵・帆のキーボード操作、タック、レースを確認。
**Alternatives**: 素材・コードは取得・流用していない。今回の核は人間対Deciderの戦術対戦。
**Sources**: [紹介記事](https://ameblo.jp/time-tripper-ame/entry-12608736331.html)、[公式ページ](https://store.steampowered.com/app/1274800/Pancake_Sailor/)。

## CPU推論の期限

**Decision**: 判断間隔8秒以上、観測→適用p95≤2秒目標、3秒期限。100回の実測を先行ゲートにする。
**Rationale**: 旧起動時間146〜162秒は温まった判断遅延の根拠ではない。リアルタイム対戦への適合は未検証。
**Alternatives**: 状態短縮・候補調整を先に行い、GPUや別モデルへ無条件に増額しない。停止型モードへの変更は合意後。
**Source**: [旧AWS検証](../../docs/reviews/2026-10-21-aws-validation.md)。

## 事後解説と再生

**Decision**: Bedrockは記録を参照する事後解説1回。再生は記録済み操作を使い再推論しない。
**Rationale**: レース中の生成遅延を避け、AI内部の思考や勝因を捏造しない。
**Alternatives**: ライブ実況、別選択の反実仮想比較は後続。seedだけの再生は推論遅延を再現できない。

## 旧資産と公式要件

**Decision**: 旧コード・spec・検証を残し、新featureを作業の正本にする。
**Rationale**: 認証・型付き判断・原子的受付を再利用できるが、写真の品質実験をゲームへ転用しない。
**Alternatives**: 旧コードの即時上書き・削除はしない。AWSリソースだけを削除した。

2026-10-21に[公式募集](https://builder.aws.com/build/hackathons/4f50957c-1d08-37ab-b11c-97516b9adeb4/agent-experience-hackathon?tab=rules)を取得。
AWS、意味のあるDecider判断＋Bedrock、記事、公開コード、再利用パターン、3分未満の公開動画を確認。
`#tool-selection`として戦術ツールへの接続を示す。詳細RulesはTerms Applyを含め応募直前に再確認する。
期限の一覧表示に差があるため、従来の10/23 23:59 PDT（10/24 15:59 JST）を安全側の目標にし、延長を前提にしない。

仕様作成を止める未解決質問は置かず、初期値・変更条件をplan.mdへ記録した。
G1操船・G2遅延・G3対戦、最新価格と残予算、本人の面白さ評価は未実施であり、設計完了と合格を区別する。
