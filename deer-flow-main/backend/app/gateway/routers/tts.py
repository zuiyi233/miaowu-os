from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.routers.tts_support.service import (
    TtsCapabilityProbeRequest,
    TtsCapabilityProbeResponse,
    TtsChapterAudioResponse,
    TtsChapterGenerateEnvelope,
    TtsChapterGenerateRequest,
    TtsChapterJobResponse,
    TtsConfigResponse,
    TtsGeneratedAudioResponse,
    TtsJobActionResponse,
    TtsNarrationPlanRequest,
    TtsNarrationPlanResponse,
    TtsProvider,
    TtsProviderError,
    TtsRequest,
    TtsSmokeRequest,
    TtsSmokeResponse,
    TtsStyleOptimizeRequest,
    TtsTextOptimizeResponse,
    TtsVoiceCloneRequest,
    TtsVoiceDesignOptimizeRequest,
    TtsVoiceDesignRequest,
    TtsVoicesResponse,
    build_config_response,
    cancel_tts_job,
    clone_tts_voice,
    design_tts_voice,
    download_chapter_tts_audio,
    ext_from_content_type,
    generate_chapter_tts,
    get_chapter_audio_manifest,
    get_moss_readiness,
    get_narration_plan,
    get_tts_job,
    list_voices_for_provider,
    optimize_tts_style,
    optimize_tts_voice_design,
    probe_openai_speech_capability,
    read_tts_audio_asset,
    retry_tts_job,
    save_narration_plan,
    smoke_tts,
    synthesize_tts,
)
from app.gateway.routers.tts_support.studio import (
    TtsStudioExportRequest,
    TtsStudioRunNodeRequest,
    TtsStudioWorkspaceCreate,
    TtsStudioWorkspaceListResponse,
    TtsStudioWorkspaceResponse,
    TtsStudioWorkspaceUpdate,
    build_export_zip,
    create_workspace,
    delete_workspace,
    get_workspace,
    list_workspaces,
    run_workspace_node,
    update_workspace,
)

router = APIRouter(prefix="/api/tts", tags=["tts"])


async def get_optional_db() -> AsyncGenerator[AsyncSession | None, None]:
    try:
        async for session in get_db():
            yield session
            return
    except HTTPException as exc:
        if exc.status_code != 503:
            raise
        yield None


@router.get("/voices", response_model=TtsVoicesResponse)
async def list_voices(provider: TtsProvider | None = None, model: str | None = None) -> TtsVoicesResponse:
    return TtsVoicesResponse(voices=list_voices_for_provider(provider=provider, model=model))


