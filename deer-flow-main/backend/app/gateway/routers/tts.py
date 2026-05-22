from __future__ import annotations

import base64
import logging
import os
import uuid
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])

TtsProvider = Literal["openai", "volcengine"]

_MIME_EXT_MAP: dict[str, str] = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "audio/opus": "opus",
    "audio/pcm": "pcm",
    "audio/ogg": "ogg",
}

_OPENAI_DEFAULT_MODEL = "tts-1"
_OPENAI_DEFAULT_VOICE = "alloy"

_MAX_AUDIO_BYTES = 20 * 1024 * 1024

_http_client: httpx.AsyncClient | None = None


async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(120.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000, description="待合成文本")
    provider: TtsProvider = Field(default="openai", description="TTS 服务提供方")
    voice: str | None = Field(default=None, description="音色标识")
    model: str | None = Field(default=None, description="模型名称（openai 专用）")
    fmt: str | None = Field(default=None, description="输出格式: mp3/wav/flac/aac/opus")
    speed: float | None = Field(default=None, ge=0.5, le=3.0, description="语速倍率（volcengine 专用）")


class TtsVoiceInfo(BaseModel):
    id: str
    name: str
    provider: TtsProvider
    language: str = "zh"


class TtsVoicesResponse(BaseModel):
    voices: list[TtsVoiceInfo]


class TtsConfigResponse(BaseModel):
    providers: dict[str, dict[str, bool]]
    default_provider: TtsProvider | None = None


_OPENAI_VOICES: list[TtsVoiceInfo] = [
    TtsVoiceInfo(id="alloy", name="Alloy", provider="openai", language="multi"),
    TtsVoiceInfo(id="ash", name="Ash", provider="openai", language="multi"),
    TtsVoiceInfo(id="ballad", name="Ballad", provider="openai", language="multi"),
    TtsVoiceInfo(id="coral", name="Coral", provider="openai", language="multi"),
    TtsVoiceInfo(id="echo", name="Echo", provider="openai", language="multi"),
    TtsVoiceInfo(id="fable", name="Fable", provider="openai", language="multi"),
    TtsVoiceInfo(id="onyx", name="Onyx", provider="openai", language="multi"),
    TtsVoiceInfo(id="nova", name="Nova", provider="openai", language="multi"),
    TtsVoiceInfo(id="sage", name="Sage", provider="openai", language="multi"),
    TtsVoiceInfo(id="shimmer", name="Shimmer", provider="openai", language="multi"),
]

_VOLCENGINE_VOICES: list[TtsVoiceInfo] = [
    TtsVoiceInfo(id="zh_male_yangguangqingnian_moon_bigtts", name="阳光青年(男)", provider="volcengine", language="zh"),
    TtsVoiceInfo(id="zh_female_sajiaonvyou_moon_bigtts", name="撒娇女友(女)", provider="volcengine", language="zh"),
    TtsVoiceInfo(id="zh_male_chunhou_moon_bigtts", name="醇厚男声", provider="volcengine", language="zh"),
    TtsVoiceInfo(id="zh_female_wenrou_moon_bigtts", name="温柔女声", provider="volcengine", language="zh"),
]


def _get_openai_config() -> tuple[str, str | None]:
    base_url = (os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE") or "").strip().rstrip("/")
    if not base_url:
        raise HTTPException(status_code=503, detail="OPENAI_BASE_URL is not configured for TTS")
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip() or None
    return base_url, api_key


def _get_volcengine_config() -> tuple[str, str, str]:
    app_id = (os.getenv("VOLCENGINE_TTS_APPID") or "").strip()
    access_token = (os.getenv("VOLCENGINE_TTS_ACCESS_TOKEN") or "").strip()
    cluster = (os.getenv("VOLCENGINE_TTS_CLUSTER") or "volcano_tts").strip()
    if not app_id or not access_token:
        raise HTTPException(status_code=503, detail="VOLCENGINE_TTS_APPID and VOLCENGINE_TTS_ACCESS_TOKEN must be configured")
    return app_id, access_token, cluster


def _ext_from_content_type(content_type: str) -> str:
    return _MIME_EXT_MAP.get(content_type, "mp3")


async def _call_openai_tts(req: TtsRequest) -> tuple[bytes, str]:
    base_url, api_key = _get_openai_config()
    url = f"{base_url}/audio/speech"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload: dict[str, Any] = {
        "input": req.text,
        "model": req.model or _OPENAI_DEFAULT_MODEL,
        "voice": req.voice or _OPENAI_DEFAULT_VOICE,
    }
    if req.fmt:
        payload["response_format"] = req.fmt

    client = await _get_http_client()
    try:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="TTS provider (openai) request timed out")
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        body_text = ""
        try:
            body_text = exc.response.text[:500]
        except Exception:
            pass
        logger.error("OpenAI TTS error: status=%d body=%s", status, body_text)
        if status == 401:
            raise HTTPException(status_code=502, detail="TTS provider (openai) authentication failed")
        if status == 429:
            raise HTTPException(status_code=429, detail="TTS provider (openai) rate limit exceeded")
        raise HTTPException(status_code=502, detail=f"TTS provider (openai) returned {status}")
    except httpx.RequestError as exc:
        logger.error("OpenAI TTS request error: %s", exc)
        raise HTTPException(status_code=502, detail=f"TTS provider (openai) request failed: {exc}")

    audio_bytes = response.content
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        logger.warning("OpenAI TTS response oversized: %d bytes", len(audio_bytes))
        raise HTTPException(status_code=502, detail="TTS provider returned audio exceeding size limit")

    content_type = (response.headers.get("content-type") or "audio/mpeg").split(";")[0].strip()
    return audio_bytes, content_type


