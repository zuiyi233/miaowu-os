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
    TtsJobActionResponse,
    TtsNarrationPlanRequest,
    TtsNarrationPlanResponse,
    TtsProvider,
    TtsProviderError,
    TtsRequest,
    TtsSmokeRequest,
    TtsSmokeResponse,
    TtsVoicesResponse,
    build_config_response,
    cancel_tts_job,
    download_chapter_tts_audio,
    ext_from_content_type,
    generate_chapter_tts,
    get_chapter_audio_manifest,
    get_moss_readiness,
    get_narration_plan,
    get_tts_job,
    list_voices_for_provider,
    probe_openai_speech_capability,
    retry_tts_job,
    save_narration_plan,
    smoke_tts,
    synthesize_tts,
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
