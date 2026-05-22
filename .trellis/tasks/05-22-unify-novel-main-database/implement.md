# Implementation Plan

1. Replace novel database compatibility layer with main persistence-backed Base/session/engine.
2. Disable default fallback user for novel API request paths.
3. Exclude novel compatibility user tables from default schema imports to avoid `users` table conflict.
4. Add media asset metadata model and object storage config defaults for S3-compatible SeaweedFS.
5. Add focused backend tests for DB unification, auth strictness, project isolation, and asset model registration.
6. Run targeted backend tests and compile checks.
