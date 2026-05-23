# Implementation Plan

1. Create Trellis artifacts manually because `task.py` is blocked by missing `common.safe_commit`.
2. Add a production multi-region runbook under `deer-flow-main/docs`.
3. Add a production env template for `xs.miaowu.bond` and shared data sources.
4. Add a production compose template for one stateless frontend/gateway node.
5. Add a smoke-check PowerShell script for repeated node validation.
6. Add object storage env alias support so the implementation matches the public rollout contract.
7. Add focused unit coverage for generic S3 alias handling.
8. Run targeted tests and syntax checks that do not require live servers.

## Validation

- `uv run pytest tests/test_novel_unified_persistence.py -q`
- `uv run python -m compileall app/gateway/novel_migrated/core/object_storage.py`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-miaowu-multiregion.ps1 -Help`

## 2026-05-24 Production Entry Execution

- Created Cloudflare DNS record `xs.miaowu.bond` as proxied A record to Tokyo `43.153.144.152`.
- Added 31 -> Tokyo FRP proxies in `/opt/stacks/frpc-tokyo-31/frpc.toml`:
  - `miaowu_xs_frontend_31_tokyo`: `127.0.0.1:14560 -> 57030`
  - `miaowu_xs_gateway_31_tokyo`: `127.0.0.1:18551 -> 57031`
- Added Tokyo Nginx vhost `/etc/nginx/conf.d/xs-miaowu-bond.conf`.
- Registered production NewAPI OIDC confidential client `miaowu-os-xs-prod` in `new_api_prod.oauth_clients`.
- Switched 31 Miaowu env to:
  - `NEWAPI_OAUTH_ISSUER=https://api.miaowu.bond`
  - `NEWAPI_OAUTH_CLIENT_ID=miaowu-os-xs-prod`
  - `NEWAPI_OAUTH_REDIRECT_URI=https://xs.miaowu.bond/api/v1/auth/callback/newapi`
  - `MIAOWU_PUBLIC_FRONTEND_URL=https://xs.miaowu.bond`
- Verified public unauthenticated smoke:
  - `https://xs.miaowu.bond/` returned 200 HTML.
  - `https://xs.miaowu.bond/health` returned 200 JSON.
  - `https://xs.miaowu.bond/api/v1/auth/setup-status` returned 200 JSON.
  - `https://xs.miaowu.bond/api/v1/auth/login/newapi?next=/workspace` returned 302 to production `https://api.miaowu.bond/oauth/authorize`.
  - Direct production NewAPI authorize check returned sign-in redirect, not `unknown_client`.
- Remaining acceptance gaps:
  - Full browser login/callback was not completed in this session.
  - Authenticated novel/media/AI-settings/streaming/cross-user smoke remains pending.
  - Startup still reports legacy `novel_store.json` and LangGraph `InMemoryStore`; keep local-disk state audit open.

## 2026-05-24 XS EdgeOne and XG NewAPI Fast Path Correction

- Changed Cloudflare DNS for `xs.miaowu.bond` from proxied A to DNS-only CNAME:
  - `xs.miaowu.bond CNAME xs.miaowu.bond.eo.dnse3.com`
  - `proxied=false`
- Verified public DNS now resolves through EdgeOne:
  - `xs.miaowu.bond -> xs.miaowu.bond.eo.dnse3.com`
  - EdgeOne A records include `43.174.246.57` and `43.174.247.57`.
- Updated 31 Miaowu env to use `xg.miaowu.bond` for NewAPI:
  - `NEWAPI_OAUTH_ISSUER=https://xg.miaowu.bond`
  - `NEWAPI_OAUTH_PUBLIC_ISSUER=https://xg.miaowu.bond`
  - `MIAOWU_NEWAPI_BASE_URL=https://xg.miaowu.bond/v1`
  - `NEWAPI_OPENAI_BASE_URL=https://xg.miaowu.bond/v1`
  - `OPENAI_BASE_URL=https://xg.miaowu.bond/v1`
- Verified `xg.miaowu.bond` OIDC discovery:
  - issuer is `https://xg.miaowu.bond`
  - authorize/token/userinfo endpoints use `xg.miaowu.bond`
- Verified `xs` still serves Miaowu, not NewAPI:
  - `GET https://xs.miaowu.bond/health` returned HTTP 200 with `X-Miaowu-Entry: xs.miaowu.bond`.
  - `GET https://xs.miaowu.bond/api/v1/auth/setup-status` returned HTTP 200.
  - `GET https://xs.miaowu.bond/api/v1/auth/login/newapi?next=/workspace` returned 302 to `https://xg.miaowu.bond/oauth/authorize`.
- Validation caveat:
  - PowerShell smoke currently fails TLS trust validation against the EdgeOne/origin certificate chain; `curl -k` validates HTTP behavior.

## 2026-05-24 XG Tunnel Reuse Source-Side Preparation

- Deployed and verified 161 Host router for future `xs` reuse of the existing `xg` MEFrp tunnel:
  - `Host: xg.miaowu.bond` routes to 161 NewAPI at `127.0.0.1:3000`.
  - `Host: xs.miaowu.bond` routes to 31 Miaowu frontend/gateway at `10.200.31.6:14560` and `10.200.31.6:18551`.
- Updated `/opt/xg-mefrp-web/frpc.toml`:
  - Kept `customDomains = ['xg.miaowu.bond']`.
  - Changed `localAddr` to `127.0.0.1:13003`.
  - Removed `hostHeaderRewrite` so Host-based routing works.
  - Backup: `/opt/xg-mefrp-web/frpc.toml.bak-xs-router-20260524-004817`.
