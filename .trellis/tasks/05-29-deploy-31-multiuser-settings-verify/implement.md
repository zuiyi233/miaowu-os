# Implementation Plan

## Execution Checklist

1. Planning close-out
- [x] Ensure `prd.md`, `design.md`, and `implement.md` reflect the actual deploy-and-verify goal.
- [x] Curate `implement.jsonl` and `check.jsonl` with relevant spec and research files.
- [x] Start the Trellis task.

2. Capture 31 live baseline
- [x] Prove access to `zuiyi-server-3` with identity commands.
- [x] Capture date, docker ps, relevant listening ports, and the live stack directory contents.
- [x] Confirm compose file, env file, current image tags, container names, and baseline health endpoints.

3. Ship current workspace snapshot to 31
- [x] Package the current local source snapshot.
- [x] Transfer the package to 31 build space.
- [x] Expand into a new timestamped build directory on 31.

4. Build candidate images on 31
- [x] Detect and stop the previously interrupted remote `docker buildx build` left running on 31.
- [x] Switch release path to local image build + tar upload because the user explicitly requested local build first.
- [x] Build gateway locally with `docker buildx build --load -f backend/Dockerfile --target dev`.
- [x] Build frontend locally with `docker buildx build --load -f frontend/Dockerfile --target prod`.
- [x] Reuse the known good build args where still valid:
  - `APT_MIRROR=mirrors.tuna.tsinghua.edu.cn`
  - `UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`
  - `UV_EXTRAS=postgres`
  - `NPM_REGISTRY=https://registry.npmmirror.com`
- [x] Export both local images into one tar and upload it to 31 for `docker load`.

5. Update 31 test stack only
- [x] Back up the current compose file before edits.
- [x] Change only the 31 Miaowu test-stack image references or equivalent runtime pointers.
- [x] Restart only the affected Miaowu test-stack services.

6. Layered verification
- [x] Config/process layer: compose refs, container image tags, container health.
- [x] Loopback HTTP layer: `/health`, `/api/v1/auth/setup-status`, frontend root.
- [x] Auth layer: at least one working login/authenticated proof path.
- [x] Settings/API layer: verify highest-risk multi-user settings endpoints and behavior.
- [~] Runtime semantics: verify user-scoped skill/tool toggles and system-disabled precedence where feasible.
  - `UI settings` A/B isolation verified on 31.
  - `AI settings` A/B isolation verified on 31.
  - `skill-settings` and `tool-settings` endpoints returned empty public catalogs because 31 test stack currently has `skills: {}` and `mcpServers: {}` in `extensions_config.docker.json`; this blocks same-item A/B toggle verification until the system public catalogs are populated.

7. Documentation and close-out
- [x] Update `N:\cloudflare\DEPLOYMENT_NOTES.md` if live truth or deployment steps changed.
- [x] Update task research/artifacts with evidence and any blocked checks.

## Preferred Validation Commands

### Local task / code validation
- `cd deer-flow-main/frontend && npm run typecheck`
- `cd deer-flow-main/backend && python -m py_compile <modified files>`
- `cd deer-flow-main/backend && pytest tests/test_skill_governance_service.py -q`

### 31 baseline / runtime validation
- `ssh -o BatchMode=yes zuiyi-server-3 "whoami && hostname && id -u && date"`
- `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`
- `ss -ltnp | grep -E '14560|18551|13282'`
- `curl -i http://127.0.0.1:18551/health`
- `curl -i http://127.0.0.1:14560/api/v1/auth/setup-status`
- `curl -i http://127.0.0.1:14560/`

### 31 multi-user settings verification
- authenticated `GET` / `PUT` against:
  - `/api/user/ai-settings`
  - `/api/user/ui-settings`
  - `/api/user/skill-settings`
  - `/api/user/tool-settings`
- if admin evidence is needed:
  - `/api/skills/*` admin-only write paths
  - `/api/mcp/config` admin-only write path

## Risky Files / Rollback Points

- Remote compose file under `/opt/stacks/miaowu-os-test-20260522`
- Remote `miaowu.env` or equivalent env file if touched
- Existing image tags currently referenced by the 31 test stack

## Review Gate Before Execution

Proceed directly because the user explicitly requested the next step and explicitly requested deployment to the 31 test container. The planning gate is therefore satisfied for this task.
