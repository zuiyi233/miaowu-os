# Design

## Deployment Shape

Miaowu v1 uses horizontally replicated frontend/gateway nodes, but shared state stays centralized:

- PostgreSQL primary: 31 candidate production database.
- Object storage: existing 161/162 VIP-backed SeaweedFS/S3-compatible service.
- Auth: NewAPI OIDC plus shared Miaowu JWT/encryption secrets.
- Public entry: `xs.miaowu.bond`.

This is not a multi-primary deployment. The first version accepts manual or semi-automatic traffic switching between stateless nodes.

## Env Contract

All production gateway nodes share the same values for database, object storage, JWT, encryption, NewAPI OIDC, and NewAPI provider groups. Node-specific values are limited to instance identity, logging, published port, and health-check routing.

Object storage supports two env name families:

- Preferred Miaowu names: `MIAOWU_OBJECT_STORAGE_*`.
- Generic S3 aliases: `STORAGE_BACKEND`, `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_PATH_STYLE`, `S3_PUBLIC_DOMAIN`.

Miaowu-specific names take precedence when both are set.

## Disk-State Boundary

Production readiness depends on classifying all local writes:

- `canonical`: must move to PostgreSQL or object storage before public cutover.
- `cache/draft/runtime`: may remain local only if node loss is acceptable.
- `legacy/read-only`: may remain for compatibility, but must not receive new canonical writes.

The runbook records the first audit set: legacy novel JSON store, workspace documents, uploads, draft media, channels state, LangGraph/checkpointer stores, sandbox user-data, and credential/auth files.

## Rollout Boundary

The rollout order is:

1. 31 verify/candidate stack.
2. 161 production stack.
3. 162 standby stack.
4. Tokyo and US frontend/gateway replicas.

Traffic is switched only after health and smoke checks pass. Rollback means restoring the previous compose/env backup and previous frontend/gateway image tags for the affected node.
