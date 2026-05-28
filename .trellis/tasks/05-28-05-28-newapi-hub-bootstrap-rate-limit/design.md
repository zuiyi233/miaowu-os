# Design

## NewAPI

- Add configurable Hub bootstrap rate limit values with defaults:
  - `HUB_BOOTSTRAP_RATE_LIMIT_ENABLE=true`
  - `HUB_BOOTSTRAP_RATE_LIMIT=60`
  - `HUB_BOOTSTRAP_RATE_LIMIT_DURATION=1200`
- Add `HubBootstrapRateLimit()` middleware in the existing rate-limit middleware family.
- Resolve the rate-limit identity from `Authorization` without returning or logging token material:
  - First try system access token via `model.ValidateAccessToken`.
  - Then try OIDC access token via `model.GetOIDCTokenByAccessToken`.
  - Use `HB:user:<id>` if a user is resolved; otherwise use `HB:ip:<client_ip>`.
- Change only `/api/hub/session/bootstrap` to use the new middleware; leave `CriticalRateLimit()` unchanged for sensitive routes.

## Miaowu

- Add a small async delay between group bootstrap requests.
- On HTTP 429:
  - Record current group as an error with retry-aware message.
  - Mark remaining groups as skipped due to NewAPI rate limit.
  - Stop further NewAPI bootstrap requests for the batch.
- Preserve existing successful group persistence behavior.
- Surface per-group errors through existing result fields; no API shape change unless needed for `Retry-After` text.
