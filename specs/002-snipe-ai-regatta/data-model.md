# データと状態の設計

2026-10-21。新規実装用の設計。旧PhotoPrepのレコードと混在させない。

## Race

`raceId`、`ownerSub`、`mode`、`courseVersion`、`physicsVersion`、`polarVersion`、`windVersion`、
`status`、`epoch`、`nextDecisionSeq`、`activeJobId`、`decisionsUsed`、`debriefUsed`、
`createdAt`、`leaseExpiresAt`、`ttl`、`outcome`、`finishTimes`。

- `CREATED → RUNNING ↔ PAUSED`、進行状態から `FINISHED | TIMED_OUT | ABORTED`へ。終端からRUNNINGへ戻らない。
- `DELETING → DELETED`は任意の状態から開始できる。DELETING中は新規受付・結果適用を拒否。
- pauseは双方の艇・風の時間進行を止め、control APIでPAUSEDとepoch更新を確定する。leaseは実時間10分で失効。
- タブ非表示では先にローカルで停止・失効。通信できなかった場合も返答を適用せず、復帰時にpause/resumeをサーバーと同期してから進める。
- 全体同時1のleaseはowner/race/期限付き。作成・quota増加・lease取得をトランザクション化。
- 180シミュレーション秒上限、24判断、解説1回。client申告だけでquota・所有者を決めない。

## BoatState / Observation

物理座標は東+x、北+y。位置m、速度m/s、内部角rad、表示は北0度・時計回り、風向は来る方角。
ポーラ入力は真風。見かけの風は `trueWind - boatVelocity`。

ローカル練習は`physicsVersion=sailing-v2`、`windVersion=wind-v2`を記録し、版不一致の再生を拒否する。
`dynamic`の海面もseedとsimulationTickから生成し、別の実時間タイマー・将来の風の観測フィールドは持たない。

`BoatState`: boatId、position、velocity、heading、rudder、mainSheet、tack、maneuverId、leg、markProgress。
`Observation`: version、simulationTick、epoch、AI艇と相手艇、localWind、短い風履歴、可視ブロー候補、目標マーク。
ブロー候補は最大3、履歴は最大8。座標はコース許容範囲内、角度正規化、有限数、列挙値を検査。

未来の風、隠れたブロー、風生成seedはDeciderへ送らない。seedはローカル再生のメタデータであり、
API・モデルに渡す戦術観測から分離する。同じ観測内容を計器・俯瞰でも人間に提示する。

## Job / DecisionRecord

Job: `jobId`、raceId、ownerSub、kind=`tactic|debrief`、seq、epoch、requestHash、
status=`PENDING_DISPATCH|QUEUED|RUNNING|SUCCEEDED|FAILED|EXPIRED|CANCELLED`、expiresAt、ttl。

- 同一キー同一入力は同一job。異なる入力は409。終了後でも既存受付の所有者付き再取得は可能だが新規jobは拒否。
- quota・job・IDEM・raceのactiveJobを原子的に確定。未送信jobのみ再配送し、再配送で推論回数を増やさない。
- サーバーは受信時点から最大3秒の戦術期限を付ける。ブラウザーは観測時点からの単調時計3秒を別に持ち、先に切れた期限を優先。
- 通信前の時間と時計ずれを含むため、サーバー期限だけで観測→適用3秒以内を保証したとはしない。
- 推論の即時cancelは前提にしない。結果保存時にもrace/epoch/seq/statusを確認し、終了後のlate resultを破棄する。

DecisionRecord: observationTick、request/receive/applyTick、seq、epoch、questionVersion、
eligibleOptions、rawChoice、selectedTool、parameters、source=`model|policy|fallback`、
probabilities、confidence、guardReason、applyStatus=`applied|expired|stale|cancelled|rejected`、latency。

モデルを呼んでいない場合のrawChoice・確率・confidenceはnull。ツールの引数は観測候補IDからコードで束縛。
API受理・worker成功は、ゲームへの適用成功とは別。ブラウザーの適用記録を保存して初めて適用済みと表示する。

## Replay / Debrief

Replay: 風seed、各バージョン、双方の操作時系列、10Hzの航跡、判断・適用・失効の時系列。
同じエンジン版で入力から再生し、保存snapshotを照合。版が異なる場合はsnapshot表示へ落とし、厳密再現と呼ばない。
再生はモデルを再呼び出ししない。同じseedでの再戦は別raceIdで、新しい判断とquotaを使う。

1chunkはJSON 64KiB以内、最大8chunk・合計512KiB。chunkIndexとhashで重複を拒否／再取得。
finishは全chunkのmanifestとhashを固定し、それ以降は記録を書き換えない。改ざん耐性のある競技記録ではない。
Debriefは参照event ID付きの要約。1回の生成、最大800出力tokens、記録にない参照を拒否。

## 保存・削除

新DynamoDBでは `RACE#id/META`、`RACE#id/JOB#id`、`RACE#id/DECISION#seq`、
`RACE#id/REPLAY#chunk`、`RACE#id/DEBRIEF`へ集約。jobId→raceの所有者付き索引も短期保持する。
1項目のサイズを抑え、巨大な単一レコードに航跡を蓄積しない。記録は24時間、通常ログは7日。

DELETEはDELETINGを先に確定し、処理中の結果保存を拒否してから子レコードを削除する。
部分失敗は削除中と残存件数を返して再試行可能にする。削除完了のtombstoneは短期保持し、二重受付を防ぐ。
セキュリティ用のquota・冪等情報は24時間保持するが、航跡・観測・解説は削除する。
物理削除はアプリの削除処理と回収処理で実施し、TTLの期限到来を即時削除の証拠にしない。
