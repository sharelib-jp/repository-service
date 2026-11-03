1. **localhost 用の設定を生成してください（目安 3 分）。** Go 1.27.3 以降、Node.js 24、pnpm 12.14.0、Python 3.11 以降、OpenSSL を用意します。両リポジトリを同じ親フォルダーに置き、repository-service で次を実行します。この方式はコンテナと PostgreSQL を使わず、SQLite を使います。

   ```sh
   cd repository-service
   python3 deploy/prepare.py --native
   ```

   設定・DB・署名鍵は `deploy/runtime/`、秘密値は `deploy/.env` に作成されます。URL は auth-service が `http://localhost:8080`、repository-service が `http://localhost:8081` です。127.0.0.1 と localhost を混在させないでください。

2. **両方のフロントをビルドしてください（目安 3〜5 分）。** 依存関係はロックファイルに従ってインストールします。以降は Go サーバーがフロントも配信します。

   ```sh
   pnpm --dir ../auth-service/web install --frozen-lockfile
   pnpm --dir ../auth-service/web run build
   pnpm --dir web install --frozen-lockfile
   pnpm --dir web run build
   ```

   auth-service の配信ファイルは `handlers/web/dist`、repository-service は `web/dist` に作成されます。

3. **別のターミナルで auth-service を起動してください（目安 2 分）。** 信頼できる自分の `deploy/.env` を読み込みます。このターミナルは起動したままにしてください。

   ```sh
   cd auth-service
   set -a
   . ../repository-service/deploy/.env
   set +a
   go run . -config ../repository-service/deploy/runtime/auth/config.toml
   ```

   `http://localhost:8080/.well-known/openid-configuration` が 200 を返せば、認証側の準備は完了です。

4. **クライアントを登録してから repository-service を起動してください（目安 3 分）。** まず別のターミナルで初回登録を行います。登録済みの場合はこの登録処理を繰り返しません。

   ```sh
   cd auth-service
   set -a
   . ../repository-service/deploy/.env
   set +a
   OAUTH_CLIENT_SECRET="$REPOSITORY_OIDC_CLIENT_SECRET" go run ./cmd/oauthctl -config ../repository-service/deploy/runtime/auth/config.toml client < ../repository-service/deploy/runtime/client.json
   cd ../repository-service/api
   go run . -config ../deploy/runtime/repository/config.toml
   ```

   `http://localhost:8081/api/auth/session` が JSON を返せば、両サービスが起動しています。フロントを Vite で編集する場合だけ、追加で各 web ディレクトリの `pnpm dev` を使います。OIDC の戻り先は引き続き config.toml の URL と一致させてください。

5. **ログインして最初の管理者を設定してください（目安 3 分）。** `http://localhost:8081` を開き、auth-service でアカウント登録・ログイン・連携の許可を行います。初回の 403 は admin 未設定を示します。別のターミナルから次の Python コードで利用者 ID を確認します。

   ```sh
   cd repository-service
   python3 - <<'PY'
   import sqlite3
   with sqlite3.connect('deploy/runtime/repository/database.db') as db:
       for row in db.execute('SELECT id, display_name_cache, auth_subject FROM users'):
           print(row)
   PY
   ```

   対象のローカルユーザー UUID を次のコードに入力して実行します。

   ```sh
   python3 - <<'PY'
   import sqlite3
   user_id = '対象のローカルユーザーUUID'
   with sqlite3.connect('deploy/runtime/repository/database.db') as db:
       db.execute('PRAGMA foreign_keys = ON')
       db.execute('INSERT INTO user_roles(user_id,role_id) VALUES (?,?) ON CONFLICT DO NOTHING', (user_id, 'admin'))
   PY
   ```

   再読み込み後はユーザー・ロール設定画面から管理できます。以降のロール変更は同画面で行ってください。

次に、`http://localhost:8081` を再読み込みしてください。
