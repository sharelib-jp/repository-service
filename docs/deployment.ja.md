1. **起動方式を選んでください（目安 2 分）。** Docker Compose を使う場合は [コンテナで起動](containers.ja.md)、コンテナを使わない場合は [ローカルプロセスで起動](native.ja.md) を開きます。両リポジトリを同じ親フォルダーに配置してください。現在の構成は、auth-service が認証、repository-service が書誌・蔵書とローカルロールを管理します。

2. **GitHub Actions の公開条件を確認してください（目安 3 分）。** 各リポジトリの `.github/workflows/container.yml` が、Go テスト、フロントのテスト、本番ビルドに成功した後、フロントを含むサービスイメージを作成します。既定ブランチ（auth-service は master、repository-service は main）への push、`v*` タグ、手動実行で GHCR に公開します。Pull Request ではビルドまで行います。初回の公開完了までは、Compose の `build` でローカルイメージを作成できます。

   | リポジトリ | イメージ | タグ | 対応 CPU |
   |---|---|---|---|
   | auth-service | `ghcr.io/sharelib-jp/auth-service` | `latest`、`sha-…`、リリースバージョン | amd64 / arm64 |
   | repository-service | `ghcr.io/sharelib-jp/repository-service` | `latest`、`sha-…`、リリースバージョン | amd64 / arm64 |

   公開にはジョブ内の `GITHUB_TOKEN` と `packages: write` を使います。追加の公開用 PAT は不要です。既存パッケージへの書き込みが拒否された場合は、GHCR のパッケージ設定で対象リポジトリの Actions に書き込み権限を設定します。非公開イメージを取得する環境では、先に `read:packages` を持つ資格情報で `docker login ghcr.io` を実行します。

3. **設定と秘密情報を別に用意してください（目安 3 分）。** イメージには実際の `config.toml`、README.md、秘密鍵、`.env`、データベースを含めません。`deploy/prepare.py` が専用の `.env` と `deploy/runtime/` の設定を生成します。既存の config.toml は変更しません。生成された `.env` と runtime は Git 管理対象外です。

4. **DB → auth-service → クライアント登録 → repository-service の順で起動してください（目安 10〜20 分）。** コンテナ版は独立した PostgreSQL を２つ、非コンテナ版は localhost と SQLite を使います。HTTPS のコンテナ版では最後に Caddy を公開します。`/api/auth/login` から auth-service の認証・同意に進み、`/auth/callback` で戻ります。ログイン後も業務 API はローカルロール `admin` がなければ 403 です。最初の管理者だけは DB で割り当てます。

5. **起動確認を行ってください（目安 2 分）。** auth-service の `/.well-known/openid-configuration` が 200 を返し、repository-service の `/api/auth/session` が JSON を返せば、ログインを開始できます。502 はプロキシの接続先サービス、401 は認証・クライアント設定、ログイン後の 403 はユーザーの状態と admin ロールを確認します。現在の `openid profile email` 設定ではアクセストークンの期限後に再ログインが必要です。ブラウザへトークンは保存しません。

次に、選んだ起動手順の１番目を実行してください。
