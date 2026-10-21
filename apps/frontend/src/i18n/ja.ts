// Japanese is the source dictionary: its keys define MessageKey, and en.ts must match them.
export const ja = {
  "clarify.heading": "確認する",
  "clarify.scope": "どちらを見てほしいですか？",
  "clarify.detail": "気になる箇所を教えてください",
  "clarify.submit": "回答して続ける",
  "clarify.missing":
    "この質問には回答できません。相談を終了し、もう一度はじめてください。",
  "clarify.captureRequired":
    "回答を保存しました。対象が変わったか時間が経ったため、もう一度撮影してください。",

  "consult.restrictions": "変えたくないこと",
  "consult.restrictionsHelp":
    "禁止したいことはここで選んでください。希望欄の文章だけでは禁止事項として確定されません。",
  "restriction.no_touch_brow": "眉には触れない",
  "restriction.keep_brow_shape": "眉の形を変えない",
  "restriction.no_touch_bangs": "前髪には触れない",

  "app.title": "撮る前のひと手間",
  "app.tagline": "撮影前に、眉か前髪を一つだけ整えて試せます。",
  "lang.label": "言語",
  "lang.ja": "日本語",
  "lang.en": "English",

  "gate.loading": "確認しています…",
  "gate.error": "ログインできませんでした。もう一度お試しください。",
  "gate.signInPrompt":
    "はじめるにはログインが必要です。初めての方は新規登録してください。",
  "gate.signIn": "ログイン",
  "gate.signUp": "新規登録",
  "gate.signUpHint":
    "メールアドレスとパスワードで登録し、メールに届く確認コードを入力してください。",

  "heading.consult": "相談する",
  "heading.capture": "試し撮り",
  "heading.advice": "一つ試す",
  "heading.compare": "比べて選ぶ",
  "heading.done": "おつかれさまでした",

  "door.checking": "受付の状態を確認しています",
  "door.checkFailed":
    "受付の状態を確認できませんでした。通信の状態を確かめて、もう一度お試しください。",
  "door.recheck": "もう一度確認",
  "door.worker_stopped":
    "いまは停止しています。しばらくしてからもう一度お試しください。",
  "door.warming_up": "準備中です。",
  "door.quota_exhausted": "本日の利用枠に達しました。明日またお試しください。",
  "door.maintenance":
    "メンテナンス中です。しばらくしてからもう一度お試しください。",
  "door.reopen": "{time}ごろに再開できる見込みです。",

  "consult.scopeLabel": "どこを見ますか？",
  "consult.journey":
    "まず一枚撮り、希望すれば一手だけ試して比べます。選んだ写真は保存できます。変更せず、保存せずに終えても大丈夫です。",
  "consult.brow": "眉",
  "consult.bangs": "前髪",
  "consult.lookFirst": "まず見てほしい",
  "consult.wishLabel": "希望（任意）",
  "consult.wishHelp":
    "例：眉の形は変えたくないが、毛の流れは整えたい（200文字まで）",
  "consult.consentText":
    "撮影した写真は、助言をつくるためにクラウド（AWS）に送られて解析されます。処理後に削除し、残存時は定期回収します（24時間以内の削除が目標です）。確認質問のため観察メモを最大10分利用し、回答・終了時に削除します。期限切れのメモも定期回収します。比べるための写真は画面を開いている間だけ端末内に保持します。自分で保存した写真は終了後も端末に残ります。",
  "consult.consentCheck": "クラウドで解析されることに同意します",
  "consult.submit": "撮影へ進む",
  "consult.decline": "同意しない（終了する）",

  "capture.instruction": "顔が枠に入るように合わせて撮影してください。",
  "capture.photoAlt": "撮影した写真",
  "capture.send": "この写真で相談する",
  "capture.retake": "撮り直す",
  "capture.finish": "このままで終える",

  "run.uploading": "写真を送っています",
  "run.analysing": "解析しています",
  "run.timeout": "結果の確認に時間がかかっています。",
  "run.failed": "解析がうまくいきませんでした。撮り直してお試しください。",
  "run.uploadFailed": "写真を送れませんでした。もう一度お試しください。",

  "try.trying":
    "整えたら、同じ位置と光でもう一度撮影してください。整えている間は、新しい提案は出しません。",
  "try.do": "やってみる",
  "try.another": "別の提案",
  "try.check": "整えたので確認",
  "try.afterAlt": "整えた後の写真",
  "try.sendAfter": "この写真で確認する",
  "try.notComparable":
    "前の写真と条件が違うため、比べられません。撮り直してください。",

  "compare.beforeLabel": "整える前",
  "compare.mode": "比較の表示方法",
  "compare.side": "並べて見る",
  "compare.single": "一枚ずつ切り替える",
  "compare.view": "表示する写真",
  "compare.afterLabel": "整えた後",
  "compare.question": "どちらが好きですか？",
  "compare.preferBefore": "前が好き",
  "compare.preferAfter": "後が好き",
  "compare.unclear": "差が分からない",
  "compare.recorded": "選んだ内容を記録しました。どれを選んでも大丈夫です。",
  "compare.finish": "終える",
  "compare.nextLabel": "希望すれば、もう一手",
  "compare.nextButton": "もう一手試す",

  "save.help":
    "保存は任意です。保存する写真は、好みの回答とは別に選べます。保存したファイルは終了後も端末に残ります。",
  "save.current": "この写真を保存",
  "save.before": "前の写真を保存",
  "save.after": "後の写真を保存",
  "save.requested":
    "保存操作を開始しました。ブラウザの保存先を確認してください。保存されていなければ、もう一度操作してください。",
  "save.failed":
    "保存操作を開始できませんでした。もう一度試すか、そのまま終了できます。",

  "done.declined":
    "同意されなかったため、写真は送られていません。いつでもまたはじめられます。",
  "done.finished":
    "相談を終えました。この画面で保持していた写真を破棄しました。自分で保存したファイルは端末に残ります。クラウドの写真と観察メモにも削除を要求します。通信に失敗した場合は定期回収の対象になります。",
  "done.restart": "もう一度はじめる",

  "camera.preview": "カメラのプレビュー",
  "camera.reference": "位置合わせ用の前の写真",
  "camera.guide": "前の写真を重ねて位置を合わせる",
  "camera.guideHelp":
    "同じ向き・距離・光を目安にしてください。ガイドは写真に入りません。撮影条件が揃うことを保証するものではありません。",
  "camera.failed":
    "撮影できませんでした。もう一度試すか、そのまま終了できます。",
  "camera.denied":
    "カメラの使用が許可されていません。ブラウザの設定で許可してください。",
  "camera.unavailable": "カメラを使えませんでした。",
  "camera.shoot": "撮影する",
  "camera.testImage": "テスト用の画像を使う",
  "camera.testImageLabel": "モック",

  "error.session_ended": "この相談は終了しています。もう一度はじめてください。",
  "error.change_limit_reached":
    "試せるのは2回までです。ここまでの写真を比べて選べます。",
  "error.analysis_limit_reached": "この相談で解析できる回数に達しました。",
  "error.too_many_requests": "しばらくしてからもう一度お試しください。",
  "error.quota_exceeded": "本日の利用枠に達しました。",
  "error.service_unavailable":
    "いまは受け付けていません。時間をおいてお試しください。",
  "error.not_accepting":
    "いまは受け付けていません。時間をおいてお試しください。",
  "error.unauthenticated":
    "ログインの有効期限が切れました。ログインし直してください。",
  "error.generic": "うまくいきませんでした。もう一度お試しください。",
  "error.network":
    "うまくいきませんでした。通信の状態を確かめて、もう一度お試しください。",

  "pwa.update":
    "新しい版があります。更新するとページが再読み込みされ、撮影中の写真は消えます。",
  "pwa.updateButton": "更新する",
  "pwa.offline":
    "オフラインです。通信が戻るまで、撮影した写真の解析や送信はできません。",

  "mock.notice":
    "AWS上のAPIにはつながっていません。写真はこの端末の外へ送られず、助言は固定の再生データです。実際の解析ではありません。",
  "mock.title": "モック動作中。",
  "mock.scenario": "モックの状況",
  "mock.scenario.normal": "通常",
  "mock.scenario.backlight": "逆光（撮り直しの案内）",
  "mock.scenario.vague": "あいまい（確認の質問）",
  "mock.scenario.error": "解析の失敗",
  "mock.door": "受付",
  "mock.doorState": "受付の状態",
  "mock.door.open": "受付中",
  "mock.door.stopped": "停止中",
  "mock.door.warming": "準備中",
  "mock.door.quota": "利用枠切れ",
} as const;

export type MessageKey = keyof typeof ja;