def _raise_tts_error(exc: TtsProviderError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc


@router.post("/synthesize", response_class=None)
async def synthesize(
    req: TtsRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
):
    try:
        result = await synthesize_tts(req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)

    ext = ext_from_content_type(result.content_type)
    return Response(
        content=result.audio_bytes,
        media_type=result.content_type,
        headers={
            "Content-Disposition": f'inline; filename="tts_{uuid.uuid4().hex[:8]}.{ext}"',
            "Cache-Control": "no-cache",
            "X-Audio-Size": str(len(result.audio_bytes)),
            "X-TTS-Provider": result.provider,
        },
    )


@router.get("/config", response_model=TtsConfigResponse)
async def get_tts_config(
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> TtsConfigResponse:
    return await build_config_response(user_id=user_id, db=db)


@router.get("/studio/workspaces", response_model=TtsStudioWorkspaceListResponse)
async def list_studio_workspaces(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> TtsStudioWorkspaceListResponse:
    return await list_workspaces(user_id=user_id, db=db)


@router.post("/studio/workspaces", response_model=TtsStudioWorkspaceResponse)
async def create_studio_workspace(
    req: TtsStudioWorkspaceCreate,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> TtsStudioWorkspaceResponse:
    return await create_workspace(req=req, user_id=user_id, db=db)


@router.get("/studio/workspaces/{workspace_id}", response_model=TtsStudioWorkspaceResponse)
async def get_studio_workspace(
    workspace_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> TtsStudioWorkspaceResponse:
    return await get_workspace(workspace_id=workspace_id, user_id=user_id, db=db)


@router.put("/studio/workspaces/{workspace_id}", response_model=TtsStudioWorkspaceResponse)
async def update_studio_workspace(
    workspace_id: str,
    req: TtsStudioWorkspaceUpdate,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> TtsStudioWorkspaceResponse:
    return await update_workspace(workspace_id=workspace_id, req=req, user_id=user_id, db=db)


@router.delete("/studio/workspaces/{workspace_id}")
async def delete_studio_workspace(
    workspace_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str | bool]:
    return await delete_workspace(workspace_id=workspace_id, user_id=user_id, db=db)


@router.post("/studio/workspaces/{workspace_id}/run-node")
async def run_studio_workspace_node(
    workspace_id: str,
    req: TtsStudioRunNodeRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    return await run_workspace_node(workspace_id=workspace_id, req=req, user_id=user_id, db=db)


@router.post("/studio/workspaces/{workspace_id}/export")
async def export_studio_workspace(
    workspace_id: str,
    req: TtsStudioExportRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    content, media_type, filename = await build_export_zip(workspace_id=workspace_id, req=req, user_id=user_id, db=db)
    return Response(content=content, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/moss/health")
async def get_moss_health() -> dict:
    return await get_moss_readiness()


@router.post("/smoke", response_model=TtsSmokeResponse)
async def smoke(
    req: TtsSmokeRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> TtsSmokeResponse:
    return await smoke_tts(req, user_id=user_id, db=db)


@router.post("/probe", response_model=TtsCapabilityProbeResponse)
async def probe(
    req: TtsCapabilityProbeRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> TtsCapabilityProbeResponse:
    return await probe_openai_speech_capability(req, user_id=user_id, db=db)


@router.post("/voices/design", response_model=TtsGeneratedAudioResponse)
async def design_voice(
    req: TtsVoiceDesignRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> TtsGeneratedAudioResponse:
    try:
        return await design_tts_voice(req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.post("/voices/clone", response_model=TtsGeneratedAudioResponse)
async def clone_voice(
    req: TtsVoiceCloneRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> TtsGeneratedAudioResponse:
    try:
        return await clone_tts_voice(req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.post("/style/optimize", response_model=TtsTextOptimizeResponse)
async def optimize_style(
    req: TtsStyleOptimizeRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> TtsTextOptimizeResponse:
    try:
        return await optimize_tts_style(req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.post("/voice-design/optimize", response_model=TtsTextOptimizeResponse)
async def optimize_voice_design(
    req: TtsVoiceDesignOptimizeRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> TtsTextOptimizeResponse:
    try:
        return await optimize_tts_voice_design(req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.get("/assets/{asset_id}")
@router.get("/assets/{asset_id}/download")
async def get_asset(
    asset_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
):
    try:
        content, media_type, filename = await read_tts_audio_asset(asset_id=asset_id, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/chapters/{chapter_id}/generate", response_model=TtsChapterGenerateEnvelope)
async def generate_chapter_audio(
    chapter_id: str,
    req: TtsChapterGenerateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> TtsChapterGenerateEnvelope:
    try:
        return await generate_chapter_tts(chapter_id=chapter_id, req=req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.get("/chapters/{chapter_id}/audio", response_model=TtsChapterAudioResponse)
async def get_chapter_audio(
    chapter_id: str,
    user_id: str = Depends(get_user_id),
) -> TtsChapterAudioResponse:
    return await get_chapter_audio_manifest(chapter_id=chapter_id, user_id=user_id)


@router.get("/chapters/{chapter_id}/plan", response_model=TtsNarrationPlanResponse)
async def get_chapter_narration_plan(
    chapter_id: str,
    plan_id: str | None = None,
    user_id: str = Depends(get_user_id),
) -> TtsNarrationPlanResponse:
    return await get_narration_plan(chapter_id=chapter_id, user_id=user_id, plan_id=plan_id)


@router.post("/chapters/{chapter_id}/plan", response_model=TtsNarrationPlanResponse)
@router.put("/chapters/{chapter_id}/plan", response_model=TtsNarrationPlanResponse)
async def save_chapter_narration_plan(
    chapter_id: str,
    req: TtsNarrationPlanRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> TtsNarrationPlanResponse:
    try:
        return await save_narration_plan(chapter_id=chapter_id, req=req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.get("/chapters/{chapter_id}/download")
async def download_chapter_audio(
    chapter_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    try:
        content, media_type, filename = await download_chapter_tts_audio(chapter_id=chapter_id, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/jobs/{job_id}", response_model=TtsChapterJobResponse)
async def get_job(job_id: str, user_id: str = Depends(get_user_id)) -> TtsChapterJobResponse:
    try:
        return get_tts_job(job_id, user_id=user_id)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.post("/jobs/{job_id}/cancel", response_model=TtsJobActionResponse)
async def cancel_job(job_id: str, user_id: str = Depends(get_user_id)) -> TtsJobActionResponse:
    try:
        return cancel_tts_job(job_id, user_id=user_id)
    except TtsProviderError as exc:
        _raise_tts_error(exc)


@router.post("/jobs/{job_id}/retry", response_model=TtsJobActionResponse)
async def retry_job(
    job_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> TtsJobActionResponse:
    try:
        return await retry_tts_job(job_id, user_id=user_id, db=db)
    except TtsProviderError as exc:
        _raise_tts_error(exc)
