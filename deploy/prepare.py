#!/usr/bin/env python3
"""Create deployment settings without modifying either repository's config.toml."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
from urllib.parse import quote

BASE = Path(__file__).resolve().parent

def load_env():
    path = BASE / '.env'
    if not path.exists():
        path.write_text((BASE / '.env.example').read_text())
        path.chmod(0o600)
    values = {}
    for line in path.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    for name in ['AUTH_DATABASE_PASSWORD', 'REPOSITORY_DATABASE_PASSWORD',
                 'OAUTH_HMAC_SECRET', 'REPOSITORY_OIDC_CLIENT_SECRET']:
        if not values.get(name):
            values[name] = secrets.token_urlsafe(32)
    path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
    path.chmod(0o600)
    return values

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native', action='store_true', help='Use localhost origins and SQLite without containers')
    args = parser.parse_args()
    os.umask(0o077)
    env = load_env()
    runtime = BASE / 'runtime'
    runtime.mkdir(exist_ok=True)
    auth_origin = 'http://localhost:8080' if args.native else 'https://' + env['AUTH_DOMAIN']
    repo_origin = 'http://localhost:8081' if args.native else 'https://' + env['REPOSITORY_DOMAIN']
    if not args.native:
        for name in ['AUTH_DOMAIN', 'REPOSITORY_DOMAIN']:
            if not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?', env[name]) or env[name].endswith('.example.com'):
                raise SystemExit('Set AUTH_DOMAIN and REPOSITORY_DOMAIN in deploy/.env to your HTTPS hostnames, then rerun.')
        if env['AUTH_DOMAIN'] == env['REPOSITORY_DOMAIN']:
            raise SystemExit('AUTH_DOMAIN and REPOSITORY_DOMAIN must be different hostnames.')
    key = runtime / 'keys' / 'oidc-signing.pem'
    if args.native:
        key.parent.mkdir(exist_ok=True)
        if not key.exists():
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', str(key)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            key.chmod(0o600)
    for name, port, origin in [('auth',8080,auth_origin), ('repository',8081,repo_origin)]:
        folder = runtime / name
        folder.mkdir(exist_ok=True)
        hostname = 'localhost' if args.native else env['AUTH_DOMAIN' if name == 'auth' else 'REPOSITORY_DOMAIN']
        driver = 'sqlite' if args.native else 'postgres'
        password = env['AUTH_DATABASE_PASSWORD' if name == 'auth' else 'REPOSITORY_DATABASE_PASSWORD']
        dsn = str(folder / 'database.db') + '?_foreign_keys=on&_busy_timeout=5000&_txlock=immediate' if args.native else f'postgres://{name}:{quote(password,safe="")}@{name}-db:5432/{name}?sslmode=disable'
        text = f'[HOST]\nSCHEME = "{origin.split(":")[0]}://"\nHOSTNAME = {json.dumps(hostname)}\nPORT = ":{port}"\n\n[WEBAUTHN]\nRP_DISPLAY_NAME = "Sharelib"\nRP_ORIGIN = {json.dumps(origin)}\n\n[DATABASE]\nDATABASE_DRIVER = "{driver}"\nDATABASE_DSN = {json.dumps(dsn)}\n\n[BRANDRESOURCES]\nHEADER = "resources/header.svg"\n'
        if name == 'auth':
            text += f'\n[OAUTH]\nENABLED = true\nISSUER = {json.dumps(auth_origin)}\nSIGNING_KEY_FILE = {json.dumps(str(key) if args.native else "/app/keys/oidc-signing.pem")}\nSIGNING_KEY_ID = "sharelib-1"\n'
        else:
            text += f'\n[OIDC]\nENABLED = true\nISSUER = {json.dumps(auth_origin)}\nCLIENT_ID = "repository-service"\nREDIRECT_URI = {json.dumps(repo_origin + "/auth/callback")}\nSCOPES = ["openid", "profile", "email"]\nCLIENT_SECRET_ENV = "REPOSITORY_OIDC_CLIENT_SECRET"\n'
        target = folder / 'config.toml'
        target.write_text(text)
        target.chmod(0o600 if args.native else 0o644)
    client = {'id':'repository-service','name':'Sharelib repository','public':False,
              'redirect_uris':[repo_origin + '/auth/callback'], 'grant_types':['authorization_code'],
              'scopes':['openid','profile','email'], 'audience':[]}
    (runtime / 'client.json').write_text(json.dumps(client,ensure_ascii=False) + '\n')
    print('Created runtime/auth/config.toml, runtime/repository/config.toml and runtime/client.json; existing config.toml files are unchanged.')

if __name__ == '__main__':
    main()
