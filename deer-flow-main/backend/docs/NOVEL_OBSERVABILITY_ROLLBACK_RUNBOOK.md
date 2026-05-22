# Novel Pipeline Rollback Runbook

## Scope

This runbook covers emergency rollback for novel pipeline capabilities guarded by gateway feature flags (for example `intent_recognition`).

## Preconditions

1. Gateway is reachable.
2. Operator has permission to call `/api/features/*`.
3. Feature flag exists in `extensions_config.json` or can be created on demand.

## Quick Rollback (target: within 15 minutes)

1. Confirm current flag state:

```bash
curl -s http://localhost:8001/api/features | jq '.features.intent_recognition'
```

2. Execute one-step rollback:

```bash
curl -s -X POST http://localhost:8001/api/features/intent_recognition/rollback
```

3. Verify rollback state:

```bash
curl -s http://localhost:8001/api/features | jq '.features.intent_recognition'
```

Expected:

- `enabled=false`
- `rollout_percentage=0`
- `allow_users=[]`

4. Verify user-level decision (optional):

```bash
curl -s "http://localhost:8001/api/features/intent_recognition/evaluate?user_id=test-user"
```

Expected:

- `enabled=false`

## Observability Checks After Rollback

1. Confirm metrics endpoint remains healthy:

```bash
curl -s http://localhost:8001/api/features/metrics/novel-pipeline | jq '.metrics'
```

2. Check logs contain trace fields for triage:

- `request_id`
- `thread_id`
- `project_id`
- `session_key`
- `idempotency_key`

## Canary Re-enable Procedure

1. Re-enable with low rollout:

```bash
curl -s -X PUT http://localhost:8001/api/features/intent_recognition \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"rollout_percentage":5,"allow_users":[],"deny_users":[]}'
```

2. Validate chosen users:

```bash
curl -s "http://localhost:8001/api/features/intent_recognition/evaluate?user_id=pilot-user-1"
```

3. Increase rollout gradually (5% -> 20% -> 50% -> 100%) while monitoring:

- failure rate
- retry rate
- duplicate-write interception rate
- p95 latency
