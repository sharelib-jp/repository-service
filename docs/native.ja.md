1. **localhost 用の設定を生成してください（目安 3 分）。** Go 1.27.3 以降、Node.js 24、pnpm 12.14.0、Python 3.11 以降、OpenSSL を用意します。auth-service・repository-service・_deploy を同じ親フォルダーに置き、_deploy で次を実行します。この方式はコンテナと PostgreSQL を使わず、SQLite を使います。

   ```sh
   cd _deploy
   python3 prepare.py --native
   ```

   設定・DB・署名鍵は `_deploy/runtime/`、秘密値は `_deploy/.env` に作成されます。URL は auth-service が `http://localhost:8080`、repository-service が `http://localhost:8081` です。127.0.0.1 と localhost を混在させないでください。

2. **両方のフロントをビルドしてください（目安 3〜5 分）。** 依存関係はロックファイルに従ってインストールします。以降は Go サーバーがフロントも配信します。

   ```sh
   cd ../repository-service
   pnpm --dir ../auth-service/web install --frozen-lockfile
   pnpm --dir ../auth-service/web run build
   pnpm --dir web install --frozen-lockfile
   pnpm --dir web run build
   ```

   auth-service の配信ファイルは `handlers/web/dist`、repository-service は `web/dist` に作成されます。

3. **別のターミナルで auth-service を起動してください（目安 2 分）。** 信頼できる自分の `_deploy/.env` を読み込みます。このターミナルは起動したままにしてください。

   ```sh
   cd auth-service
   set -a
   . ../_deploy/.env
   set +a
   go run . -config ../_deploy/runtime/auth/config.toml
   ```

   `http://localhost:8080/.well-known/openid-configuration` が 200 を返せば、認証側の準備は完了です。

4. **クライアントを登録してから repository-service を起動してください（目安 3 分）。** まず別のターミナルで初回登録を行います。登録済みの場合はこの登録処理を繰り返しません。

   ```sh
   cd auth-service
   set -a
   . ../_deploy/.env
   set +a
   OAUTH_CLIENT_SECRET="$REPOSITORY_OIDC_CLIENT_SECRET" go run ./cmd/oauthctl -config ../_deploy/runtime/auth/config.toml client < ../_deploy/runtime/client.json
   cd ../repository-service/api
   go run . -config ../../_deploy/runtime/repository/config.toml
   ```

   `http://localhost:8081/api/auth/session` が JSON を返せば、両サービスが起動しています。フロントを Vite で編集する場合だけ、追加で各 web ディレクトリの `pnpm dev` を使います。OIDC の戻り先は引き続き config.toml の URL と一致させてください。

5. **ログインして最初の管理者を設定してください（目安 3 分）。** `http://localhost:8081` を開き、auth-service でアカウント登録・ログイン・連携の許可を行います。初回の 403 は admin 未設定を示します。別のターミナルから次の Python コードで利用者 ID を確認します。

   ```sh
   cd _deploy
   python3 - <<'PY'
   import sqlite3
   with sqlite3.connect('runtime/repository/database.db') as db:
       for row in db.execute('SELECT id, display_name_cache, auth_subject FROM users'):
           print(row)
   PY
   ```

   対象のローカルユーザー UUID を次のコードに入力して実行します。

   ```sh
   python3 - <<'PY'
   import sqlite3
   user_id = '対象のローカルユーザーUUID'
   with sqlite3.connect('runtime/repository/database.db') as db:
       db.execute('PRAGMA foreign_keys = ON')
       db.execute('INSERT INTO user_roles(user_id,role_id) VALUES (?,?) ON CONFLICT DO NOTHING', (user_id, 'admin'))
   PY
   ```

   再読み込み後はユーザー・ロール設定画面から管理できます。以降のロール変更は同画面で行ってください。

次に、`http://localhost:8081` を再読み込みしてください。

CiNii Research の書誌検索を使用する場合は、[CiNii の API 利用登録](https://support.nii.ac.jp/ja/cinii/api/developer)で取得したアプリケーション ID を、repository-service の起動環境に `CINII_APP_ID` として設定してください。検索画面で「CiNii Research（NACSIS-CAT）」を選べます。アプリケーション ID はクライアントに送信せず、サーバーから CiNii に送信します。

必要に応じて `CINII_USER_AGENT` に利用アプリケーションを識別できる User-Agent を設定できます。未指定時は `api/connectors/cinii-books.yaml` の `User-Agent` が使用され、検索と詳細取得の両方に適用されます。User-Agent を変更してもアクセスできるとは限りません。

NDL サーチは SRU の `recordSchema=dcndl_v3` で候補を取得し、選択した候補の識別子に対して OAI-PMH の `GetRecord`（`metadataPrefix=dcndl_v3`）を実行します。既定の `sources.yaml` の `detail: ndl` が個別取得を有効にします。DC-NDL v3 の著者名・読み・役割・典拠 URI、巻次、NDL 書誌 ID、トーハン番号をフォームへ反映できます。提供元によって個別取得できない場合は、画面の「検索結果の情報を使用」で SRU の応答内にある DC-NDL を反映できます。
