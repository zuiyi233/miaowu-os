# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

Common cross-layer bugs:
- API returns format A, frontend expects format B
- Database stores X, service transforms to Y, but loses data
- Multiple layers implement the same logic differently

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw out how data moves:

```
Source → Transform → Store → Retrieve → Transform → Display
```

For each arrow, ask:
- What format is the data in?
- What could go wrong?
- Who is responsible for validation?

### Step 2: Identify Boundaries

| Boundary | Common Issues |
|----------|---------------|
| API ↔ Service | Type mismatches, missing fields |
| Service ↔ Database | Format conversions, null handling |
| Backend ↔ Frontend | Serialization, date formats |
| Component ↔ Component | Props shape changes |

### Step 3: Define Contracts

For each boundary:
- What is the exact input format?
- What is the exact output format?
- What errors can occur?

---

## Common Cross-Layer Mistakes

### Mistake 1: Implicit Format Assumptions

**Bad**: Assuming date format without checking

**Good**: Explicit format conversion at boundaries

### Mistake 2: Scattered Validation

**Bad**: Validating the same thing in multiple layers

**Good**: Validate once at the entry point

### Mistake 3: Leaky Abstractions

**Bad**: Component knows about database schema

**Good**: Each layer only knows its neighbors

### Mistake 4: Mixing profile-specific runtime defaults

**Bad**: Treating upstream generic defaults as the local-dev runtime contract.

**Good**: Keep an explicit profile contract and verify all dependent layers together.

Example for this repo family:
- Upstream docs and docker examples may still mention `8001`
- Miaowu local-dev runtime contract uses `127.0.0.1:8551`
- Novel-related tool paths must keep the local-dev contract unless the task explicitly changes it

When changing base URLs or ports, always trace all layers in one pass:
- local startup scripts
- backend default constants
- frontend runtime/env fallbacks
- gateway/internal call sites
- tests that assert runtime wiring

For DeerFlow upstream sync tasks in this repo, run a concrete profile check before closing:
- `backend/app/channels/manager.py` default URLs must keep local-dev `127.0.0.1:8551` unless the task explicitly changes local runtime contract
- `frontend/src/core/auth/gateway-config.ts` fallback URL must stay aligned with local-dev contract
- `.env.example` and `frontend/.env.example` examples for local-dev should not drift from `8551`
- `docker/nginx/nginx.conf` may keep `gateway:8001` because it is container-internal routing, not Windows local-dev direct access

### Mistake 5: Treating UI selection as the only guard

**Bad**: A frontend shows a discovered list and assumes the user selected items, while the API only accepts explicit ids. If the checkbox is hard to see, state is reset, or the user clicks the primary action with an empty selection, the backend receives an empty request even though the discovery step succeeded.

**Good**: Define the empty-selection contract at both layers for any discover-then-apply flow.

For NewAPI group sync and similar flows:
- Discovery result (`GET`) must be transformable into a valid apply payload (`POST`) without hidden UI state.
- Frontend payload builders must have tests for: selected ids, manual ids, and empty selection with discovered items.
- Backend apply APIs must either reject empty input before side effects or intentionally fall back to the server-side discovered catalog. Do not leave the behavior dependent only on a checkbox.
- Error copy should say whether the problem is "no discovered items" or "nothing selected"; these are different operational states.
- Tests must cover the failure chain that reached production, not only the happy path.

For NewAPI specifically, keep four facts separate:
- discovered group ids
- product/access entitlement
- Hub token provisioning result
- `/v1/models` response and parsed model count

A visible group is not proof of a usable model catalog. A token with no product access or failed provisioning must surface as an error, not as a successful provider with zero models.

---

## Checklist for Cross-Layer Features

Before implementation:
- [ ] Mapped the complete data flow
- [ ] Identified all layer boundaries
- [ ] Defined format at each boundary
- [ ] Decided where validation happens

After implementation:
- [ ] Tested with edge cases (null, empty, invalid)
- [ ] Verified error handling at each boundary
- [ ] Checked data survives round-trip
- [ ] If config values changed, searched both old and new values repo-wide and reconciled profile-specific defaults
- [ ] For discover-then-apply flows, tested empty selection against non-empty discovery data in both frontend payload construction and backend apply handling

---

## When to Create Flow Documentation

Create detailed flow docs when:
- Feature spans 3+ layers
- Multiple teams are involved
- Data format is complex
- Feature has caused bugs before
