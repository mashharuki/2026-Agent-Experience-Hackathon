# メール確認付きサインアップ（2026-10-21）

ユーザーの依頼により、招待制からメール確認付きセルフ登録へ変更し、既存AWS環境へ公開した。

## 実装

- ログイン前の画面に「新規登録」／「Create account」とメール確認の案内を追加。認証エラー後にもログイン・登録へ戻れる。
- Cognitoの登録画面へ遷移し、既存の認可コード＋PKCE S256、state、API scope、コールバックを共有する。パスワードや確認コードはアプリのAPIへ送らない。
- 既存ユーザープールのセルフ登録許可だけをインプレース更新。メール自動検証・コード方式、12文字以上と英大文字／小文字／数字／記号のパスワード条件、公開クライアントを維持。
- React/Vite/MUI、Cognito、CDKを使う既存スタック内の変更。業務OpenAPIの8操作・生成クライアント・バックエンド依存に変更なし。
- 10セッション／人・日、全体100／日、3解析／セッション、所有権確認、受付停止を維持。解析ワーカーは起動していない。

## 検証

| 対象 | 結果 |
| --- | --- |
| Frontend | 149テスト成功。日英、ボタンの呼出先、エラー後の再開、登録URLのPKCE・scope・callbackを確認 |
| CDK | 51テスト成功。セルフ登録・email確認・コード方式・既存のJWT保護を検査 |
| 静的検査 | Frontend／CDKのTypeScript、Biome、Oxlint、Knip、差分検査を通過。Oxlint・Knipには既存の警告／設定ヒントあり |
| AWS差分 | Cognito UserPoolのAllowAdminCreateUserOnlyをtrue→false。プール置換なし |
| AWS実設定 | UPDATE_COMPLETE、既存プールID維持、email自動検証、CONFIRM_WITH_CODE、公開クライアント、code grantを確認 |
| 公開UI | 新規登録ボタン→実CognitoのEmail／Password／Sign upフォームへ遷移。PKCE・state・API scopeを確認 |
| 費用管理 | ワーカーdesired/running/pendingすべて0。モデル呼び出しなし |

メール送信・受信、確認コード入力後の本人による登録完了は未検証。本人のアドレス・パスワードを代理入力したり、管理者による確認でメール所有の証明を代替したりしていない。Cognitoの外部画面は現行のclassic Hosted UI標準表示（英語）を使う。

再現用の設定確認・公開ログ・スクリーンショットは `report/aws-validation/2026-10-21/signup/`（git管理外）に保存。

参考：[Cognito CDKの登録・確認設定](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito-readme.html)、[OAuth認可とPKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)。
