1. **設定を生成し、HTTPS 用ホスト名を設定してください（目安 5 分）。** Docker Engine と Compose v2、Python 3.11 以降を用意し、repository-service の `deploy` に移動します。初回実行で秘密値を生成します。ホスト名が未設定なら処理は停止します。その後 `.env` の `AUTH_DOMAIN` と `REPOSITORY_DOMAIN` を実際のホスト名に変更し、再実行してください。両方の DNS をコンテナホストへ向け、80・443 番ポートを Caddy が使えるようにします。Caddy は公開 CA の証明書を取得する構成です。

   ```sh
   cd repository-service/deploy
   python3 prepare.py
   # .env の AUTH_DOMAIN と REPOSITORY_DOMAIN を編集する
   python3 prepare.py
   docker compose config --quiet
   ```

   この時点で config.toml は `runtime/auth/` と `runtime/repository/` にあり、秘密値は `.env` にあります。既存の設定は変更されません。`.env` と DB・署名鍵のボリュームを保存してください。

2. **イメージを取得し、DB と署名鍵を準備してください（目安 5〜15 分）。** GHCR への公開が完了していれば次を実行します。公開前に試す場合は、`docker compose pull auth repository` の代わりに `docker compose build auth repository` を実行します。ローカルビルドでは同じ親フォルダーの auth-service も使います。

   ```sh
   docker compose pull auth repository auth-db repository-db gateway
   docker compose up -d --wait auth-db repository-db
   docker compose run --rm --no-deps --entrypoint sh auth -c 'umask 077; test -s /app/keys/oidc-signing.pem || openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /app/keys/oidc-signing.pem'
   ```

   DB が healthy になり、署名鍵は `auth_keys` ボリュームに保持されます。再実行で既存の鍵は上書きしません。

3. **auth-service を起動し、repository-service をクライアント登録してください（目安 2 分）。** 初回登録に必要なシークレットは、Compose が `.env` から渡します。登録済みの場合は再登録せず、既存の redirect URI・scope・シークレットとの一致を確認します。意図して設定を変更するときだけ `client` を `client-update` に変更してください。更新すると既存トークンは失効します。

   ```sh
   docker compose up -d --wait auth
   docker compose exec -T auth /app/oauthctl -config /app/config.toml client < runtime/client.json
   ```

   登録されるクライアント ID は `repository-service`、redirect URI は `https://REPOSITORY_DOMAIN/auth/callback` です。

4. **repository-service と HTTPS の入口を起動してください（目安 3〜5 分）。** 初回は Caddy の証明書取得を待ちます。各サービスにはビルド済みフロントが含まれるため、Vite の起動は不要です。

   ```sh
   docker compose up -d --wait repository gateway
   docker compose ps
   ```

   `https://AUTH_DOMAIN/.well-known/openid-configuration` が 200 を返すことを確認します。502 の場合は `docker compose logs --tail=50 auth repository gateway` で停止したサービスを確認します。OAuth コードやトークンを含むアクセスログは有効にしないでください。

5. **初回ログイン後に管理者を１人割り当ててください（目安 3 分）。** `https://REPOSITORY_DOMAIN` から auth-service でアカウント登録・ログイン・連携の許可を行います。初回の 403 は、まだ admin が割り当てられていない状態です。次の SQL でローカルユーザーを確認し、該当する ID を指定してください。

   ```sh
   docker compose exec repository-db psql -U repository -d repository
   ```

   ```sql
   SELECT id, display_name_cache, auth_issuer, auth_subject FROM users;
   INSERT INTO user_roles(user_id, role_id)
     VALUES ('対象のローカルユーザーUUID', 'admin') ON CONFLICT DO NOTHING;
   \q
   ```

   再読み込み後に業務メニューとユーザー・ロール設定が利用できます。admin 以外のユーザーは、編集者を含め業務 API で 403 になります。

次に、repository-service のログイン画面で「auth-service でログイン」を実行してください。