- Restored `/opt/xg-certd/Caddyfile` to xg-only after the failed xg+xs certificate attempt:
  - Current cert automation target is only `xg.miaowu.bond`.
  - The failed xs cert attempt did not overwrite `/opt/xg-mefrp-web/certs`.
- Verified:
  - `https://xg.miaowu.bond/api/status` returns HTTP 200 after restart.
  - `https://xg.miaowu.bond/.well-known/openid-configuration` returns issuer/endpoints for `https://xg.miaowu.bond`.
  - 161 local Host router returns Miaowu health for `Host: xs.miaowu.bond`.
  - Public `https://xs.miaowu.bond/api/v1/auth/login/newapi?next=/workspace` redirects to `https://xg.miaowu.bond/oauth/authorize`.
- Not yet completed:
  - Public `xs.miaowu.bond` still uses EdgeOne -> Tokyo -> 31 path; current `/health` header shows `X-Miaowu-Upstream-Addr: 127.0.0.1:57031`.
  - Direct `xs` SNI to MEFrp fails because xg tunnel cert covers only `xg.miaowu.bond`.
  - No Tencent EdgeOne API credentials were found in the current environment, so EdgeOne origin settings were not changed.
  - Required EdgeOne final setting: origin address `xg.miaowu.bond` or `64.90.1.194`, HTTPS origin protocol, origin SNI `xg.miaowu.bond`, origin Host `xs.miaowu.bond`.

## 2026-05-24 EdgeOne 525 Attempt and Rollback for XS via XG Tunnel

- User reported `GET https://xs.miaowu.bond/ net::ERR_HTTP_RESPONSE_CODE_FAILURE 525` after setting EdgeOne origin to `xg.miaowu.bond`.
- Root cause: `xg-mefrp-web` still served a certificate that only covered `xg.miaowu.bond`; EdgeOne was using `xs.miaowu.bond` SNI/Host on origin TLS, causing handshake failure.
- Issued a new RSA 2048 SAN certificate via acme.sh DNS challenge using the existing Cloudflare DNS token from `xg-certd`:
  - `DNS:xg.miaowu.bond`
  - `DNS:xs.miaowu.bond`
- Temporarily installed the SAN certificate into `/opt/xg-mefrp-web/certs/fullchain.pem` and `/opt/xg-mefrp-web/certs/privkey.pem`.
- Temporarily updated `/opt/xg-mefrp-web/frpc.toml`:
  - `customDomains = ['xg.miaowu.bond', 'xs.miaowu.bond']`
  - `localAddr = '127.0.0.1:13003'`
- Result:
  - MEFrp briefly reported the tunnel available for both domains, but the tunnel state became unstable and the provider UI showed offline/disabled.
  - Public `xg` also timed out during the attempt.
- Rollback:
  - Restored `xg-mefrp-web` to `customDomains = ['xg.miaowu.bond']`.
  - Restored the xg-only certificate.
  - Kept `localAddr = '127.0.0.1:13003'` so `xg` still flows through the Host router to NewAPI.
- Current verification:
  - `https://xg.miaowu.bond/api/status` returns HTTP 200.
  - `https://xs.miaowu.bond/health` still returns EdgeOne 525 if EdgeOne continues to use `xg` as origin.
- Operational conclusion:
  - To restore `xs` now, set EdgeOne origin back to the previous Tokyo source (`43.153.144.152:443`, Host `xs.miaowu.bond`).
  - Reusing `xg` for `xs` requires MEFrp dashboard-side support/stable enablement of `xs.miaowu.bond` as a second custom domain; local frpc config and SAN certificate alone are not enough.

## 2026-05-24 Dedicated XS MEFrp Tunnel

- Created a separate 161 stack for `xs.miaowu.bond`:
  - `/opt/xs-miaowu-mefrp-web`
  - container `xs-miaowu-mefrp-web`
- Used provider node:
  - `serverAddr = 'hk1.mefrp.hoshino2.top'`
  - `serverPort = 2888`
  - resolved IP `103.24.219.160`
- Adjusted the provider template to match the real local source:
  - provider template had `https2https` and `localAddr = '127.0.0.1:36666'`
  - deployed config uses `https2http` and `localAddr = '127.0.0.1:13003'`
  - reason: 161 `miaowu-xs-host-router` is HTTP on `127.0.0.1:13003`
- Matched the existing `xg-mefrp-web` container startup pattern:
  - `command: ['-c', '/etc/frp/frpc.toml']`
  - `network_mode: host`
- Verification:
  - `xs-miaowu` MEFrp logs show tunnel registered and started successfully.
  - `curl --resolve xs.miaowu.bond:443:103.24.219.160 https://xs.miaowu.bond/health` returns HTTP 200 with `X-Miaowu-Upstream-Addr: 10.200.31.6:18551`.
  - `curl --resolve xs.miaowu.bond:443:103.24.219.160 https://xs.miaowu.bond/api/v1/auth/login/newapi?next=/workspace` returns 302 to `https://xg.miaowu.bond/oauth/authorize`.
  - `https://xg.miaowu.bond/api/status` remains HTTP 200.
- EdgeOne must now use this dedicated origin:
  - origin `hk1.mefrp.hoshino2.top` or `103.24.219.160`
  - HTTPS port 443
  - origin Host `xs.miaowu.bond`
  - do not use `xg.miaowu.bond` as the `xs` origin.

## Rollback

- Revert the new docs/templates/script files.
- Revert `object_storage.py` and the new unit test if env alias behavior is not desired.
