# Technical Design

## Verification Layers

Backend:

- unit/contract tests for provider config and route behavior
- ownership tests for assets/workspaces
- mocked provider tests for success and failure

Frontend:

- type safety for provider config and studio workspace types
- component or hook tests where configured
- manual/browser smoke for the canvas route

Integration:

- local-dev backend `8551`
- frontend `4560`
- authenticated session
- no MiMo config diagnostic
- configured MiMo route diagnostic
- mocked or real synth path clearly labeled

## Documentation

Likely doc targets:

- a new or existing TTS configuration doc under `deer-flow-main/docs`
- README section if project convention supports it
- troubleshooting notes for NewAPI group routing

Docs must include:

- required NewAPI group/model expectations
- feature routing module ids
- capability diagnostics
- local-dev ports
- secret handling boundary
- unsupported/moved-out items from the reference project

## Deployment Check

This task only prepares a checklist:

- required env variables
- NewAPI group availability
- object storage/media asset readiness
- route registration
- health checks
- rollback considerations

Actual rollout to 31 or five-node production must use the existing rollout workflow in a separate task.
