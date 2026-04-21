from __future__ import annotations

from app.gateway.novel_migrated.api.import_export import (
    build_export_download_path,
    router as import_export_router,
)


def test_build_export_download_path_matches_export_route():
    project_id = "project-123"
    expected = f"/projects/{project_id}/export"

    assert build_export_download_path(project_id) == expected

    route_paths = {route.path for route in import_export_router.routes}
    assert "/projects/{project_id}/export" in route_paths
