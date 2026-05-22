# Phase-3 Test Flow Code (Not Executed in Planning Stage)

## Purpose

These scripts are delivered as executable test workflow code for phase-3.
This planning task does **not** execute them.

## Scripts

1. `run_backend_phase3.sh` - backend lint/type/test staged commands
2. `run_frontend_phase3.ps1` - frontend Win-only lint/type/test commands
3. `run_contract_e2e_phase3.sh` - API contract and dialogue E2E scenario commands
4. `ci_phase3_template.yml` - CI pipeline template for later integration

## Execution Policy

1. Execute only during implementation/check phases.
2. Frontend commands must run in Windows PowerShell.
3. Do not install or upgrade frontend dependencies in WSL.

## Suggested Staged Order

1. Backend static checks
2. Backend targeted tests
3. Frontend lint/type/unit (Windows)
4. Contract tests
5. Dialogue E2E tests

## Exit Criteria

1. All scripts exit code 0
2. Key phase-3 scenarios pass:
   - create novel dialogue flow
   - multi-turn slot filling
   - action routing and skill selection
   - lifecycle transitions and recovery
   - finalize gate pass/block branches
