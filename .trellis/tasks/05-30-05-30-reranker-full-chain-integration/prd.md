# PRD

## Goal
Implement the v1.3 reranker integration plan end-to-end for the current Miaowu-OS codebase, with a production-safe rollout shape and real verification. The delivery scope for this task is:

1. Add a reusable backend reranker service in Gateway.
2. Integrate reranking into `MemoryService.search_memories()` with overfetch before rerank.
3. Migrate the writing-skill runtime from private rerank handling to the reusable service without regressing user-configured embedding/rerank model selection.
4. Add the minimum viable user-configurable settings path for rerank-related model selection that matches the existing project architecture.
5. Add or update automated tests for the new behavior.
6. Run local verification and report any remaining deployment/runtime gaps.

## Constraints

- User-configured models must remain primary. Environment variables are fallback only.
- Do not break the existing writing-skill invoke limit or existing candidate search behavior when rerank is unavailable.
- Respect the `packages/harness/*` and `app/*` boundary; no direct new forbidden imports into harness-only layers.
- Frontend changes must be minimal and compatible with the current provider/settings architecture.
- Do not deploy in this task unless separately requested after local verification.

## Acceptance Criteria

1. `backend/app/gateway/services/reranker_service.py` exists and supports reusable rerank calls with graceful fallback.
2. `MemoryService.search_memories()` uses overfetch before reranking and degrades cleanly when rerank is unavailable.
3. Writing-skill candidate search uses the reusable reranker path and still respects user-selected models from settings/preferences.
4. Tests cover config resolution, rerank fallback behavior, and the changed ranking flow.
5. Local validation is run for the touched backend/frontend areas where feasible, and any missing verification is explicitly reported.
