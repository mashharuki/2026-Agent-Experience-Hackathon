# データと状態

FleetRaceは4艇・seed・scenario・tick・状態・艇別TacticPlan・接触履歴を持つ。採用物理sailing-v2、風wind-v2。
Predictionはスタート前の1艇のみ、レース中の変更不可。観測へ含めない。
Boatは同じ運動モデル。TacticPlanは相対風角か現在の可視目標・回航・フィニッシュの目標で、出所を持つ。
CurrentObservationは選択艇・相手3艇の現在位置/針路/速度/レグ、現在風、可視ブロー最大3、方針、マーク。
将来の風・seed・予想・自由文を含めない。選択候補は状態から検証する。
DecisionRecordはraceId/epoch/sequence/艇ID/観測tick/受信/適用tick/選択/出所/状態/遅延。confidenceは勝率ではない。
ReplayRecordは物理・風・記録形式の版、初期条件と適用判断を持つ。512KiBを超える保存を拒否。
終了・中断・再戦で旧返答を無効化。再生はモデルを呼ばない。
