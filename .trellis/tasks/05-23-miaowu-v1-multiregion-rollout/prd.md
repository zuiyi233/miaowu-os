# Miaowu v1 Multi-Region Rollout Readiness

## Goal

Prepare Miaowu for a v1 production multi-region deployment without claiming full active-active readiness.

The target shape is multiple stateless frontend/gateway entry nodes connected to one PostgreSQL primary, one S3-compatible object storage truth, and one NewAPI OIDC identity source.

## Requirements

- Use `xs.miaowu.bond` as the formal Miaowu public entry.
- Do not modify or repurpose `xg.miaowu.bond`; it remains bound to NewAPI.
- Use 31 as the first production PostgreSQL candidate and verify/candidate stack, not as the default public primary entry.
- Keep object storage on the existing 161/162 VIP-backed SeaweedFS/S3-compatible path for v1.
- Do not hot-merge 31's SeaweedFS POC into the production quorum.
- Provide production env contracts for shared secrets, NewAPI OIDC, database URL, CORS/trusted origins, and object storage.
- Provide a multi-node compose template and rollout SOP for 31 verify -> 161 production -> 162 standby -> Tokyo/US replicas.
- Audit local filesystem state categories before treating gateway nodes as stateless.
- Provide smoke checks for health, auth, cross-node data visibility, object storage, long tasks, and rollback.

## Acceptance Criteria

- A deployer can identify every required production env var without reading code.
- A deployer can build/tag/publish the frontend/gateway image with a stable tag rule.
- A deployer can start one node using the supplied production compose template.
- The runbook explicitly blocks active-active multi-primary rollout.
- The runbook explicitly protects `xg.miaowu.bond`.
- The runbook lists local filesystem paths that must be classified before public cutover.
- A smoke script exists for repeated node health and cross-node checks.
- Object storage config accepts both Miaowu-specific env names and the generic S3 env names used in the rollout contract.

## Out of Scope

- Creating live DNS records or changing Cloudflare/EdgeOne/FRP routes.
- Deploying containers to 31/161/162/Tokyo/US in this task.
- Migrating existing local disk state into PostgreSQL/object storage.
- Implementing active-active multi-primary database or object storage replication.
