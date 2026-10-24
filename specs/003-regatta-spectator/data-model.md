# データと状態

FleetRaceは4艇・seed・scenario・tick・状態・艇別TacticPlan・接触履歴を持つ。採用物理sailing-v2、風wind-v2。
Predictionはスタート前の1艇のみ、レース中の変更不可。観測へ含めない。
Boatは同じ運動モデル。TacticPlanは相対風角か現在の可視目標・回航・フィニッシュの目標で、出所を持つ。
CurrentObservationは選択艇・相手3艇の現在位置/針路/速度/レグ、現在風、可視ブロー最大3、方針、マーク。
将来の風・seed・予想・自由文を含めない。選択候補は状態から検証する。
DecisionRecordはraceId/epoch/sequence/艇ID/観測tick/受信/適用tick/選択/出所/状態/遅延。confidenceは勝率ではない。
ReplayRecordは物理・風・記録形式の版、初期条件と適用判断を持つ。512KiBを超える保存を拒否。
終了・中断・再戦で旧返答を無効化。再生はモデルを呼ばない。

## 観戦表現（2026-10-24）

ReplayRecordに任意のpresentationVersion（sea-v3）を追加。旧記録を維持し、physics/wind版は変更しない。
RaceEventはtick・boatId・kindを持つ観測イベント。最大256件。判断の選択理由ではなく実際の動作から通知する。
FleetReplayは適用済み判断から最大5400tickを再構築。再生のtick/速度/停止は元のraceと分離する。
予想履歴は端末内に最大100件、mode/scenario/的中を保存。プレビューと実AIを区別し、途中終了を成績に含めない。
