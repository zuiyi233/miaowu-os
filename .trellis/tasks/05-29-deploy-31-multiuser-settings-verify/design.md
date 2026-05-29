# Design

## Scope Boundary

This task is a test-stack deployment and runtime verification task, not a new feature-design task. The code changes already exist in the current workspace. The design work here is about how to safely push those changes to the 31 Miaowu test stack and how to verify the most important multi-user boundaries with live evidence.

## Deployment Target

- Host: local candidate node 31, reached through the documented SSH path for `zuiyi-server-3`.
- Stack family: Miaowu-OS 31 test stack.
- Expected stack root: `/opt/stacks/miaowu-os-test-20260522` unless live baseline proves a newer path.
- Expected ports:
  - frontend: `14560 -> 3000`
  - gateway: `18551 -> 8551`
- Explicit exclusions:
  - 31 production `new-api-31`
  - 31 verify NewAPI app except as dependency/provider for Miaowu login or AI-provider smoke
  - 161/162/Tokyo/US production stacks
  - public routing/CDN/FRP changes

## Deployment Strategy

Use the previously proven 31 pattern:

1. Prove SSH access and capture live baseline.
2. Confirm the current compose/env/container truth in the 31 test stack directory.
3. Package the current local workspace snapshot and transfer it to 31.
4. Build updated gateway and frontend images on 31 using `docker buildx build --load`.
5. Repoint only the 31 test-stack compose/env/image references needed for this candidate build.
6. Restart only the 31 test-stack services.
7. Verify in layers: config -> process -> loopback HTTP -> authenticated behavior -> settings isolation behavior.

This keeps the mutation local to 31, avoids dependency on the local Docker Desktop state, and matches the established runbook history.

## Runtime Verification Model

Verification should focus on the highest-risk boundaries created by the refactor.

### 1. User-scoped settings

Verify that the following are persisted and read per logged-in user:

- AI provider settings
- UI draft retention
- enabled public skills
- enabled public MCP tools

Preferred evidence:

- authenticated `GET`/`PUT` API responses for user A and user B
- direct before/after diff in runtime behavior where feasible

### 2. System-scoped public catalogs

Verify that the following are not writable by ordinary users and behave as shared catalogs:

- public skill catalog
- MCP registry / tool catalog
- feature flags / admin-only config surfaces

Preferred evidence:

- 403 or hidden-path behavior on admin-only writes
- user-facing read responses showing shared catalog plus user-specific enabled state

### 3. Runtime filtering correctness

Verify that execution-time filtering respects both layers:

- system-disabled skills must not be re-enabled by user preference
- user-disabled skills/tools must disappear from the runtime set for that user only
- user B must not inherit user A's disabled state

Preferred evidence:

- API-level list responses
n- targeted runtime/log/config inspection where the behavior is otherwise opaque

## Compatibility / Rollback

### Compatibility assumptions

- Existing 31 test-stack secrets, PostgreSQL, object storage, and NewAPI login integration remain valid for this deployment.
- The stack continues to use backend port `8551` behind the 31 gateway container; no `8001` fallback is acceptable for local-dev semantics.
- The current workspace snapshot is intentionally ahead of production and is acceptable as a 31 verify candidate.

### Rollback shape

Before mutation, capture:

- current compose file backup path
- current env file backup path if touched
- current running image tags

Rollback order:

1. restore compose/env backups
2. restore previous image references
3. restart only the 31 test-stack services
4. re-run baseline health checks

## Operational Risks

- 31 build/runtime drift: historical docs are helpful but not authoritative; the live baseline must win.
- Auth/UI verification cost: full browser A/B flows may be expensive; API-first verification is acceptable when documented.
- Dirty workspace risk: only the intended Miaowu test-stack deployment path should be touched; unrelated dirty files remain untouched.