async def _call_volcengine_tts(req: TtsRequest) -> tuple[bytes, str]:
    app_id, access_token, cluster = _get_volcengine_config()
    url = "https://openspeech.bytedance.com/api/v1/tts"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer;{access_token}",
    }

    voice_type = req.voice or "zh_male_yangguangqingnian_moon_bigtts"
    speed_ratio = req.speed or 1.0

    payload: dict[str, Any] = {
        "app": {"appid": app_id, "token": "access_token", "cluster": cluster},
        "user": {"uid": "miaowu-tts"},
        "audio": {
            "voice_type": voice_type,
            "encoding": "mp3",
            "speed_ratio": speed_ratio,
        },
        "request": {
            "reqid": str(uuid.uuid4()),
            "text": req.text,
            "text_type": "plain",
            "operation": "query",
        },
    }

    client = await _get_http_client()
    try:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="TTS provider (volcengine) request timed out")
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        logger.error("Volcengine TTS error: status=%d", status)
        raise HTTPException(status_code=502, detail=f"TTS provider (volcengine) returned {status}")
    except httpx.RequestError as exc:
        logger.error("Volcengine TTS request error: %s", exc)
        raise HTTPException(status_code=502, detail=f"TTS provider (volcengine) request failed: {exc}")

    result = response.json()
    code = result.get("code")
    if code != 3000:
        message = result.get("message", "unknown")
        logger.error("Volcengine TTS API error: code=%s message=%s", code, message)
        raise HTTPException(status_code=502, detail=f"TTS provider (volcengine) error: code={code}, message={message}")

    audio_data = result.get("data")
    if not audio_data:
        raise HTTPException(status_code=502, detail="TTS provider (volcengine) returned empty audio data")
    try:
        audio_bytes = base64.b64decode(audio_data)
    except Exception:
        raise HTTPException(status_code=502, detail="TTS provider (volcengine) returned invalid audio data")

    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        logger.warning("Volcengine TTS response oversized: %d bytes", len(audio_bytes))
        raise HTTPException(status_code=502, detail="TTS provider returned audio exceeding size limit")

    return audio_bytes, "audio/mpeg"


@router.get("/voices", response_model=TtsVoicesResponse)
async def list_voices(provider: TtsProvider | None = None) -> TtsVoicesResponse:
    voices: list[TtsVoiceInfo] = []
    if provider is None or provider == "openai":
        voices.extend(_OPENAI_VOICES)
    if provider is None or provider == "volcengine":
        voices.extend(_VOLCENGINE_VOICES)
    return TtsVoicesResponse(voices=voices)


@router.post("/synthesize", response_class=None)
async def synthesize(req: TtsRequest):
    if req.provider == "openai":
        audio_bytes, content_type = await _call_openai_tts(req)
    elif req.provider == "volcengine":
        audio_bytes, content_type = await _call_volcengine_tts(req)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported TTS provider: {req.provider}")

    ext = _ext_from_content_type(content_type)
    return Response(
        content=audio_bytes,
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="tts_{uuid.uuid4().hex[:8]}.{ext}"',
            "Cache-Control": "no-cache",
            "X-Audio-Size": str(len(audio_bytes)),
        },
    )


@router.get("/config", response_model=TtsConfigResponse)
async def get_tts_config() -> TtsConfigResponse:
    openai_available = bool((os.getenv("OPENAI_BASE_URL") or os.getenv("OPENAI_API_BASE") or "").strip())
    volcengine_available = bool((os.getenv("VOLCENGINE_TTS_APPID") or "").strip() and (os.getenv("VOLCENGINE_TTS_ACCESS_TOKEN") or "").strip())
    return TtsConfigResponse(
        providers={
            "openai": {"available": openai_available},
            "volcengine": {"available": volcengine_available},
        },
        default_provider="openai" if openai_available else ("volcengine" if volcengine_available else None),
    )
