# Deploy Current Multi-User Settings Refactor To 31 Verify Stack

## Goal

Deploy the current `deer-flow-main` workspace snapshot to the 31 Miaowu-OS test stack and verify that the multi-user settings refactor behaves correctly in a real runtime, especially for user isolation and public-catalog boundaries.

## Confirmed Facts

- The target verify stack is the Miaowu-OS 31 test stack, not the 31 production `new-api-31` container and not the 161/162 public Miaowu runtime.
- Historical runtime docs point to `/opt/stacks/miaowu-os-test-20260522` as the 31 Miaowu test stack path, with gateway on `18551 -> 8551` and frontend on `14560 -> 3000`.
- The current worktree already contains the multi-user settings refactor plus follow-up fixes for skill runtime filtering, MCP runtime filtering, tool-toggle request scoping, and AI-provider store reset behavior.
- The user explicitly wants real deployment plus runtime verification on 31, not static code inspection only.
- The user explicitly approved creating a Trellis task and using sub-agents.

## Requirements

- Use the current workspace snapshot as the deployment candidate for 31 test/verify purposes.
- Do not touch 31 production `new-api-31`, 161/162 production Miaowu entry, FRP, Cloudflare, EdgeOne, or public traffic routing.
- Reuse the proven 31 Miaowu test-stack deployment path where possible instead of inventing a new rollout shape.
- Verify the live 31 stack path, compose/env/container names, and baseline health before making changes.
- Build and deploy the updated frontend/gateway images onto the 31 Miaowu test stack only.
- Validate the multi-user settings runtime boundaries with priority on:
  - AI provider settings are user-scoped
  - UI draft retention is user-scoped
  - Public skill catalog is system-scoped while skill enabled state is user-scoped
  - Public MCP catalog is system-scoped while tool enabled state is user-scoped
  - runtime skill/tool loading respects user-scoped enabled state and system-scoped disable state
- Prefer API-level verification first; use UI/browser verification only where it adds evidence that API checks cannot provide.
- Update the relevant task artifacts and ops docs if the live 31 deployment truth differs from existing documentation.

## Acceptance Criteria

- The live 31 Miaowu test stack baseline is captured before mutation: SSH target, stack path, compose/env path, container names, ports, and health status.
- The current workspace snapshot is deployed to `/opt/stacks/miaowu-os-test-20260522` or the live equivalent verified on 31.
- Gateway and frontend on 31 return healthy/basic expected responses after deployment.
- At least one real authenticated verification path proves the updated stack is running the new code.
- Multi-user settings behavior is verified on the 31 runtime with evidence for the highest-risk isolation boundaries.
- Any blocked or unverified checks are explicitly documented with the reason.
- If runtime truth changes, the relevant ops/task docs are updated in the same turn.

## Out Of Scope

- Promoting this build to 161/162/Tokyo/US production nodes.
- Changing public domains, reverse proxies, FRP, or CDN routing.
- Reworking the overall product plan for multi-user settings beyond what is already in the current workspace snapshot.
- Broad regression testing unrelated to the settings refactor, except where needed to prove the 31 test stack is still usable.

## Notes

- Deployment approval is already implied by the user's explicit request to deploy to the 31 test container and continue the next step.
- The strongest acceptable fallback, if full UI A/B verification is too expensive on 31, is authenticated API-level A/B verification plus runtime health/log evidence.
