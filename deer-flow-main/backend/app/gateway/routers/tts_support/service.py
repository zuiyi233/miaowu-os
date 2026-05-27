from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
import wave
from dataclasses import dataclass, field
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.ai_service import create_user_ai_service_from_db
from app.gateway.novel_migrated.services.ai_settings_service import (
    get_ai_settings_service,
    resolve_user_ai_runtime_config,
)
from app.gateway.novel_migrated.services.media_asset_service import media_asset_service
from app.gateway.novel_migrated.services.object_storage_service import (
    ObjectStorageError,
    object_storage_service,
)

logger = logging.getLogger(__name__)

TtsProvider = Literal["openai", "volcengine", "moss-local", "mimo"]

MIME_EXT_MAP: dict[str, str] = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "audio/opus": "opus",
    "audio/pcm": "pcm",
    "audio/ogg": "ogg",
}

OPENAI_DEFAULT_MODEL = "gpt-4o-mini-tts"
OPENAI_DEFAULT_VOICE = "alloy"
MIMO_DEFAULT_MODEL = "mimo-audio"
MIMO_DEFAULT_VOICE = "mimo-voice"
MIMO_ROUTE_MODULE_IDS = ("tts", "tts-studio", "mimo-tts")
MOSS_DEFAULT_BASE_URL = "http://localhost:18083"
MOSS_DEFAULT_VOICE = "demo-1"
MAX_AUDIO_BYTES = 20 * 1024 * 1024
FFMPEG_TIMEOUT_SECONDS = 120
FFMPEG_BINARY_ENV_VARS = ("MIAOWU_FFMPEG_BIN", "MIAOWU_FFMPEG_PATH", "FFMPEG_BIN", "FFMPEG_PATH")
FFMPEG_LOCAL_DEV_PATTERNS = (
    "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/*/bin/ffmpeg.exe",
    "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*-full_build/bin/ffmpeg.exe",
)

_ERROR_STATUS_MAP: dict[str, int] = {
    "missing_config": 503,
    "invalid_request": 422,
    "unsupported_feature": 400,
    "unsupported_provider": 400,
    "unsupported_model": 400,
    "unsupported_endpoint": 502,
    "auth_failed": 502,
    "rate_limited": 429,
    "provider_timeout": 504,
    "provider_failed": 502,
    "storage_unavailable": 503,
    "quota_exceeded": 429,
    "generation_cancelled": 409,
    "planner_missing_config": 503,
    "planner_failed": 502,
    "planner_invalid_json": 502,
    "invalid_plan": 422,
    "unsupported_multivoice": 400,
    "asset_not_found": 404,
}

_http_client: httpx.AsyncClient | None = None
_http_client_lock = asyncio.Lock()


class TtsProviderError(Exception):
    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        provider: str | None = None,
        status_code: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.message = message
        self.provider = provider
        self.status_code = status_code or _ERROR_STATUS_MAP.get(error_code, 502)
        self.details = details or {}

    def as_detail(self) -> dict[str, Any]:
        detail: dict[str, Any] = {
            "error_code": self.error_code,
            "message": self.message,
        }
        if self.provider:
            detail["provider"] = self.provider
        if self.details:
            detail["details"] = self.details
        return detail


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000, description="Text to synthesize")
    provider: TtsProvider = Field(default="openai", description="TTS provider")
    voice: str | None = Field(default=None, description="Provider voice id")
    model: str | None = Field(default=None, description="Provider model id")
    fmt: str | None = Field(default=None, description="Output format: mp3/wav/flac/aac/opus")
    speed: float | None = Field(default=None, ge=0.25, le=4.0, description="Speech speed ratio")
    instructions: str | None = Field(default=None, max_length=1200, description="Narration style instructions")

    # MOSS-local generation controls. They are optional and ignored by other providers.
    seed: int | None = Field(default=None, description="MOSS generation seed")
    text_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    audio_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=1, le=200)
    repetition_penalty: float | None = Field(default=None, ge=0.1, le=5.0)
    normalize_text: bool | None = Field(default=None)
    advanced_options: dict[str, Any] | None = Field(default=None, description="Provider-specific advanced controls")
    ai_provider_id: str | None = Field(default=None, description="User AI provider id for OpenAI-compatible TTS")


class MiMoAdvancedOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str | None = Field(default=None, max_length=2000)
    reference_audio_asset_id: str | None = Field(default=None, max_length=128)
    reference_audio_data_url: str | None = Field(default=None, max_length=8_000_000)


class TtsRoleVoiceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    voice: str | None = Field(default=None, max_length=120)
    provider: TtsProvider | None = None
    model: str | None = Field(default=None, max_length=120)
    mode: Literal["design", "clone"] | None = None
    character_id: str | None = Field(default=None, max_length=120)
    role_id: str | None = Field(default=None, max_length=120)
    display_name: str | None = Field(default=None, max_length=120)
    aliases: list[str] = Field(default_factory=list)
    gender: str | None = Field(default=None, max_length=80)
    age: str | None = Field(default=None, max_length=80)
    personality: str | None = Field(default=None, max_length=1200)
    voice_description: str | None = Field(default=None, max_length=2000)
    reference_audio_asset_id: str | None = Field(default=None, max_length=128)
    generated_sample_asset_id: str | None = Field(default=None, max_length=128)
    status: Literal["pending", "generating", "ready", "error"] | None = None
    locked: bool | None = None
    diagnostics: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


SpeakerVoiceMappingValue = str | TtsRoleVoiceReference


class MossAdvancedOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    demo_id: str | None = None
    seed: int | None = None
    text_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    audio_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=1, le=200)
    repetition_penalty: float | None = Field(default=None, ge=0.1, le=5.0)
    normalize_text: bool | None = None


class TtsChapterGenerateRequest(BaseModel):
    text: str | None = Field(default=None, min_length=1)
    project_id: str | None = None
    title: str | None = None
    provider: TtsProvider = Field(default="moss-local")
    mode: Literal["single_narrator", "ai_multivoice"] = "single_narrator"
    plan_id: str | None = None
    voice: str | None = None
    model: str | None = None
    fmt: str | None = None
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    instructions: str | None = Field(default=None, max_length=1200)
    ai_provider_id: str | None = None
    force: bool = False
    max_chunk_chars: int = Field(default=1200, ge=80, le=5000)
    advanced_options: dict[str, Any] | None = None
    speaker_voices: dict[str, SpeakerVoiceMappingValue] | None = None

    @model_validator(mode="after")
    def validate_mode_contract(self) -> TtsChapterGenerateRequest:
        if self.mode == "ai_multivoice" and not self.plan_id:
            raise ValueError("plan_id is required when mode is ai_multivoice")
        return self


class TtsNarrationSpeaker(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    display_name: str = Field(min_length=1, max_length=120)
    voice: str = Field(min_length=1, max_length=120)
    role_voice: TtsRoleVoiceReference | None = None
    style: str | None = Field(default=None, max_length=1200)
    instructions: str | None = Field(default=None, max_length=1200)


class TtsNarrationSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str | None = Field(default=None, max_length=80)
    speaker_id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=5000)
    voice: str | None = Field(default=None, max_length=120)
    role_voice: TtsRoleVoiceReference | None = None
    style: str | None = Field(default=None, max_length=1200)
    instructions: str | None = Field(default=None, max_length=1200)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)


class TtsNarrationPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plan_id: str | None = Field(default=None, max_length=120)
    chapter_id: str | None = Field(default=None, max_length=120)
    provider: TtsProvider | None = None
    model: str | None = Field(default=None, max_length=120)
    default_voice: str | None = Field(default=None, max_length=120)
    speakers: list[TtsNarrationSpeaker] = Field(min_length=1)
    segments: list[TtsNarrationSegment] = Field(min_length=1)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_speaker_references(self) -> TtsNarrationPlan:
        speaker_ids = [speaker.id for speaker in self.speakers]
        duplicate_ids = sorted({speaker_id for speaker_id in speaker_ids if speaker_ids.count(speaker_id) > 1})
        if duplicate_ids:
            raise ValueError(f"Duplicate speaker ids: {', '.join(duplicate_ids)}")
        known = set(speaker_ids)
        missing = sorted({segment.speaker_id for segment in self.segments if segment.speaker_id not in known})
        if missing:
            raise ValueError(f"Segments reference unknown speaker ids: {', '.join(missing)}")
        return self


class TtsNarrationPlanRequest(BaseModel):
    plan: TtsNarrationPlan | dict[str, Any] | None = None
    auto_plan: bool = False
    text: str | None = Field(default=None, min_length=1)
    provider: TtsProvider = Field(default="moss-local")
    model: str | None = None
    voice: str | None = None
    ai_provider_id: str | None = None
    speaker_voices: dict[str, SpeakerVoiceMappingValue] | None = None


class TtsNarrationPlanResponse(BaseModel):
    chapter_id: str
    plan: TtsNarrationPlan | None = None
    status: str = "missing"


class TtsCapabilityProbeRequest(BaseModel):
    provider: TtsProvider = Field(default="openai")
    model: str | None = None
    voice: str | None = None
    ai_provider_id: str | None = None


class TtsCapabilityProbeResponse(BaseModel):
    ok: bool
    provider: TtsProvider
    endpoint: str | None = None
    model: str | None = None
    error_code: str | None = None
    detail: str | None = None
    status: int | None = None
    content_type: str | None = None


class TtsChapterJobResponse(BaseModel):
    job_id: str
    chapter_id: str
    status: str
    project_id: str | None = None
    total_chunks: int
    completed_chunks: int
    failed_chunks: int
    cached_chunks: int = 0
    progress: dict[str, Any] = Field(default_factory=dict)
    audio: dict[str, Any] | None = None
    cache_state: str = "unknown"
    manifest: dict[str, Any] | None = None
    error_code: str | None = None
    detail: str | None = None


class TtsChapterAudioResponse(BaseModel):
    chapter_id: str
    status: str
    audio: dict[str, Any] | None = None
    manifest: dict[str, Any] | None = None


class TtsJobActionResponse(BaseModel):
    ok: bool
    job: TtsChapterJobResponse


class TtsChapterGenerateEnvelope(BaseModel):
    job: TtsChapterJobResponse
    job_id: str
    audio: dict[str, Any] | None = None
    cache_state: str = "unknown"
    cached: bool = False


class TtsVoiceInfo(BaseModel):
    id: str
    name: str
    provider: TtsProvider
    language: str = "zh"
    models: list[str] | None = None
    supports_instructions: bool = False


class TtsVoicesResponse(BaseModel):
    voices: list[TtsVoiceInfo]


class TtsGeneratedAudioResponse(BaseModel):
    asset_id: str
    url: str
    download_url: str
    content_type: str
    provider: TtsProvider
    model: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    diagnostics: list[str] = Field(default_factory=list)


class TtsVoiceDesignRequest(BaseModel):
    voice_description: str = Field(min_length=1, max_length=2000)
    text: str = Field(default="你好，这是喵呜声音设计试听。", min_length=1, max_length=5000)
    instruction: str | None = Field(default=None, max_length=2000)
    model: str | None = Field(default=None, max_length=120)
    fmt: str | None = Field(default="mp3", max_length=20)
    ai_provider_id: str | None = Field(default=None, max_length=128)


class TtsVoiceCloneRequest(BaseModel):
    text: str = Field(default="你好，这是喵呜声音克隆试听。", min_length=1, max_length=5000)
    reference_audio_asset_id: str | None = Field(default=None, max_length=128)
    reference_audio_data_url: str | None = Field(default=None, max_length=8_000_000)
    instruction: str | None = Field(default=None, max_length=2000)
    style: str | None = Field(default=None, max_length=2000)
    model: str | None = Field(default=None, max_length=120)
    fmt: str | None = Field(default="mp3", max_length=20)
    ai_provider_id: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def validate_reference_audio(self) -> TtsVoiceCloneRequest:
        if bool(self.reference_audio_asset_id) == bool(self.reference_audio_data_url):
            raise ValueError("Exactly one of reference_audio_asset_id or reference_audio_data_url is required")
        return self


class TtsStyleOptimizeRequest(BaseModel):
    style_text: str = Field(min_length=1, max_length=4000)
    model: str | None = Field(default=None, max_length=120)
    ai_provider_id: str | None = Field(default=None, max_length=128)


class TtsVoiceDesignOptimizeRequest(BaseModel):
    voice_description: str = Field(min_length=1, max_length=4000)
    model: str | None = Field(default=None, max_length=120)
    ai_provider_id: str | None = Field(default=None, max_length=128)


class TtsTextOptimizeResponse(BaseModel):
    text: str
    provider: TtsProvider
    model: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TtsConfigResponse(BaseModel):
    providers: dict[str, dict[str, Any]]
    default_provider: TtsProvider | None = None
    defaults: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, dict[str, Any]] = Field(default_factory=dict)


class TtsSmokeRequest(BaseModel):
    text: str = Field(default="你好，这是喵呜小说朗读测试。", min_length=1, max_length=300)
    provider: TtsProvider = Field(default="moss-local")
    voice: str | None = None
    model: str | None = None
    fmt: str | None = None
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    instructions: str | None = Field(default=None, max_length=1200)


class TtsSmokeResponse(BaseModel):
    ok: bool
    provider: TtsProvider
    content_type: str | None = None
    audio_size: int | None = None
    model: str | None = None
    voice: str | None = None
    error_code: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class TtsAudioResult:
    audio_bytes: bytes
    content_type: str
    provider: str
    model: str | None = None
    voice: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OpenAIConfig:
    base_url: str
    api_key: str | None
    source: str = "env"
    provider_id: str | None = None


@dataclass(frozen=True)
class MiMoConfig:
    base_url: str
    api_key: str | None
    source: str = "env"
    provider_id: str | None = None
    model: str | None = None
    provider: str | None = None


@dataclass(frozen=True)
class VolcengineConfig:
    app_id: str
    access_token: str
    cluster: str


@dataclass(frozen=True)
class MossConfig:
    base_url: str


@dataclass
class ChapterJobState:
    job_id: str
    chapter_id: str
    user_id: str
    status: str
    request: TtsChapterGenerateRequest
    project_id: str | None = None
    total_chunks: int = 0
    completed_chunks: int = 0
    failed_chunks: int = 0
    cached_chunks: int = 0
    manifest: dict[str, Any] | None = None
    error_code: str | None = None
    detail: str | None = None
    cancel_requested: bool = False


_chapter_jobs: dict[str, ChapterJobState] = {}
_chapter_manifests: dict[tuple[str, str], dict[str, Any]] = {}
_narration_plans: dict[tuple[str, str, str], TtsNarrationPlan] = {}
_audio_cache: dict[str, TtsAudioResult] = {}
_local_audio_assets: dict[str, dict[str, Any]] = {}
_MAX_CACHED_JOBS = 200
_MAX_CACHED_MANIFESTS = 500
_job_lock = asyncio.Lock()


OPENAI_VOICES: list[TtsVoiceInfo] = [
    TtsVoiceInfo(id="alloy", name="Alloy", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="ash", name="Ash", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="ballad", name="Ballad", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="coral", name="Coral", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="echo", name="Echo", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="fable", name="Fable", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="onyx", name="Onyx", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="nova", name="Nova", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="sage", name="Sage", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="shimmer", name="Shimmer", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="verse", name="Verse", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="marin", name="Marin", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
    TtsVoiceInfo(id="cedar", name="Cedar", provider="openai", language="multi", models=[OPENAI_DEFAULT_MODEL], supports_instructions=True),
]

VOLCENGINE_VOICES: list[TtsVoiceInfo] = [
    TtsVoiceInfo(id="zh_male_yangguangqingnian_moon_bigtts", name="阳光青年(男)", provider="volcengine", language="zh"),
    TtsVoiceInfo(id="zh_female_sajiaonvyou_moon_bigtts", name="撒娇女友(女)", provider="volcengine", language="zh"),
    TtsVoiceInfo(id="zh_male_chunhou_moon_bigtts", name="醇厚男声", provider="volcengine", language="zh"),
    TtsVoiceInfo(id="zh_female_wenrou_moon_bigtts", name="温柔女声", provider="volcengine", language="zh"),
]

MOSS_VOICES: list[TtsVoiceInfo] = [
    TtsVoiceInfo(id="demo-1", name="MOSS Demo 1", provider="moss-local", language="zh"),
]

MIMO_VOICES: list[TtsVoiceInfo] = [
    TtsVoiceInfo(id=MIMO_DEFAULT_VOICE, name="MiMo Generated Voice", provider="mimo", language="multi", models=[MIMO_DEFAULT_MODEL], supports_instructions=True),
]


async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        return _http_client
    async with _http_client_lock:
        if _http_client is None or _http_client.is_closed:
            _http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(120.0),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            )
        return _http_client


def ext_from_content_type(content_type: str) -> str:
    return MIME_EXT_MAP.get(content_type, "mp3")


def _normalize_audio_media_type(media_type: str) -> str:
    normalized = (media_type or "application/octet-stream").split(";")[0].strip().lower()
    if normalized == "audio/mp3":
        return "audio/mpeg"
    if normalized in {"audio/x-wav", "audio/wave"}:
        return "audio/wav"
    return normalized or "application/octet-stream"


def _resolve_ffmpeg_bin() -> str | None:
    for env_var in FFMPEG_BINARY_ENV_VARS:
        raw = (os.getenv(env_var) or "").strip().strip('"')
        if raw:
            candidate = Path(raw).expanduser()
            if candidate.is_file():
                return str(candidate)
            logger.warning("Configured %s does not point to an ffmpeg binary: %s", env_var, raw)
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    home = Path.home()
    for pattern in FFMPEG_LOCAL_DEV_PATTERNS:
        for candidate in sorted(home.glob(pattern), reverse=True):
            if candidate.is_file():
                return str(candidate)
    return None


def _local_tts_asset_root() -> Path:
    raw = (os.getenv("MIAOWU_TTS_ASSET_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parents[5] / ".deer-flow" / "tts-assets").resolve()


def _validate_path_component(value: str, name: str = "id") -> str:
    if not re.fullmatch(r"[0-9a-zA-Z_-]{1,128}", value):
        raise ValueError(f"Invalid {name}: path traversal or invalid characters detected")
    return value


def _local_manifest_path(user_id: str, chapter_id: str) -> Path:
    _validate_path_component(user_id, "user_id")
    _validate_path_component(chapter_id, "chapter_id")
    return _local_tts_asset_root() / user_id / chapter_id / "manifest.json"


def _local_plan_path(user_id: str, chapter_id: str, plan_id: str) -> Path:
    _validate_path_component(user_id, "user_id")
    _validate_path_component(chapter_id, "chapter_id")
    _validate_path_component(plan_id, "plan_id")
    return _local_tts_asset_root() / user_id / chapter_id / "plans" / f"{plan_id}.json"


def _local_generated_asset_path(user_id: str, asset_id: str, ext: str) -> Path:
    _validate_path_component(user_id, "user_id")
    _validate_path_component(asset_id, "asset_id")
    return _local_tts_asset_root() / user_id / "generated" / f"{asset_id}.{ext}"


def _safe_read_json(path: Path) -> dict[str, Any] | None:
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
    except Exception:
        logger.warning("Failed to read TTS local manifest: %s", path, exc_info=True)
    return None


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2), encoding="utf-8")
    tmp.replace(path)


def _register_local_asset(asset: dict[str, Any]) -> None:
    asset_id = str(asset.get("asset_id") or "")
    if not asset_id:
        return
    _local_audio_assets[asset_id] = {
        "path": asset.get("path"),
        "user_id": asset.get("user_id"),
        "project_id": asset.get("project_id"),
        "chapter_id": asset.get("chapter_id"),
        "filename": asset.get("filename"),
        "content_type": asset.get("content_type"),
        "size_bytes": asset.get("size_bytes"),
        "fingerprint": asset.get("fingerprint"),
        "metadata": asset.get("metadata") or {},
    }


def _load_local_manifest(*, user_id: str, chapter_id: str) -> dict[str, Any] | None:
    payload = _safe_read_json(_local_manifest_path(user_id, chapter_id))
    if not payload:
        return None
    if payload.get("user_id") != user_id or payload.get("chapter_id") != chapter_id:
        return None
    for asset in payload.get("local_assets") or []:
        if isinstance(asset, dict) and Path(str(asset.get("path") or "")).is_file():
            _register_local_asset(asset)
    manifest = payload.get("manifest")
    if isinstance(manifest, dict):
        _chapter_manifests[(user_id, chapter_id)] = manifest
        return manifest
    return None


def _persist_local_manifest(*, user_id: str, chapter_id: str, manifest: dict[str, Any]) -> None:
    local_assets: list[dict[str, Any]] = []
    for chunk in manifest.get("chunks") or []:
        if not isinstance(chunk, dict) or chunk.get("storage") != "local_file":
            continue
        asset_id = str(chunk.get("asset_id") or "")
        asset = _local_audio_assets.get(asset_id)
        if asset:
            local_assets.append({"asset_id": asset_id, **asset})
    payload = {
        "schema": "miaowu.tts.local_manifest.v1",
        "user_id": user_id,
        "chapter_id": chapter_id,
        "updated_at": datetime.now(UTC).isoformat(),
        "manifest": manifest,
        "local_assets": local_assets,
    }
    _write_json_atomic(_local_manifest_path(user_id, chapter_id), payload)


def _persist_narration_plan(*, user_id: str, chapter_id: str, plan: TtsNarrationPlan) -> TtsNarrationPlan:
    plan_id = plan.plan_id or str(uuid.uuid4())
    normalized = plan.model_copy(update={"plan_id": plan_id, "chapter_id": chapter_id})
    payload = {
        "schema": "miaowu.tts.narration_plan.v1",
        "user_id": user_id,
        "chapter_id": chapter_id,
        "plan": normalized.model_dump(mode="json"),
        "updated_at": datetime.now(UTC).isoformat(),
    }
    _write_json_atomic(_local_plan_path(user_id, chapter_id, plan_id), payload)
    _narration_plans[(user_id, chapter_id, plan_id)] = normalized
    return normalized


async def _persist_generated_tts_audio(
    *,
    user_id: str,
    result: TtsAudioResult,
    kind: str,
    metadata: dict[str, Any] | None = None,
    db: AsyncSession | None = None,
) -> TtsGeneratedAudioResponse:
    asset_id = str(uuid.uuid4())
    ext = ext_from_content_type(result.content_type)
    merged_metadata = {
        "kind": kind,
        "provider": result.provider,
        "model": result.model,
        "voice": result.voice,
        "created_at": datetime.now(UTC).isoformat(),
        **result.metadata,
        **(metadata or {}),
    }
    filename = f"{kind}_{asset_id}.{ext}"
    if db is not None:
        try:
            created = await media_asset_service.create_asset_from_bytes(
                db=db,
                user_id=user_id,
                project_id=None,
                purpose="tts_audio",
                filename=filename,
                content=result.audio_bytes,
                mime_type=result.content_type,
                metadata=merged_metadata,
                commit=True,
                refresh=True,
                flush=False,
            )
            return TtsGeneratedAudioResponse(
                asset_id=created.asset.id,
                url=f"/api/tts/assets/{created.asset.id}",
                download_url=f"/api/tts/assets/{created.asset.id}/download",
                content_type=result.content_type,
                provider="mimo",
                model=result.model,
                metadata={**merged_metadata, "storage": "media_asset"},
            )
        except ObjectStorageError:
            logger.warning("Failed to persist generated TTS audio as MediaAsset; falling back to local file", exc_info=True)

    target = _local_generated_asset_path(user_id, asset_id, ext)
    target.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(target.write_bytes, result.audio_bytes)
    _local_audio_assets[asset_id] = {
        "path": str(target),
        "user_id": user_id,
        "project_id": None,
        "chapter_id": None,
        "filename": filename,
        "content_type": result.content_type,
        "size_bytes": len(result.audio_bytes),
        "fingerprint": stable_text_hash(f"{user_id}:{asset_id}:{kind}"),
        "metadata": merged_metadata,
    }
    return TtsGeneratedAudioResponse(
        asset_id=asset_id,
        url=f"/api/tts/assets/{asset_id}",
        download_url=f"/api/tts/assets/{asset_id}/download",
        content_type=result.content_type,
        provider="mimo",
        model=result.model,
        metadata=merged_metadata,
    )


async def read_tts_asset(*, asset_id: str, user_id: str) -> tuple[bytes, str, str]:
    return await read_tts_audio_asset(asset_id=asset_id, user_id=user_id)


async def read_tts_audio_asset(
    *,
    asset_id: str,
    user_id: str,
    db: AsyncSession | None = None,
) -> tuple[bytes, str, str]:
    try:
        _validate_path_component(asset_id, "asset_id")
    except ValueError as exc:
        raise TtsProviderError("asset_not_found", "TTS asset not found", status_code=404) from exc
    asset = _local_audio_assets.get(asset_id)
    if asset and asset.get("user_id") == user_id:
        path = Path(str(asset.get("path") or "")).resolve()
        if path.is_file():
            return await asyncio.to_thread(path.read_bytes), str(asset.get("content_type") or "application/octet-stream"), str(asset.get("filename") or path.name)

    if db is not None:
        media_asset = await db.get(MediaAsset, asset_id)
        if media_asset and media_asset.user_id == user_id and media_asset.status == "active":
            if not (media_asset.mime_type or "").startswith("audio/"):
                raise TtsProviderError("invalid_request", "TTS asset must be audio", status_code=422)
            try:
                stored = await object_storage_service.get_object(object_key=media_asset.object_key)
            except ObjectStorageError as exc:
                raise TtsProviderError(
                    "storage_unavailable",
                    "TTS asset storage is unavailable",
                    status_code=503,
                ) from exc
            return (
                stored.content,
                media_asset.mime_type or stored.content_type or "application/octet-stream",
                media_asset.filename or f"{asset_id}.bin",
            )

    raise TtsProviderError("asset_not_found", "TTS asset not found", status_code=404)


def _load_narration_plan(*, user_id: str, chapter_id: str, plan_id: str) -> TtsNarrationPlan | None:
    cached = _narration_plans.get((user_id, chapter_id, plan_id))
    if cached is not None:
        return cached
    payload = _safe_read_json(_local_plan_path(user_id, chapter_id, plan_id))
    if not payload or payload.get("user_id") != user_id or payload.get("chapter_id") != chapter_id:
        return None
    raw_plan = payload.get("plan")
    if not isinstance(raw_plan, dict):
        return None
    try:
        plan = TtsNarrationPlan.model_validate(raw_plan)
    except ValidationError:
        logger.warning("Failed to validate persisted TTS narration plan: %s", plan_id, exc_info=True)
        return None
    _narration_plans[(user_id, chapter_id, plan_id)] = plan
    return plan


def _latest_narration_plan(*, user_id: str, chapter_id: str) -> TtsNarrationPlan | None:
    candidates = [
        plan
        for (cached_user_id, cached_chapter_id, _plan_id), plan in _narration_plans.items()
        if cached_user_id == user_id and cached_chapter_id == chapter_id
    ]
    plan_dir = _local_tts_asset_root() / user_id / chapter_id / "plans"
    if plan_dir.is_dir():
        for path in sorted(plan_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
            payload = _safe_read_json(path)
            raw_plan = payload.get("plan") if payload else None
            if isinstance(raw_plan, dict):
                try:
                    plan = TtsNarrationPlan.model_validate(raw_plan)
                except ValidationError:
                    continue
                _narration_plans[(user_id, chapter_id, str(plan.plan_id))] = plan
                candidates.append(plan)
                break
    return candidates[-1] if candidates else None


async def get_narration_plan(*, chapter_id: str, user_id: str, plan_id: str | None = None) -> TtsNarrationPlanResponse:
    plan = _load_narration_plan(user_id=user_id, chapter_id=chapter_id, plan_id=plan_id) if plan_id else _latest_narration_plan(user_id=user_id, chapter_id=chapter_id)
    return TtsNarrationPlanResponse(chapter_id=chapter_id, plan=plan, status="available" if plan else "missing")


async def _get_owned_chapter(*, db: AsyncSession, chapter_id: str, user_id: str) -> Chapter:
    chapter_result = await db.execute(
        select(Chapter)
        .join(Project, Chapter.project_id == Project.id)
        .where(Chapter.id == chapter_id, Project.user_id == user_id)
    )
    chapter = chapter_result.scalar_one_or_none()
    if chapter is None:
        raise TtsProviderError("invalid_request", "Chapter not found", status_code=404)
    return chapter


async def save_narration_plan(*, chapter_id: str, req: TtsNarrationPlanRequest, user_id: str, db: AsyncSession | None = None) -> TtsNarrationPlanResponse:
    if not req.plan:
        if req.auto_plan:
            if db is None:
                raise TtsProviderError(
                    "planner_missing_config",
                    "AI narration planner requires database-backed user AI settings",
                    status_code=503,
                )
            chapter = await _get_owned_chapter(db=db, chapter_id=chapter_id, user_id=user_id)
            text = (req.text or chapter.content or "").strip()
            if not text:
                raise TtsProviderError("invalid_request", "Chapter has no content to plan", status_code=422)
            plan = await _auto_generate_narration_plan(
                chapter_id=chapter_id,
                title=getattr(chapter, "title", None),
                text=text,
                req=req,
                user_id=user_id,
                db=db,
            )
            saved = _persist_narration_plan(user_id=user_id, chapter_id=chapter_id, plan=plan)
            return TtsNarrationPlanResponse(chapter_id=chapter_id, plan=saved, status="available")
        raise TtsProviderError("invalid_plan", "Narration plan payload is required", status_code=422)
    if db is not None:
        await _get_owned_chapter(db=db, chapter_id=chapter_id, user_id=user_id)
    try:
        plan = req.plan if isinstance(req.plan, TtsNarrationPlan) else TtsNarrationPlan.model_validate(req.plan)
    except ValidationError as exc:
        raise TtsProviderError(
            "invalid_plan",
            "Invalid TTS narration plan",
            status_code=422,
            details={"errors": exc.errors()},
        ) from exc
    saved = _persist_narration_plan(user_id=user_id, chapter_id=chapter_id, plan=plan)
    return TtsNarrationPlanResponse(chapter_id=chapter_id, plan=saved, status="available")


def _response_snippet(response: httpx.Response) -> str:
    try:
        return response.text[:500]
    except Exception:
        return ""


def _normalize_provider_status(provider: str, status: int) -> tuple[str, int, str]:
    if status in {401, 403}:
        return "auth_failed", 502, f"TTS provider ({provider}) authentication failed"
    if status == 404:
        return "unsupported_endpoint", 502, f"TTS provider ({provider}) endpoint is unavailable"
    if status == 429:
        return "rate_limited", 429, f"TTS provider ({provider}) rate limit exceeded"
    return "provider_failed", 502, f"TTS provider ({provider}) returned {status}"


def _extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            raise
        payload = json.loads(raw[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("planner response is not a JSON object")
    return payload


def _build_narration_planner_prompt(*, chapter_id: str, title: str | None, text: str, req: TtsNarrationPlanRequest) -> tuple[str, str]:
    system_prompt = (
        "You are a novel audiobook narration planner. "
        "Return only strict JSON. Do not rewrite the source text. "
        "Split the chapter into narration/audio segments and infer speakers with confidence. "
        "Use speaker ids that are stable ASCII slugs. Do not invent voice cloning or pronunciation dictionaries."
    )
    user_payload = {
        "schema": "miaowu.tts.narration_plan.v1",
        "required_output_shape": {
            "plan_id": "optional string",
            "chapter_id": chapter_id,
            "provider": req.provider,
            "model": req.model,
            "default_voice": req.voice,
            "speakers": [
                {"id": "narrator", "display_name": "旁白", "voice": req.voice or "default_voice", "style": "optional", "instructions": "optional"}
            ],
            "segments": [
                {"speaker_id": "narrator", "text": "original text segment", "confidence": 0.95, "warnings": []}
            ],
            "confidence": 0.9,
            "warnings": [],
            "metadata": {},
        },
        "rules": [
            "Preserve all text content exactly except trimming surrounding whitespace.",
            "Do not perform pronunciation replacement.",
            "Do not return SSML.",
            "Do not include audio URLs or generated audio.",
            "Every segment.speaker_id must match a speakers[].id.",
            "If speaker identity is uncertain, keep the best guess and add a warning.",
        ],
        "chapter": {
            "chapter_id": chapter_id,
            "title": title,
            "text": text,
        },
        "speaker_voices": req.speaker_voices or {},
    }
    return system_prompt, json.dumps(user_payload, ensure_ascii=False)


async def _auto_generate_narration_plan(
    *,
    chapter_id: str,
    title: str | None,
    text: str,
    req: TtsNarrationPlanRequest,
    user_id: str,
    db: AsyncSession,
) -> TtsNarrationPlan:
    try:
        ai_service = await create_user_ai_service_from_db(db, user_id, module_id="tts_planner")
    except Exception as exc:
        raise TtsProviderError(
            "planner_missing_config",
            "AI narration planner is not configured",
            status_code=503,
        ) from exc
    system_prompt, prompt = _build_narration_planner_prompt(chapter_id=chapter_id, title=title, text=text, req=req)
    try:
        payload = await ai_service.call_with_json_retry(
            prompt=prompt,
            max_retries=3,
            expected_type="object",
            model=req.model,
            temperature=0.1,
            max_tokens=4000,
            system_prompt=system_prompt,
            auto_mcp=False,
        )
        payload.setdefault("chapter_id", chapter_id)
        payload.setdefault("provider", req.provider)
        if req.voice and not payload.get("default_voice"):
            payload["default_voice"] = req.voice
        plan = TtsNarrationPlan.model_validate(payload)
    except ValueError as exc:
        raise TtsProviderError(
            "planner_invalid_json",
            "AI narration planner returned invalid JSON",
            status_code=502,
        ) from exc
    except ValidationError as exc:
        raise TtsProviderError(
            "planner_invalid_json",
            "AI narration planner returned an invalid narration plan",
            status_code=502,
            details={"errors": exc.errors()},
        ) from exc
    except Exception as exc:
        raise TtsProviderError("planner_failed", "AI narration planner failed", status_code=502) from exc
    return plan


def _professional_features_metadata() -> dict[str, Any]:
    return {
        "professional_features": {
            "pronunciation_dictionary": False,
            "role_voices": False,
            "timestamps": False,
            "ssml": False,
            "postprocess": False,
            "export": False,
            "narration_plan": True,
        },
        "unsupported_professional_features": [
            "pronunciation_dictionary",
            "role_voices",
            "timestamps",
            "ssml",
            "postprocess",
            "export",
        ],
    }


def _build_single_narrator_units(*, text: str, req: TtsChapterGenerateRequest, project_id: str, chapter_id: str) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    units: list[dict[str, Any]] = []
    chunks = chunk_fingerprints(
        text=text,
        provider=req.provider,
        model=req.model,
        voice=req.voice,
        instructions=req.instructions,
        fmt=req.fmt,
        speed=req.speed,
        project_id=project_id,
        chapter_id=chapter_id,
        max_chars=req.max_chunk_chars,
    )
    for chunk in chunks:
        units.append({
            **chunk,
            "unit_index": len(units),
            "speaker_id": "narrator",
            "display_name": "Narrator",
            "voice": req.voice,
            "style": None,
            "instructions": req.instructions,
            "confidence": None,
            "warnings": [],
        })
    return units, _professional_features_metadata(), text


def _plan_hash(plan: TtsNarrationPlan | None) -> str | None:
    if plan is None:
        return None
    return stable_text_hash(_canonical_json(plan.model_dump(mode="json")))


def _role_voice_ref_from_mapping(value: SpeakerVoiceMappingValue | dict[str, Any] | None) -> TtsRoleVoiceReference | None:
    if value is None or isinstance(value, str):
        return None
    if isinstance(value, TtsRoleVoiceReference):
        return value
    if isinstance(value, dict):
        return TtsRoleVoiceReference.model_validate(value)
    return None


def _voice_id_from_mapping(value: SpeakerVoiceMappingValue | dict[str, Any] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    ref = _role_voice_ref_from_mapping(value)
    if ref is None:
        return None
    return ref.voice or ref.generated_sample_asset_id or ref.reference_audio_asset_id


def _role_voice_metadata(ref: TtsRoleVoiceReference | None, *, source: str) -> dict[str, Any] | None:
    if ref is None:
        return None
    metadata = ref.model_dump(mode="json", exclude_none=True)
    metadata["source"] = source
    return metadata


def _speaker_voices_json(speaker_voices: dict[str, SpeakerVoiceMappingValue] | None) -> dict[str, Any]:
    return {
        speaker_id: value.model_dump(mode="json") if isinstance(value, TtsRoleVoiceReference) else value
        for speaker_id, value in (speaker_voices or {}).items()
    }


def _resolved_voice_for_segment(
    *,
    req: TtsChapterGenerateRequest,
    plan: TtsNarrationPlan,
    speaker: TtsNarrationSpeaker,
    segment: TtsNarrationSegment,
) -> dict[str, Any]:
    mapping_value = (req.speaker_voices or {}).get(segment.speaker_id)
    explicit_ref = _role_voice_ref_from_mapping(mapping_value)
    segment_ref = segment.role_voice
    speaker_ref = speaker.role_voice
    role_ref = explicit_ref or segment_ref or speaker_ref
    role_source = "speaker_voices" if explicit_ref else "segment" if segment_ref else "speaker" if speaker_ref else None

    voice = (
        _voice_id_from_mapping(mapping_value)
        or segment.voice
        or _voice_id_from_mapping(segment_ref)
        or _voice_id_from_mapping(speaker_ref)
        or speaker.voice
        or plan.default_voice
        or req.voice
    )
    provider = role_ref.provider if role_ref and role_ref.provider else req.provider
    model = role_ref.model if role_ref and role_ref.model else req.model or plan.model
    advanced_options = dict(req.advanced_options or {})
    if provider == "mimo" and role_ref:
        prompt_parts = [advanced_options.get("prompt"), role_ref.voice_description, role_ref.personality]
        prompt = "\n".join(str(part).strip() for part in prompt_parts if str(part or "").strip())
        if prompt:
            advanced_options["prompt"] = prompt
        if role_ref.reference_audio_asset_id:
            advanced_options["reference_audio_asset_id"] = role_ref.reference_audio_asset_id

    return {
        "provider": provider,
        "model": model,
        "voice": voice,
        "advanced_options": advanced_options or None,
        "role_voice": _role_voice_metadata(role_ref, source=role_source or "none"),
        "voice_resolution": {
            "source": (
                "speaker_voices"
                if _voice_id_from_mapping(mapping_value)
                else "segment_voice"
                if segment.voice
                else "segment_role_voice"
                if segment_ref
                else "speaker_role_voice"
                if speaker_ref
                else "speaker_voice"
                if speaker.voice
                else "plan_default_voice"
                if plan.default_voice
                else "request_voice"
                if req.voice
                else "provider_default"
            ),
            "role_voice_source": role_source,
        },
    }


def _build_plan_units(
    *,
    plan: TtsNarrationPlan,
    req: TtsChapterGenerateRequest,
    project_id: str,
    chapter_id: str,
) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    speakers = {speaker.id: speaker for speaker in plan.speakers}
    units: list[dict[str, Any]] = []
    plan_digest = _plan_hash(plan)
    fingerprint_text_parts: list[str] = []
    for segment_index, segment in enumerate(plan.segments):
        speaker = speakers[segment.speaker_id]
        resolved = _resolved_voice_for_segment(req=req, plan=plan, speaker=speaker, segment=segment)
        provider = resolved["provider"]
        model = resolved["model"]
        voice = resolved["voice"]
        instructions = segment.instructions or segment.style or speaker.instructions or speaker.style or req.instructions
        fingerprint_text_parts.append(f"{segment.speaker_id}:{provider}:{model}:{voice}:{instructions or ''}:{segment.text}")
        chunks = chunk_fingerprints(
            text=segment.text,
            provider=provider,
            model=model,
            voice=voice,
            instructions=instructions,
            fmt=req.fmt,
            speed=req.speed,
            project_id=project_id,
            chapter_id=chapter_id,
            max_chars=req.max_chunk_chars,
            extra={"plan_hash": plan_digest, "segment_index": segment_index, "speaker_id": segment.speaker_id},
        )
        for chunk in chunks:
            units.append({
                **chunk,
                "unit_index": len(units),
                "segment_index": segment_index,
                "speaker_id": segment.speaker_id,
                "display_name": speaker.display_name,
                "provider": provider,
                "model": model,
                "voice": voice,
                "advanced_options": resolved["advanced_options"],
                "role_voice": resolved["role_voice"],
                "voice_resolution": resolved["voice_resolution"],
                "style": segment.style or speaker.style,
                "instructions": instructions,
                "confidence": segment.confidence,
                "warnings": segment.warnings,
            })
    metadata = {
        **_professional_features_metadata(),
        "plan_id": plan.plan_id,
        "plan_hash": plan_digest,
        "plan_confidence": plan.confidence,
        "plan_warnings": plan.warnings,
        "speakers": [speaker.model_dump(mode="json") for speaker in plan.speakers],
        "speaker_voices": _speaker_voices_json(req.speaker_voices),
    }
    return units, metadata, "\n".join(fingerprint_text_parts)


def _wav_duration_seconds(audio: bytes) -> float | None:
    try:
        with wave.open(BytesIO(audio), "rb") as reader:
            frames = reader.getnframes()
            rate = reader.getframerate()
            return round(frames / float(rate), 3) if rate else None
    except Exception:
        return None


def _concat_audio_chunks(chunks: list[bytes], media_type: str) -> bytes:
    media_type = _normalize_audio_media_type(media_type)
    if media_type != "audio/wav" or len(chunks) <= 1:
        return b"".join(chunks)
    params = None
    frames: list[bytes] = []
    for chunk in chunks:
        try:
            with wave.open(BytesIO(chunk), "rb") as reader:
                current = reader.getparams()
                if params is None:
                    params = current
                elif current[:3] != params[:3]:
                    return b"".join(chunks)
                frames.append(reader.readframes(reader.getnframes()))
        except Exception:
            return b"".join(chunks)
    if params is None:
        return b"".join(chunks)
    out = BytesIO()
    with wave.open(out, "wb") as writer:
        writer.setparams(params)
        for frame_bytes in frames:
            writer.writeframes(frame_bytes)
    return out.getvalue()


def _ffmpeg_concat_extension(media_type: str) -> str:
    if media_type in {"audio/mpeg", "audio/mp3"}:
        return "mp3"
    if media_type == "audio/aac":
        return "aac"
    if media_type == "audio/ogg":
        return "ogg"
    if media_type == "audio/opus":
        return "opus"
    if media_type == "audio/flac":
        return "flac"
    return ext_from_content_type(media_type)


def _ffmpeg_concat_list_line(path: Path) -> str:
    # The concat demuxer accepts forward slashes on Windows and single-quote escaping.
    escaped = path.as_posix().replace("'", "'\\''")
    return f"file '{escaped}'\n"


async def _run_ffmpeg_concat(
    *,
    ffmpeg_bin: str,
    list_path: Path,
    output_path: Path,
    reencode: bool,
) -> tuple[int, bytes]:
    command = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-vn",
    ]
    if reencode:
        command.extend(["-codec:a", "libmp3lame", "-q:a", "2"])
    else:
        command.extend(["-c", "copy"])
    command.append(str(output_path))
    proc = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=FFMPEG_TIMEOUT_SECONDS)
    except TimeoutError:
        proc.kill()
        await proc.communicate()
        return 124, b"ffmpeg timed out"
    return proc.returncode or 0, stderr or b""


async def _mux_mp3_chunks_with_ffmpeg(chunks: list[bytes], media_type: str) -> tuple[bytes, str]:
    ffmpeg_bin = _resolve_ffmpeg_bin()
    if not ffmpeg_bin:
        raise TtsProviderError(
            "unsupported_feature",
            "FFmpeg is required to export multiple MP3 TTS chunks as one file",
            status_code=400,
            details={
                "media_type": media_type,
                "chunk_count": len(chunks),
                "reason": "missing_ffmpeg",
                "env_vars": list(FFMPEG_BINARY_ENV_VARS),
            },
        )
    extension = _ffmpeg_concat_extension(media_type)
    with tempfile.TemporaryDirectory(prefix="miaowu-tts-export-") as tmpdir:
        tmp_root = Path(tmpdir)
        chunk_paths: list[Path] = []
        for index, chunk in enumerate(chunks):
            chunk_path = tmp_root / f"chunk_{index:05d}.{extension}"
            chunk_path.write_bytes(chunk)
            chunk_paths.append(chunk_path)
        list_path = tmp_root / "concat.txt"
        list_path.write_text("".join(_ffmpeg_concat_list_line(path) for path in chunk_paths), encoding="utf-8")

        copied_output = tmp_root / "chapter.copy.mp3"
        copy_code, copy_stderr = await _run_ffmpeg_concat(
            ffmpeg_bin=ffmpeg_bin,
            list_path=list_path,
            output_path=copied_output,
            reencode=False,
        )
        if copy_code == 0 and copied_output.is_file() and copied_output.stat().st_size > 0:
            return copied_output.read_bytes(), "audio/mpeg"

        encoded_output = tmp_root / "chapter.mp3"
        encode_code, encode_stderr = await _run_ffmpeg_concat(
            ffmpeg_bin=ffmpeg_bin,
            list_path=list_path,
            output_path=encoded_output,
            reencode=True,
        )
        if encode_code == 0 and encoded_output.is_file() and encoded_output.stat().st_size > 0:
            return encoded_output.read_bytes(), "audio/mpeg"

    stderr_text = (encode_stderr or copy_stderr).decode("utf-8", errors="replace")[:1000]
    if stderr_text:
        logger.warning("FFmpeg error output: %s", stderr_text[:500])
    raise TtsProviderError(
        "provider_failed",
        "FFmpeg failed to export chapter TTS audio",
        status_code=502,
        details={
            "media_type": media_type,
            "chunk_count": len(chunks),
            "reason": "ffmpeg_failed",
            "ffmpeg_error": "FFmpeg processing failed" if stderr_text else None,
        },
    )


async def _build_chapter_download_audio(chunks: list[bytes], media_type: str) -> tuple[bytes, str]:
    media_type = _normalize_audio_media_type(media_type)
    if len(chunks) <= 1:
        return (chunks[0] if chunks else b""), media_type
    if media_type == "audio/wav":
        return _concat_audio_chunks(chunks, media_type), media_type
    if media_type in {"audio/mpeg", "audio/mp3"}:
        return await _mux_mp3_chunks_with_ffmpeg(chunks, media_type)
    raise TtsProviderError(
        "unsupported_feature",
        "Chapter audio download for multiple chunks in this format is not supported",
        status_code=400,
        details={
            "media_type": media_type,
            "chunk_count": len(chunks),
            "reason": "unsupported_chunked_audio_format",
            "supported_multi_chunk_formats": ["audio/wav", "audio/mpeg"],
        },
    )


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def stable_text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def synthesis_fingerprint(
    *,
    project_id: str | None = None,
    chapter_id: str | None = None,
    text: str,
    provider: str,
    model: str | None,
    voice: str | None,
    instructions: str | None,
    fmt: str | None,
    speed: float | None,
    extra: dict[str, Any] | None = None,
) -> str:
    payload = {
        "version": 1,
        "project_id": project_id,
        "chapter_id": chapter_id,
        "text_hash": stable_text_hash(text),
        "provider": provider,
        "model": model,
        "voice": voice,
        "instructions_hash": stable_text_hash(instructions or ""),
        "format": fmt,
        "speed": speed,
        "extra": extra or {},
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


_SENTENCE_RE = re.compile(r"(?<=[。！？!?；;])")


def chunk_text(text: str, *, max_chars: int = 1200) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []
    if max_chars < 1:
        raise ValueError("max_chars must be positive")

    chunks: list[str] = []
    current = ""
    for sentence in [part.strip() for part in _SENTENCE_RE.split(normalized) if part.strip()]:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            for index in range(0, len(sentence), max_chars):
                chunks.append(sentence[index : index + max_chars])
            continue
        if current and len(current) + 1 + len(sentence) > max_chars:
            chunks.append(current)
            current = sentence
        else:
            current = sentence if not current else f"{current} {sentence}"
    if current:
        chunks.append(current)
    return chunks


def chunk_fingerprints(
    *,
    text: str,
    provider: str,
    model: str | None,
    voice: str | None,
    instructions: str | None,
    fmt: str | None,
    speed: float | None,
    project_id: str | None = None,
    chapter_id: str | None = None,
    max_chars: int = 1200,
    extra: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    chunks = chunk_text(text, max_chars=max_chars)
    return [
        {
            "index": index,
            "text": chunk,
            "text_hash": stable_text_hash(chunk),
            "fingerprint": synthesis_fingerprint(
                project_id=project_id,
                chapter_id=chapter_id,
                text=chunk,
                provider=provider,
                model=model,
                voice=voice,
                instructions=instructions,
                fmt=fmt,
                speed=speed,
                extra={
                    "chunk_index": index,
                    "chunk_count": len(chunks),
                    **(extra or {}),
                },
            ),
        }
        for index, chunk in enumerate(chunks)
    ]


async def resolve_openai_config(
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
    ai_provider_id: str | None = None,
) -> OpenAIConfig:
    if user_id and db is not None:
        settings = await get_ai_settings_service().get_or_create_settings(user_id, db)
        runtime, source = resolve_user_ai_runtime_config(
            settings,
            ai_provider_id=ai_provider_id,
            module_id="tts",
        )
        provider = (runtime.get("api_provider") or "").strip().lower()
        base_url = (runtime.get("api_base_url") or "").strip().rstrip("/")
        api_key = (runtime.get("api_key") or "").strip() or None
        if provider in {"openai", "custom"} and base_url:
            if not base_url.endswith("/v1"):
                base_url = f"{base_url}/v1"
            return OpenAIConfig(base_url=base_url, api_key=api_key, source=source, provider_id=ai_provider_id)

    base_url = _explicit_openai_tts_base_url()
    if not base_url:
        raise TtsProviderError(
            "missing_config",
            "OPENAI_TTS_BASE_URL is not configured for TTS",
            provider="openai",
        )
    speech_base_url = _normalize_openai_base_url(base_url)
    api_key = _explicit_openai_tts_api_key()
    return OpenAIConfig(base_url=speech_base_url, api_key=api_key, source="env")


async def resolve_mimo_config(
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
    ai_provider_id: str | None = None,
) -> MiMoConfig:
    if user_id and db is not None:
        settings = await get_ai_settings_service().get_or_create_settings(user_id, db)
        explicit_provider_id = (ai_provider_id or "").strip() or None
        if explicit_provider_id and not _is_provider_allowed_for_tts_modules(settings, explicit_provider_id, MIMO_ROUTE_MODULE_IDS):
            raise TtsProviderError(
                "missing_config",
                "MiMo TTS provider must be explicitly routed to tts, tts-studio, or mimo-tts",
                provider="mimo",
            )
        module_ids = (None,) if ai_provider_id else tuple(item for item in (_first_explicit_tts_module_id(settings),) if item)
        for module_id in module_ids:
            runtime, source = resolve_user_ai_runtime_config(
                settings,
                ai_provider_id=ai_provider_id,
                module_id=module_id,
            )
            provider = (runtime.get("api_provider") or "").strip().lower()
            base_url = (runtime.get("api_base_url") or "").strip().rstrip("/")
            api_key = (runtime.get("api_key") or "").strip() or None
            if provider in {"openai", "custom", "newapi", "mimo"} and base_url:
                return MiMoConfig(
                    base_url=_normalize_openai_base_url(base_url),
                    api_key=api_key,
                    source=source if ai_provider_id else f"feature-routing:{module_id}",
                    provider_id=ai_provider_id,
                    model=str(runtime.get("model_name") or MIMO_DEFAULT_MODEL),
                    provider=provider,
                )

    base_url = _explicit_mimo_base_url()
    if not base_url:
        raise TtsProviderError(
            "missing_config",
            "MIMO_TTS_BASE_URL is not configured for TTS",
            provider="mimo",
        )
    return MiMoConfig(
        base_url=_normalize_openai_base_url(base_url),
        api_key=_explicit_mimo_api_key(),
        source="env",
        model=(os.getenv("MIMO_TTS_MODEL") or MIMO_DEFAULT_MODEL).strip() or MIMO_DEFAULT_MODEL,
        provider="mimo",
    )


def resolve_volcengine_config() -> VolcengineConfig:
    app_id = (os.getenv("VOLCENGINE_TTS_APPID") or "").strip()
    access_token = (os.getenv("VOLCENGINE_TTS_ACCESS_TOKEN") or "").strip()
    cluster = (os.getenv("VOLCENGINE_TTS_CLUSTER") or "volcano_tts").strip()
    if not app_id or not access_token:
        raise TtsProviderError(
            "missing_config",
            "VOLCENGINE_TTS_APPID and VOLCENGINE_TTS_ACCESS_TOKEN must be configured",
            provider="volcengine",
        )
    return VolcengineConfig(app_id=app_id, access_token=access_token, cluster=cluster)


def resolve_moss_config() -> MossConfig:
    base_url = (os.getenv("MOSS_TTS_BASE_URL") or MOSS_DEFAULT_BASE_URL).strip().rstrip("/")
    return MossConfig(base_url=base_url)


def _normalize_openai_base_url(base_url: str) -> str:
    value = base_url.strip().rstrip("/")
    return value if value.endswith("/v1") else f"{value}/v1"


def _explicit_openai_tts_base_url() -> str:
    """Return only TTS-specific OpenAI-compatible base URLs.

    Plain OPENAI_BASE_URL/OPENAI_API_BASE are used by the chat/model runtime and
    do not prove that /v1/audio/speech is wired for the TTS feature.
    """
    return (
        os.getenv("OPENAI_TTS_BASE_URL")
        or os.getenv("OPENAI_TTS_API_BASE")
        or os.getenv("TTS_OPENAI_BASE_URL")
        or os.getenv("TTS_OPENAI_API_BASE")
        or ""
    ).strip().rstrip("/")


def _explicit_openai_tts_api_key() -> str | None:
    return (
        os.getenv("OPENAI_TTS_API_KEY")
        or os.getenv("TTS_OPENAI_API_KEY")
        or ""
    ).strip() or None


def _has_explicit_tts_feature_routing(settings: Any) -> bool:
    """Return True only when user settings explicitly route the TTS module."""
    return _find_explicit_tts_module_id(settings, ("tts",)) is not None


def _first_explicit_tts_module_id(settings: Any) -> str | None:
    return _find_explicit_tts_module_id(settings, MIMO_ROUTE_MODULE_IDS)


def _find_explicit_tts_module_id(settings: Any, module_ids: tuple[str, ...]) -> str | None:
    parsed = _load_ai_provider_settings_from_preferences(settings)
    if parsed is None:
        return None

    modules = parsed.get("feature_routing_modules")
    if not isinstance(modules, list):
        return None

    for module_id in module_ids:
        if any(isinstance(item, dict) and str(item.get("moduleId") or "").strip() == module_id for item in modules):
            return module_id
    return None


def _load_ai_provider_settings_from_preferences(settings: Any) -> dict[str, Any] | None:
    preferences = getattr(settings, "preferences", None)
    if isinstance(preferences, str):
        try:
            preferences = json.loads(preferences)
        except json.JSONDecodeError:
            return None
    if not isinstance(preferences, dict):
        return None

    provider_settings = preferences.get("ai_provider_settings")
    if not isinstance(provider_settings, dict):
        return None

    feature_settings = provider_settings.get("feature_routing_settings")
    if not isinstance(feature_settings, dict):
        return None

    modules = feature_settings.get("modules")
    provider_settings = dict(provider_settings)
    provider_settings["feature_routing_modules"] = modules if isinstance(modules, list) else []
    return provider_settings


def _routing_node_provider_id(node: Any) -> str | None:
    if not isinstance(node, dict):
        return None
    value = node.get("providerId") or node.get("provider_id")
    return str(value).strip() if value else None


def _is_provider_allowed_for_tts_modules(settings: Any, provider_id: str, module_ids: tuple[str, ...]) -> bool:
    parsed = _load_ai_provider_settings_from_preferences(settings)
    if parsed is None:
        return False
    modules = parsed.get("feature_routing_modules")
    if not isinstance(modules, list):
        return False
    allowed_module_ids = set(module_ids)
    for item in modules:
        if not isinstance(item, dict) or str(item.get("moduleId") or "").strip() not in allowed_module_ids:
            continue
        for key in ("primaryTarget", "backupTarget", "defaultTarget"):
            if _routing_node_provider_id(item.get(key)) == provider_id:
                return True
    return False


def _explicit_mimo_base_url() -> str:
    return (
        os.getenv("MIMO_TTS_BASE_URL")
        or os.getenv("MIMO_BASE_URL")
        or os.getenv("MIMO_API_BASE")
        or ""
    ).strip().rstrip("/")


def _explicit_mimo_api_key() -> str | None:
    return (
        os.getenv("MIMO_TTS_API_KEY")
        or os.getenv("MIMO_API_KEY")
        or ""
    ).strip() or None


def list_voices_for_provider(provider: TtsProvider | None = None, model: str | None = None) -> list[TtsVoiceInfo]:
    voices: list[TtsVoiceInfo] = []
    if provider is None or provider == "openai":
        voices.extend(OPENAI_VOICES)
    if provider is None or provider == "volcengine":
        voices.extend(VOLCENGINE_VOICES)
    if provider is None or provider == "moss-local":
        voices.extend(MOSS_VOICES)
    if provider is None or provider == "mimo":
        voices.extend(MIMO_VOICES)
    if model:
        voices = [voice for voice in voices if not voice.models or model in voice.models]
    return voices


async def build_config_response(
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
) -> TtsConfigResponse:
    openai_available = bool(_explicit_openai_tts_base_url())
    openai_source: str | None = "env" if openai_available else None
    openai_provider_id: str | None = None
    openai_model = OPENAI_DEFAULT_MODEL
    mimo_available = bool(_explicit_mimo_base_url())
    mimo_source: str | None = "env" if mimo_available else None
    mimo_provider_id: str | None = None
    mimo_model = (os.getenv("MIMO_TTS_MODEL") or MIMO_DEFAULT_MODEL).strip() or MIMO_DEFAULT_MODEL
    if user_id and db is not None:
        try:
            settings = await get_ai_settings_service().get_or_create_settings(user_id, db)
            if _has_explicit_tts_feature_routing(settings):
                config = await resolve_openai_config(user_id=user_id, db=db)
                openai_available = True
                openai_source = config.source
                openai_provider_id = config.provider_id
        except TtsProviderError:
            pass
        try:
            settings = await get_ai_settings_service().get_or_create_settings(user_id, db)
            runtime, _source = resolve_user_ai_runtime_config(settings, module_id="tts")
            if runtime.get("model_name"):
                openai_model = str(runtime["model_name"])
        except Exception:
            logger.debug("Skip reading user AI settings for TTS config.", exc_info=True)
        try:
            config = await resolve_mimo_config(user_id=user_id, db=db)
            mimo_available = True
            mimo_source = config.source
            mimo_provider_id = config.provider_id
            if config.model:
                mimo_model = config.model
        except TtsProviderError:
            pass

    volcengine_available = bool((os.getenv("VOLCENGINE_TTS_APPID") or "").strip() and (os.getenv("VOLCENGINE_TTS_ACCESS_TOKEN") or "").strip())
    moss_config = resolve_moss_config()

    providers: dict[str, dict[str, Any]] = {
        "openai": {
            "available": openai_available,
            "default_model": openai_model,
            "default_voice": OPENAI_DEFAULT_VOICE,
            "default_format": "mp3",
            "default_speed": 1.0,
            "supports_instructions": True,
            "supports_streaming": True,
            "config_source": openai_source,
            "provider_id": openai_provider_id,
        },
        "volcengine": {
            "available": volcengine_available,
            "default_voice": "zh_male_yangguangqingnian_moon_bigtts",
            "default_format": "mp3",
            "default_speed": 1.0,
            "supports_instructions": False,
            "supports_streaming": False,
            "config_source": "env" if volcengine_available else None,
        },
        "moss-local": {
            "available": True,
            "base_url": moss_config.base_url,
            "default_voice": MOSS_DEFAULT_VOICE,
            "default_model": "moss-tts-nano",
            "default_format": "wav",
            "default_speed": 1.0,
            "supports_instructions": False,
            "supports_streaming": False,
            "config_source": "env" if os.getenv("MOSS_TTS_BASE_URL") else "default",
        },
        "mimo": {
            "available": mimo_available,
            "default_model": mimo_model,
            "default_voice": MIMO_DEFAULT_VOICE,
            "default_format": "mp3",
            "default_speed": 1.0,
            "supports_instructions": True,
            "supports_streaming": False,
            "config_source": mimo_source,
            "provider_id": mimo_provider_id,
            "route_modules": list(MIMO_ROUTE_MODULE_IDS),
        },
    }
    capabilities = {
        "openai": {
            "endpoint": "/v1/audio/speech",
            "formats": ["mp3", "wav", "flac", "aac", "opus", "pcm"],
            "controls": ["model", "voice", "format", "speed", "instructions", "stream_format"],
            "advanced_features": {
                "narration_plan": True,
                "multi_voice": True,
                "pronunciation_dictionary": False,
                "role_voices": False,
                "timestamps": False,
                "ssml": False,
                "postprocess": False,
                "export": False,
            },
        },
        "volcengine": {
            "endpoint": "https://openspeech.bytedance.com/api/v1/tts",
            "formats": ["mp3"],
            "controls": ["voice", "speed"],
        },
        "moss-local": {
            "endpoint": f"{moss_config.base_url}/api/generate",
            "health_endpoints": ["/health", "/api/warmup-status", "/api/text-normalization-status"],
            "formats": ["wav"],
            "controls": ["voice", "seed", "text_temperature", "audio_temperature", "top_p", "top_k", "repetition_penalty", "normalize_text"],
            "advanced_features": {
                "narration_plan": True,
                "multi_voice": True,
                "pronunciation_dictionary": False,
                "role_voices": False,
                "timestamps": False,
                "ssml": False,
                "postprocess": False,
                "export": False,
            },
        },
        "mimo": {
            "endpoint": "/v1/chat/completions",
            "formats": ["mp3", "wav"],
            "controls": ["model", "voice", "format", "instructions", "style", "reference_audio"],
            "advanced_options": ["prompt", "reference_audio_asset_id", "reference_audio_data_url"],
            "advanced_features": {
                "voice_design": True,
                "voice_clone": True,
                "style_optimize": True,
                "voice_design_optimize": True,
                "narration_plan": True,
                "multi_voice": True,
                "pronunciation_dictionary": False,
                "role_voices": True,
                "timestamps": False,
                "ssml": False,
                "postprocess": False,
                "export": False,
            },
        },
    }
    default_provider: TtsProvider | None = "moss-local"
    if openai_available:
        default_provider = "openai"
    elif volcengine_available:
        default_provider = "volcengine"

    for provider_id, provider_capabilities in capabilities.items():
        providers[provider_id]["capabilities"] = provider_capabilities

    return TtsConfigResponse(
        providers=providers,
        default_provider=default_provider,
        defaults={
            "openai_model": OPENAI_DEFAULT_MODEL,
            "openai_voice": OPENAI_DEFAULT_VOICE,
            "moss_voice": MOSS_DEFAULT_VOICE,
            "format": "mp3",
            "speed": 1.0,
        },
        capabilities=capabilities,
    )


async def call_openai_tts(
    req: TtsRequest,
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
) -> TtsAudioResult:
    config = await resolve_openai_config(user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    url = f"{config.base_url}/audio/speech"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"

    model = req.model or OPENAI_DEFAULT_MODEL
    voice = req.voice or OPENAI_DEFAULT_VOICE
    payload: dict[str, Any] = {
        "input": req.text,
        "model": model,
        "voice": voice,
    }
    if req.fmt:
        payload["response_format"] = req.fmt
    if req.speed is not None:
        payload["speed"] = req.speed
    if req.instructions:
        payload["instructions"] = req.instructions

    client = await get_http_client()
    try:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise TtsProviderError("provider_timeout", "TTS provider (openai) request timed out", provider="openai") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        error_code, status_code, message = _normalize_provider_status("openai", status)
        logger.error("OpenAI TTS error: status=%d body=%s", status, _response_snippet(exc.response))
        raise TtsProviderError(error_code, message, provider="openai", status_code=status_code, details={"status": status}) from exc
    except httpx.RequestError as exc:
        logger.error("OpenAI TTS request error: %s", exc)
        raise TtsProviderError("provider_failed", "TTS provider (openai) request failed", provider="openai") from exc

    audio_bytes = response.content
    content_type = (response.headers.get("content-type") or "audio/mpeg").split(";")[0].strip()
    if not audio_bytes:
        raise TtsProviderError("provider_failed", "TTS provider (openai) returned empty audio data", provider="openai")
    if not content_type.startswith("audio/"):
        logger.error("OpenAI TTS returned non-audio content: content_type=%s body=%s", content_type, _response_snippet(response))
        raise TtsProviderError(
            "provider_failed",
            "TTS provider (openai) returned non-audio content",
            provider="openai",
            details={"content_type": content_type},
        )
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        logger.warning("OpenAI TTS response oversized: %d bytes", len(audio_bytes))
        raise TtsProviderError("provider_failed", "TTS provider returned audio exceeding size limit", provider="openai")

    return TtsAudioResult(audio_bytes=audio_bytes, content_type=content_type, provider="openai", model=model, voice=voice)


async def call_volcengine_tts(req: TtsRequest) -> TtsAudioResult:
    config = resolve_volcengine_config()
    url = "https://openspeech.bytedance.com/api/v1/tts"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer;{config.access_token}",
    }

    voice = req.voice or "zh_male_yangguangqingnian_moon_bigtts"
    speed_ratio = req.speed or 1.0
    payload: dict[str, Any] = {
        "app": {"appid": config.app_id, "token": "access_token", "cluster": config.cluster},
        "user": {"uid": "miaowu-tts"},
        "audio": {
            "voice_type": voice,
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

    client = await get_http_client()
    try:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise TtsProviderError("provider_timeout", "TTS provider (volcengine) request timed out", provider="volcengine") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        error_code, status_code, message = _normalize_provider_status("volcengine", status)
        logger.error("Volcengine TTS error: status=%d", status)
        raise TtsProviderError(error_code, message, provider="volcengine", status_code=status_code, details={"status": status}) from exc
    except httpx.RequestError as exc:
        logger.error("Volcengine TTS request error: %s", exc)
        raise TtsProviderError("provider_failed", "TTS provider (volcengine) request failed", provider="volcengine") from exc

    result = response.json()
    code = result.get("code")
    if code != 3000:
        message = result.get("message", "unknown")
        logger.error("Volcengine TTS API error: code=%s message=%s", code, message)
        raise TtsProviderError(
            "provider_failed",
            "TTS provider (volcengine) returned an API error",
            provider="volcengine",
            details={"code": code, "message": message},
        )

    audio_data = result.get("data")
    if not audio_data:
        raise TtsProviderError("provider_failed", "TTS provider (volcengine) returned empty audio data", provider="volcengine")
    try:
        audio_bytes = base64.b64decode(audio_data)
    except Exception as exc:
        raise TtsProviderError("provider_failed", "TTS provider (volcengine) returned invalid audio data", provider="volcengine") from exc

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        logger.warning("Volcengine TTS response oversized: %d bytes", len(audio_bytes))
        raise TtsProviderError("provider_failed", "TTS provider returned audio exceeding size limit", provider="volcengine")

    return TtsAudioResult(audio_bytes=audio_bytes, content_type="audio/mpeg", provider="volcengine", voice=voice)


async def get_moss_readiness() -> dict[str, Any]:
    config = resolve_moss_config()
    client = await get_http_client()
    checks: dict[str, Any] = {}
    for path in ("/health", "/api/warmup-status", "/api/text-normalization-status"):
        url = f"{config.base_url}{path}"
        try:
            response = await client.get(url)
            checks[path] = {
                "ok": 200 <= response.status_code < 300,
                "status": response.status_code,
                "body": response.json() if (response.headers.get("content-type") or "").startswith("application/json") else response.text[:500],
            }
        except httpx.TimeoutException:
            checks[path] = {"ok": False, "error_code": "provider_timeout"}
        except httpx.RequestError as exc:
            checks[path] = {"ok": False, "error_code": "provider_failed", "detail": str(exc)}
    return {
        "provider": "moss-local",
        "base_url": config.base_url,
        "ok": all(check.get("ok") for check in checks.values()),
        "checks": checks,
    }


async def call_moss_tts(req: TtsRequest) -> TtsAudioResult:
    config = resolve_moss_config()
    url = f"{config.base_url}/api/generate"
    try:
        advanced_options = MossAdvancedOptions.model_validate(req.advanced_options or {})
    except ValidationError as exc:
        raise TtsProviderError(
            "invalid_request",
            "Invalid moss-local advanced_options",
            provider="moss-local",
            status_code=422,
            details={"errors": exc.errors()},
        ) from exc
    voice = (
        req.voice
        or advanced_options.demo_id
        or MOSS_DEFAULT_VOICE
    )
    fields: dict[str, Any] = {
        "text": req.text,
        "demo_id": voice,
    }

    normalize_text = req.normalize_text
    if normalize_text is None:
        normalize_text = advanced_options.normalize_text
    if normalize_text is not None:
        value = "1" if normalize_text else "0"
        fields["enable_text_normalization"] = value
        fields["enable_normalize_tts_text"] = value

    seed = req.seed if req.seed is not None else advanced_options.seed
    if seed is not None:
        fields["seed"] = str(seed)

    for attr, moss_names in (
        ("text_temperature", ("text_temperature",)),
        ("audio_temperature", ("audio_temperature",)),
        ("top_p", ("text_top_p", "audio_top_p")),
        ("top_k", ("text_top_k", "audio_top_k")),
        ("repetition_penalty", ("audio_repetition_penalty",)),
    ):
        value = getattr(req, attr)
        if value is None:
            value = getattr(advanced_options, attr)
        if value is not None:
            for moss_name in moss_names:
                fields[moss_name] = str(value)
    files = {key: (None, value) for key, value in fields.items()}

    client = await get_http_client()
    try:
        response = await client.post(url, files=files)
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise TtsProviderError("provider_timeout", "TTS provider (moss-local) request timed out", provider="moss-local") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        error_code, status_code, message = _normalize_provider_status("moss-local", status)
        logger.error("MOSS TTS error: status=%d body=%s", status, _response_snippet(exc.response))
        raise TtsProviderError(error_code, message, provider="moss-local", status_code=status_code, details={"status": status}) from exc
    except httpx.RequestError as exc:
        logger.error("MOSS TTS request error: %s", exc)
        raise TtsProviderError("provider_failed", "TTS provider (moss-local) request failed", provider="moss-local") from exc

    try:
        result = response.json()
    except ValueError as exc:
        raise TtsProviderError("provider_failed", "TTS provider (moss-local) returned invalid JSON", provider="moss-local") from exc

    audio_base64 = result.get("audio_base64")
    if not audio_base64:
        raise TtsProviderError("provider_failed", "TTS provider (moss-local) returned empty audio data", provider="moss-local")
    try:
        audio_bytes = base64.b64decode(audio_base64)
    except Exception as exc:
        raise TtsProviderError("provider_failed", "TTS provider (moss-local) returned invalid audio data", provider="moss-local") from exc
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        logger.warning("MOSS TTS response oversized: %d bytes", len(audio_bytes))
        raise TtsProviderError("provider_failed", "TTS provider returned audio exceeding size limit", provider="moss-local")

    metadata = {
        key: result.get(key)
        for key in ("sample_rate", "normalized_text", "text_chunks", "duration", "generation_time")
        if key in result
    }
    return TtsAudioResult(audio_bytes=audio_bytes, content_type="audio/wav", provider="moss-local", voice=voice, metadata=metadata)


def _mimo_headers(config: MiMoConfig) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        if config.provider == "mimo":
            headers["api-key"] = config.api_key
        else:
            headers["Authorization"] = f"Bearer {config.api_key}"
    return headers


def _normalize_mimo_format(fmt: str | None) -> str:
    normalized = (fmt or "mp3").strip().lower()
    if normalized not in {"mp3", "wav"}:
        raise TtsProviderError(
            "invalid_request",
            "MiMo TTS format must be mp3 or wav",
            provider="mimo",
            status_code=422,
            details={"format": normalized},
        )
    return normalized


def _mimo_audio_content_type(fmt: str | None) -> str:
    normalized = _normalize_mimo_format(fmt)
    if normalized == "wav":
        return "audio/wav"
    return "audio/mpeg"


def _extract_mimo_message(payload: dict[str, Any]) -> dict[str, Any]:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned an invalid response", provider="mimo")
    first = choices[0]
    if not isinstance(first, dict):
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned an invalid response", provider="mimo")
    message = first.get("message")
    if not isinstance(message, dict):
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned an invalid response", provider="mimo")
    return message


def _extract_mimo_text(payload: dict[str, Any]) -> str:
    message = _extract_mimo_message(payload)
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    raise TtsProviderError("provider_failed", "TTS provider (mimo) returned empty text", provider="mimo")


def _extract_mimo_audio(payload: dict[str, Any], *, content_type: str) -> bytes:
    message = _extract_mimo_message(payload)
    audio = message.get("audio")
    audio_data = audio.get("data") if isinstance(audio, dict) else None
    if not isinstance(audio_data, str) or not audio_data.strip():
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned empty audio data", provider="mimo")
    try:
        audio_bytes = base64.b64decode(audio_data, validate=True)
    except Exception as exc:
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned invalid audio data", provider="mimo") from exc
    if not audio_bytes:
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned empty audio data", provider="mimo")
    if not content_type.startswith("audio/"):
        raise TtsProviderError(
            "provider_failed",
            "TTS provider (mimo) returned non-audio content",
            provider="mimo",
            details={"content_type": content_type},
        )
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        logger.warning("MiMo TTS response oversized: %d bytes", len(audio_bytes))
        raise TtsProviderError("provider_failed", "TTS provider returned audio exceeding size limit", provider="mimo")
    return audio_bytes


async def _post_mimo_chat_completion(
    payload: dict[str, Any],
    *,
    user_id: str | None,
    db: AsyncSession | None,
    ai_provider_id: str | None,
) -> tuple[dict[str, Any], MiMoConfig]:
    config = await resolve_mimo_config(user_id=user_id, db=db, ai_provider_id=ai_provider_id)
    url = f"{config.base_url}/chat/completions"
    client = await get_http_client()
    try:
        response = await client.post(url, json=payload, headers=_mimo_headers(config))
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise TtsProviderError("provider_timeout", "TTS provider (mimo) request timed out", provider="mimo") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        error_code, status_code, message = _normalize_provider_status("mimo", status)
        logger.error("MiMo TTS error: status=%d body=%s", status, _response_snippet(exc.response))
        raise TtsProviderError(error_code, message, provider="mimo", status_code=status_code, details={"status": status}) from exc
    except httpx.RequestError as exc:
        logger.error("MiMo TTS request error: %s", exc)
        raise TtsProviderError("provider_failed", "TTS provider (mimo) request failed", provider="mimo") from exc

    content_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type and not content_type.startswith("application/json"):
        raise TtsProviderError(
            "provider_failed",
            "TTS provider (mimo) returned non-JSON content",
            provider="mimo",
            details={"content_type": content_type},
        )
    try:
        data = response.json()
    except ValueError as exc:
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned invalid JSON", provider="mimo") from exc
    if not isinstance(data, dict):
        raise TtsProviderError("provider_failed", "TTS provider (mimo) returned an invalid response", provider="mimo")
    return data, config


def _mimo_audio_payload(*, model: str, text: str, prompt: str | None, fmt: str | None, voice: str | None = None) -> dict[str, Any]:
    return {
        "model": model,
        "modalities": ["text", "audio"],
        "audio": {
            "voice": voice or MIMO_DEFAULT_VOICE,
            "format": _normalize_mimo_format(fmt),
        },
        "messages": [
            {
                "role": "user",
                "content": "\n".join(part for part in [prompt, text] if part),
            }
        ],
    }


async def call_mimo_tts(
    req: TtsRequest,
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
) -> TtsAudioResult:
    try:
        advanced = MiMoAdvancedOptions.model_validate(req.advanced_options or {})
    except ValidationError as exc:
        raise TtsProviderError(
            "invalid_request",
            "Invalid mimo advanced_options",
            provider="mimo",
            status_code=422,
            details={"errors": exc.errors()},
        ) from exc
    config = await resolve_mimo_config(user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    model = req.model or config.model or MIMO_DEFAULT_MODEL
    prompt = req.instructions or advanced.prompt
    payload = _mimo_audio_payload(model=model, text=req.text, prompt=prompt, fmt=req.fmt, voice=req.voice)
    reference_voice = await _reference_audio_for_mimo_advanced(advanced, user_id=user_id, db=db)
    if reference_voice:
        payload["audio"]["voice"] = reference_voice
    data, _config = await _post_mimo_chat_completion(payload, user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    content_type = _mimo_audio_content_type(req.fmt)
    return TtsAudioResult(
        audio_bytes=_extract_mimo_audio(data, content_type=content_type),
        content_type=content_type,
        provider="mimo",
        model=model,
        voice=req.voice or MIMO_DEFAULT_VOICE,
        metadata={
            "config_source": config.source,
            "reference_audio_asset_id": advanced.reference_audio_asset_id,
            "uses_reference_audio": bool(reference_voice),
        },
    )


async def _mimo_optimize_text(
    *,
    text: str,
    system_prompt: str,
    model: str | None,
    ai_provider_id: str | None,
    user_id: str,
    db: AsyncSession | None,
) -> TtsTextOptimizeResponse:
    config = await resolve_mimo_config(user_id=user_id, db=db, ai_provider_id=ai_provider_id)
    selected_model = model or config.model or MIMO_DEFAULT_MODEL
    payload = {
        "model": selected_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ],
    }
    data, _config = await _post_mimo_chat_completion(payload, user_id=user_id, db=db, ai_provider_id=ai_provider_id)
    return TtsTextOptimizeResponse(
        text=_extract_mimo_text(data),
        provider="mimo",
        model=selected_model,
        metadata={"config_source": config.source},
    )


async def optimize_tts_style(
    req: TtsStyleOptimizeRequest,
    *,
    user_id: str,
    db: AsyncSession | None = None,
) -> TtsTextOptimizeResponse:
    return await _mimo_optimize_text(
        text=req.style_text,
        system_prompt="Optimize this TTS style instruction. Return only the optimized style text.",
        model=req.model,
        ai_provider_id=req.ai_provider_id,
        user_id=user_id,
        db=db,
    )


async def optimize_tts_voice_design(
    req: TtsVoiceDesignOptimizeRequest,
    *,
    user_id: str,
    db: AsyncSession | None = None,
) -> TtsTextOptimizeResponse:
    return await _mimo_optimize_text(
        text=req.voice_description,
        system_prompt="Optimize this voice design description for a TTS voice generator. Return only the optimized description.",
        model=req.model,
        ai_provider_id=req.ai_provider_id,
        user_id=user_id,
        db=db,
    )


async def design_tts_voice(
    req: TtsVoiceDesignRequest,
    *,
    user_id: str,
    db: AsyncSession | None = None,
) -> TtsGeneratedAudioResponse:
    config = await resolve_mimo_config(user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    model = req.model or config.model or MIMO_DEFAULT_MODEL
    prompt = f"Design a voice with this description: {req.voice_description}"
    if req.instruction:
        prompt = f"{prompt}\nInstruction: {req.instruction}"
    payload = _mimo_audio_payload(model=model, text=req.text, prompt=prompt, fmt=req.fmt)
    payload["messages"] = [
        {"role": "user", "content": req.voice_description},
        {"role": "assistant", "content": req.text},
    ]
    payload["audio"].pop("voice", None)
    data, _config = await _post_mimo_chat_completion(payload, user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    content_type = _mimo_audio_content_type(req.fmt)
    result = TtsAudioResult(
        audio_bytes=_extract_mimo_audio(data, content_type=content_type),
        content_type=content_type,
        provider="mimo",
        model=model,
        voice=MIMO_DEFAULT_VOICE,
        metadata={"config_source": config.source},
    )
    return await _persist_generated_tts_audio(
        user_id=user_id,
        result=result,
        kind="voice_design",
        metadata={"voice_description": req.voice_description},
        db=db,
    )


def _parse_audio_data_url(data_url: str) -> tuple[str, bytes]:
    match = re.fullmatch(r"data:([^;,]+);base64,(.+)", data_url.strip(), flags=re.DOTALL)
    if not match:
        raise TtsProviderError("invalid_request", "reference_audio_data_url must be a base64 data URL", provider="mimo", status_code=422)
    content_type = _normalize_audio_media_type(match.group(1))
    if not content_type.startswith("audio/"):
        raise TtsProviderError("invalid_request", "reference_audio_data_url must contain audio data", provider="mimo", status_code=422)
    try:
        audio_bytes = base64.b64decode(match.group(2), validate=True)
    except Exception as exc:
        raise TtsProviderError("invalid_request", "reference_audio_data_url contains invalid base64 data", provider="mimo", status_code=422) from exc
    if not audio_bytes:
        raise TtsProviderError("invalid_request", "reference_audio_data_url contains empty audio data", provider="mimo", status_code=422)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise TtsProviderError("invalid_request", "reference_audio_data_url exceeds audio size limit", provider="mimo", status_code=422)
    return content_type, audio_bytes


async def _reference_audio_for_clone(
    req: TtsVoiceCloneRequest,
    *,
    user_id: str,
    db: AsyncSession | None = None,
) -> tuple[str, bytes]:
    if req.reference_audio_data_url:
        return _parse_audio_data_url(req.reference_audio_data_url)
    assert req.reference_audio_asset_id is not None
    audio_bytes, content_type, _filename = await read_tts_audio_asset(asset_id=req.reference_audio_asset_id, user_id=user_id, db=db)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise TtsProviderError("invalid_request", "reference audio exceeds audio size limit", provider="mimo", status_code=422)
    return _normalize_audio_media_type(content_type), audio_bytes


async def _reference_audio_for_mimo_advanced(
    advanced: MiMoAdvancedOptions,
    *,
    user_id: str | None,
    db: AsyncSession | None = None,
) -> str | None:
    if advanced.reference_audio_data_url:
        content_type, audio_bytes = _parse_audio_data_url(advanced.reference_audio_data_url)
        return f"data:{content_type};base64,{base64.b64encode(audio_bytes).decode('ascii')}"
    if advanced.reference_audio_asset_id:
        if not user_id:
            raise TtsProviderError("invalid_request", "reference_audio_asset_id requires authenticated user context", provider="mimo", status_code=422)
        audio_bytes, content_type, _filename = await read_tts_audio_asset(asset_id=advanced.reference_audio_asset_id, user_id=user_id, db=db)
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise TtsProviderError("invalid_request", "reference audio exceeds audio size limit", provider="mimo", status_code=422)
        return f"data:{_normalize_audio_media_type(content_type)};base64,{base64.b64encode(audio_bytes).decode('ascii')}"
    return None


async def clone_tts_voice(
    req: TtsVoiceCloneRequest,
    *,
    user_id: str,
    db: AsyncSession | None = None,
) -> TtsGeneratedAudioResponse:
    reference_content_type, reference_audio = await _reference_audio_for_clone(req, user_id=user_id, db=db)
    config = await resolve_mimo_config(user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    model = req.model or config.model or MIMO_DEFAULT_MODEL
    prompt_parts = [
        "Clone the voice from the supplied reference audio.",
        f"Reference audio content type: {reference_content_type}.",
        req.instruction,
        req.style,
    ]
    payload = _mimo_audio_payload(model=model, text=req.text, prompt="\n".join(part for part in prompt_parts if part), fmt=req.fmt)
    payload["messages"] = [
        {"role": "user", "content": "\n".join(part for part in [req.instruction, req.style] if part)},
        {"role": "assistant", "content": req.text},
    ]
    payload["audio"]["voice"] = f"data:{reference_content_type};base64,{base64.b64encode(reference_audio).decode('ascii')}"
    data, _config = await _post_mimo_chat_completion(payload, user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    content_type = _mimo_audio_content_type(req.fmt)
    result = TtsAudioResult(
        audio_bytes=_extract_mimo_audio(data, content_type=content_type),
        content_type=content_type,
        provider="mimo",
        model=model,
        voice=MIMO_DEFAULT_VOICE,
        metadata={"config_source": config.source, "reference_content_type": reference_content_type},
    )
    return await _persist_generated_tts_audio(
        user_id=user_id,
        result=result,
        kind="voice_clone",
        metadata={"reference_content_type": reference_content_type},
        db=db,
    )


def validate_advanced_feature_gates(provider: str, advanced_options: dict[str, Any] | None) -> None:
    if not advanced_options:
        return
    unsupported_names = {"pronunciation_dictionary", "role_voices", "ssml", "timestamps", "postprocess", "export"}
    requested = sorted(name for name in unsupported_names if advanced_options.get(name) not in (None, False, {}, []))
    if requested:
        raise TtsProviderError(
            "unsupported_feature",
            f"TTS advanced feature is not supported locally: {requested[0]}",
            provider=provider,
            status_code=400,
            details={"features": requested},
        )


async def synthesize_tts(
    req: TtsRequest,
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
) -> TtsAudioResult:
    validate_advanced_feature_gates(req.provider, req.advanced_options)
    if req.provider == "openai":
        return await call_openai_tts(req, user_id=user_id, db=db)
    if req.provider == "volcengine":
        return await call_volcengine_tts(req)
    if req.provider == "moss-local":
        return await call_moss_tts(req)
    if req.provider == "mimo":
        return await call_mimo_tts(req, user_id=user_id, db=db)
    raise TtsProviderError("unsupported_provider", f"Unsupported TTS provider: {req.provider}", provider=str(req.provider), status_code=400)


async def probe_openai_speech_capability(
    req: TtsCapabilityProbeRequest,
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
) -> TtsCapabilityProbeResponse:
    if req.provider != "openai":
        return TtsCapabilityProbeResponse(
            ok=False,
            provider=req.provider,
            error_code="unsupported_provider",
            detail="Capability probe is currently implemented for OpenAI-compatible providers only.",
        )
    try:
        config = await resolve_openai_config(user_id=user_id, db=db, ai_provider_id=req.ai_provider_id)
    except TtsProviderError as exc:
        return TtsCapabilityProbeResponse(ok=False, provider="openai", error_code=exc.error_code, detail=exc.message)

    url = f"{config.base_url}/audio/speech"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    payload = {
        "model": req.model or OPENAI_DEFAULT_MODEL,
        "voice": req.voice or OPENAI_DEFAULT_VOICE,
        "input": "tts capability probe",
        "response_format": "mp3",
    }
    client = await get_http_client()
    try:
        response = await client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException:
        return TtsCapabilityProbeResponse(ok=False, provider="openai", endpoint=url, error_code="provider_timeout")
    except httpx.RequestError as exc:
        return TtsCapabilityProbeResponse(ok=False, provider="openai", endpoint=url, error_code="provider_failed", detail=str(exc))

    content_type = (response.headers.get("content-type") or "").split(";")[0].strip()
    if response.status_code >= 400:
        error_code, _status_code, message = _normalize_provider_status("openai", response.status_code)
        return TtsCapabilityProbeResponse(
            ok=False,
            provider="openai",
            endpoint=url,
            model=payload["model"],
            error_code=error_code,
            detail=message,
            status=response.status_code,
            content_type=content_type or None,
        )
    if not content_type.startswith("audio/") or not response.content:
        return TtsCapabilityProbeResponse(
            ok=False,
            provider="openai",
            endpoint=url,
            model=payload["model"],
            error_code="unsupported_endpoint",
            detail="OpenAI-compatible provider did not return audio for /v1/audio/speech.",
            status=response.status_code,
            content_type=content_type or None,
        )
    return TtsCapabilityProbeResponse(
        ok=True,
        provider="openai",
        endpoint=url,
        model=payload["model"],
        status=response.status_code,
        content_type=content_type,
    )


def _job_response(job: ChapterJobState) -> TtsChapterJobResponse:
    percent = 100 if job.status == "completed" else (
        round((job.completed_chunks / job.total_chunks) * 100, 2) if job.total_chunks else 0
    )
    cache_state = "hit" if job.total_chunks and job.cached_chunks == job.total_chunks else ("miss" if job.completed_chunks else "unknown")
    return TtsChapterJobResponse(
        job_id=job.job_id,
        chapter_id=job.chapter_id,
        project_id=job.project_id,
        status=job.status,
        total_chunks=job.total_chunks,
        completed_chunks=job.completed_chunks,
        failed_chunks=job.failed_chunks,
        cached_chunks=job.cached_chunks,
        progress={
            "total_chunks": job.total_chunks,
            "completed_chunks": job.completed_chunks,
            "failed_chunks": job.failed_chunks,
            "percent": percent,
            "current_chapter_id": job.chapter_id,
        },
        audio=job.manifest,
        cache_state=cache_state,
        manifest=job.manifest,
        error_code=job.error_code,
        detail=job.detail,
    )


async def _find_cached_tts_asset(
    *,
    db: AsyncSession,
    user_id: str,
    chapter_id: str,
    fingerprint: str,
) -> MediaAsset | None:
    result = await db.execute(
        select(MediaAsset).where(
            MediaAsset.user_id == user_id,
            MediaAsset.purpose == "tts_audio",
            MediaAsset.status == "active",
            MediaAsset.metadata_json.contains(fingerprint),
            MediaAsset.metadata_json.contains(chapter_id),
        )
    )
    return result.scalars().first()


def _find_cached_local_tts_asset(
    *,
    user_id: str,
    chapter_id: str,
    fingerprint: str,
) -> dict[str, Any] | None:
    for asset_id, asset in _local_audio_assets.items():
        if (
            asset.get("user_id") == user_id
            and asset.get("chapter_id") == chapter_id
            and asset.get("fingerprint") == fingerprint
            and Path(str(asset.get("path") or "")).is_file()
        ):
            return {
                "asset_id": asset_id,
                "storage": "local_file",
                "content_type": asset.get("content_type"),
                "size_bytes": asset.get("size_bytes"),
                "fingerprint": fingerprint,
            }
    return None


async def _create_tts_asset(
    *,
    db: AsyncSession,
    user_id: str,
    project_id: str | None,
    chapter_id: str,
    fingerprint: str,
    chunk_index: int,
    chunk_count: int,
    result: TtsAudioResult,
) -> dict[str, Any]:
    ext = ext_from_content_type(result.content_type)
    filename = f"tts_{chapter_id}_{chunk_index + 1:03d}.{ext}"
    metadata = {
        "chapter_id": chapter_id,
        "fingerprint": fingerprint,
        "provider": result.provider,
        "model": result.model,
        "voice": result.voice,
        "chunk_index": chunk_index,
        "chunk_count": chunk_count,
        "kind": "chunk",
        **result.metadata,
    }
    try:
        created = await media_asset_service.create_asset_from_bytes(
            db=db,
            user_id=user_id,
            project_id=project_id,
            purpose="tts_audio",
            filename=filename,
            content=result.audio_bytes,
            mime_type=result.content_type,
            metadata=metadata,
            commit=False,
            flush=True,
        )
        return {
            "asset_id": created.asset.id,
            "storage": "media_asset",
            "content_type": result.content_type,
            "size_bytes": len(result.audio_bytes),
            "fingerprint": fingerprint,
        }
    except ObjectStorageError:
        asset_id = str(uuid.uuid4())
        root = _local_tts_asset_root()
        target_dir = root / user_id / chapter_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{asset_id}_{filename}"
        target.write_bytes(result.audio_bytes)
        _local_audio_assets[asset_id] = {
            "path": str(target),
            "user_id": user_id,
            "project_id": project_id,
            "chapter_id": chapter_id,
            "filename": filename,
            "content_type": result.content_type,
            "size_bytes": len(result.audio_bytes),
            "fingerprint": fingerprint,
            "metadata": metadata,
        }
        return {
            "asset_id": asset_id,
            "storage": "local_file",
            "content_type": result.content_type,
            "size_bytes": len(result.audio_bytes),
            "fingerprint": fingerprint,
        }


async def generate_chapter_tts(
    *,
    chapter_id: str,
    req: TtsChapterGenerateRequest,
    user_id: str,
    db: AsyncSession,
) -> TtsChapterGenerateEnvelope:
    validate_advanced_feature_gates(req.provider, req.advanced_options)
    chapter = await _get_owned_chapter(db=db, chapter_id=chapter_id, user_id=user_id)
    text = (req.text or chapter.content or "").strip()
    if not text:
        raise TtsProviderError("invalid_request", "Chapter has no content to synthesize", status_code=422)

    _load_local_manifest(user_id=user_id, chapter_id=chapter.id)
    plan: TtsNarrationPlan | None = None
    if req.mode == "ai_multivoice":
        plan = _load_narration_plan(user_id=user_id, chapter_id=chapter.id, plan_id=str(req.plan_id))
        if plan is None:
            raise TtsProviderError("invalid_plan", "TTS narration plan not found", status_code=404)
        units, professional_metadata, fingerprint_text = _build_plan_units(
            plan=plan,
            project_id=chapter.project_id,
            chapter_id=chapter.id,
            req=req,
        )
    else:
        units, professional_metadata, fingerprint_text = _build_single_narrator_units(
            text=text,
            project_id=chapter.project_id,
            chapter_id=chapter.id,
            req=req,
        )
    job = ChapterJobState(
        job_id=str(uuid.uuid4()),
        chapter_id=chapter.id,
        user_id=user_id,
        status="running",
        request=req,
        project_id=chapter.project_id,
        total_chunks=len(units),
    )
    async with _job_lock:
        _chapter_jobs[job.job_id] = job
        if len(_chapter_jobs) > _MAX_CACHED_JOBS:
            oldest_keys = list(_chapter_jobs.keys())[:len(_chapter_jobs) - _MAX_CACHED_JOBS]
            for k in oldest_keys:
                _chapter_jobs.pop(k, None)

    assets: list[dict[str, Any]] = []
    try:
        for chunk in units:
            if job.cancel_requested:
                raise TtsProviderError("generation_cancelled", "Chapter TTS generation was cancelled", provider=req.provider)
            cached: dict[str, Any] | MediaAsset | None = None
            if not req.force:
                cached = await _find_cached_tts_asset(
                    db=db,
                    user_id=user_id,
                    chapter_id=chapter.id,
                    fingerprint=chunk["fingerprint"],
                )
                if cached is None:
                    cached = _find_cached_local_tts_asset(
                        user_id=user_id,
                        chapter_id=chapter.id,
                        fingerprint=chunk["fingerprint"],
                    )
            if isinstance(cached, MediaAsset):
                job.cached_chunks += 1
                job.completed_chunks += 1
                assets.append({
                    "asset_id": cached.id,
                    "storage": "media_asset",
                    "chunk_index": chunk["unit_index"],
                    "source_chunk_index": chunk["index"],
                    "speaker_id": chunk.get("speaker_id"),
                    "display_name": chunk.get("display_name"),
                    "provider": chunk.get("provider") or req.provider,
                    "model": chunk.get("model") or req.model,
                    "voice": chunk.get("voice") or req.voice,
                    "role_voice": chunk.get("role_voice"),
                    "voice_resolution": chunk.get("voice_resolution"),
                    "style": chunk.get("style"),
                    "instructions": chunk.get("instructions"),
                    "text": chunk.get("text"),
                    "cached": True,
                    "download_url": f"/api/tts/chapters/{chapter.id}/download",
                    "url": f"/api/tts/chapters/{chapter.id}/download",
                })
                continue
            if isinstance(cached, dict):
                job.cached_chunks += 1
                job.completed_chunks += 1
                assets.append({
                    **cached,
                    "chunk_index": chunk["unit_index"],
                    "source_chunk_index": chunk["index"],
                    "speaker_id": chunk.get("speaker_id"),
                    "display_name": chunk.get("display_name"),
                    "provider": chunk.get("provider") or req.provider,
                    "model": chunk.get("model") or req.model,
                    "voice": chunk.get("voice") or req.voice,
                    "role_voice": chunk.get("role_voice"),
                    "voice_resolution": chunk.get("voice_resolution"),
                    "style": chunk.get("style"),
                    "instructions": chunk.get("instructions"),
                    "text": chunk.get("text"),
                    "cached": True,
                    "download_url": f"/api/tts/chapters/{chapter.id}/download",
                    "url": f"/api/tts/chapters/{chapter.id}/download",
                })
                continue
            synth_req = TtsRequest(
                text=chunk["text"],
                provider=chunk.get("provider") or req.provider,
                voice=chunk.get("voice") or req.voice,
                model=chunk.get("model") or req.model,
                fmt=req.fmt,
                speed=req.speed,
                instructions=chunk.get("instructions") or req.instructions,
                advanced_options=chunk.get("advanced_options") or req.advanced_options,
                ai_provider_id=req.ai_provider_id,
            )
            result = await synthesize_tts(synth_req, user_id=user_id, db=db)
            asset = await _create_tts_asset(
                db=db,
                user_id=user_id,
                project_id=chapter.project_id,
                chapter_id=chapter.id,
                fingerprint=chunk["fingerprint"],
                chunk_index=chunk["unit_index"],
                chunk_count=len(units),
                result=result,
            )
            await db.commit()
            job.completed_chunks += 1
            _audio_cache[chunk["fingerprint"]] = result
            assets.append({
                **asset,
                "chunk_index": chunk["unit_index"],
                "source_chunk_index": chunk["index"],
                "speaker_id": chunk.get("speaker_id"),
                "display_name": chunk.get("display_name"),
                "provider": result.provider,
                "model": result.model,
                "voice": chunk.get("voice") or req.voice,
                "role_voice": chunk.get("role_voice"),
                "voice_resolution": chunk.get("voice_resolution"),
                "style": chunk.get("style"),
                "instructions": chunk.get("instructions"),
                "text": chunk.get("text"),
                "duration": _wav_duration_seconds(result.audio_bytes),
                "cached": False,
                "download_url": f"/api/tts/chapters/{chapter.id}/download",
                "url": f"/api/tts/chapters/{chapter.id}/download",
            })
    except TtsProviderError as exc:
        await db.rollback()
        job.status = "cancelled" if exc.error_code == "generation_cancelled" else "failed"
        job.failed_chunks = max(0, job.total_chunks - job.completed_chunks)
        job.error_code = exc.error_code
        job.detail = exc.message
        job_response = _job_response(job)
        return TtsChapterGenerateEnvelope(job=job_response, job_id=job.job_id, audio=job_response.audio, cache_state=job_response.cache_state, cached=False)
    except ObjectStorageError as exc:
        await db.rollback()
        job.status = "failed"
        job.failed_chunks = max(0, job.total_chunks - job.completed_chunks)
        job.error_code = "storage_unavailable"
        job.detail = "TTS audio storage is unavailable"
        logger.warning("TTS asset storage failed: %s", exc)
        job_response = _job_response(job)
        return TtsChapterGenerateEnvelope(job=job_response, job_id=job.job_id, audio=job_response.audio, cache_state=job_response.cache_state, cached=False)

    manifest = {
        "chapter_id": chapter.id,
        "project_id": chapter.project_id,
        "provider": req.provider,
        "model": req.model,
        "voice": req.voice,
        "format": req.fmt,
        "speed": req.speed,
        "mode": req.mode,
        "plan_id": plan.plan_id if plan else None,
        "chunk_count": len(units),
        "cache_state": "hit" if assets and all(asset.get("cached") for asset in assets) else "miss",
        "cached": bool(assets and all(asset.get("cached") for asset in assets)),
        "download_url": f"/api/tts/chapters/{chapter.id}/download",
        "url": f"/api/tts/chapters/{chapter.id}/download",
        "chunks": assets,
        "segments": assets,
        "export_urls": {"chapter": f"/api/tts/chapters/{chapter.id}/download"},
        **professional_metadata,
        "fingerprint": synthesis_fingerprint(
            project_id=chapter.project_id,
            chapter_id=chapter.id,
            text=fingerprint_text or text,
            provider=req.provider,
            model=req.model,
            voice=req.voice,
            instructions=req.instructions,
            fmt=req.fmt,
            speed=req.speed,
            extra={"kind": "chapter_manifest", "plan_hash": _plan_hash(plan), "speaker_voices": _speaker_voices_json(req.speaker_voices)},
        ),
    }
    job.status = "completed"
    job.manifest = manifest
    _chapter_manifests[(user_id, chapter.id)] = manifest
    if len(_chapter_manifests) > _MAX_CACHED_MANIFESTS:
        oldest_keys = list(_chapter_manifests.keys())[:len(_chapter_manifests) - _MAX_CACHED_MANIFESTS]
        for k in oldest_keys:
            _chapter_manifests.pop(k, None)
    _persist_local_manifest(user_id=user_id, chapter_id=chapter.id, manifest=manifest)
    job_response = _job_response(job)
    return TtsChapterGenerateEnvelope(
        job=job_response,
        job_id=job.job_id,
        audio=manifest,
        cache_state=manifest["cache_state"],
        cached=manifest["cached"],
    )


async def get_chapter_audio_manifest(*, chapter_id: str, user_id: str) -> TtsChapterAudioResponse:
    manifest = _chapter_manifests.get((user_id, chapter_id))
    if manifest is None:
        manifest = _load_local_manifest(user_id=user_id, chapter_id=chapter_id)
    if manifest is None:
        return TtsChapterAudioResponse(chapter_id=chapter_id, status="missing", audio=None, manifest=None)
    return TtsChapterAudioResponse(chapter_id=chapter_id, status="available", audio=manifest, manifest=manifest)


def get_tts_job(job_id: str, *, user_id: str) -> TtsChapterJobResponse:
    job = _chapter_jobs.get(job_id)
    if job is None or job.user_id != user_id:
        raise TtsProviderError("invalid_request", "TTS job not found", status_code=404)
    return _job_response(job)


def cancel_tts_job(job_id: str, *, user_id: str) -> TtsJobActionResponse:
    job = _chapter_jobs.get(job_id)
    if job is None or job.user_id != user_id:
        raise TtsProviderError("invalid_request", "TTS job not found", status_code=404)
    job.cancel_requested = True
    return TtsJobActionResponse(ok=True, job=_job_response(job))


async def retry_tts_job(job_id: str, *, user_id: str, db: AsyncSession) -> TtsJobActionResponse:
    job = _chapter_jobs.get(job_id)
    if job is None or job.user_id != user_id:
        raise TtsProviderError("invalid_request", "TTS job not found", status_code=404)
    response = await generate_chapter_tts(chapter_id=job.chapter_id, req=job.request, user_id=user_id, db=db)
    return TtsJobActionResponse(ok=True, job=response.job)


async def download_chapter_tts_audio(*, chapter_id: str, user_id: str, db: AsyncSession) -> tuple[bytes, str, str]:
    manifest = _chapter_manifests.get((user_id, chapter_id))
    if not manifest:
        manifest = _load_local_manifest(user_id=user_id, chapter_id=chapter_id)
    if not manifest:
        raise TtsProviderError("invalid_request", "Chapter TTS audio not found", status_code=404)
    chunks = sorted(manifest.get("chunks") or [], key=lambda item: int(item.get("chunk_index") or 0))
    if not chunks:
        raise TtsProviderError("invalid_request", "Chapter TTS audio not found", status_code=404)
    contents: list[bytes] = []
    media_type = "application/octet-stream"
    for item in chunks:
        asset_id = str(item.get("asset_id") or "")
        if item.get("storage") == "local_file":
            local_asset = _local_audio_assets.get(asset_id)
            if not local_asset or local_asset.get("user_id") != user_id:
                raise TtsProviderError("invalid_request", "Chapter TTS audio asset not found", status_code=404)
            path = Path(str(local_asset.get("path") or "")).resolve()
            if not path.is_file():
                raise TtsProviderError("invalid_request", "Chapter TTS audio asset not found", status_code=404)
            media_type = str(local_asset.get("content_type") or media_type)
            contents.append(await asyncio.to_thread(path.read_bytes))
            continue
        asset = await db.get(MediaAsset, asset_id)
        if asset is None or asset.user_id != user_id or asset.status != "active":
            raise TtsProviderError("invalid_request", "Chapter TTS audio asset not found", status_code=404)
        try:
            stored = await object_storage_service.get_object(object_key=asset.object_key)
        except ObjectStorageError as exc:
            raise TtsProviderError(
                "storage_unavailable",
                "TTS audio storage is unavailable",
                status_code=503,
            ) from exc
        media_type = asset.mime_type or stored.content_type or media_type
        contents.append(stored.content)
    content, media_type = await _build_chapter_download_audio(contents, media_type)
    return content, media_type, f"tts_{chapter_id}.{ext_from_content_type(media_type)}"


async def smoke_tts(
    req: TtsSmokeRequest,
    *,
    user_id: str | None = None,
    db: AsyncSession | None = None,
) -> TtsSmokeResponse:
    synth_req = TtsRequest(
        text=req.text,
        provider=req.provider,
        voice=req.voice,
        model=req.model,
        fmt=req.fmt,
        speed=req.speed,
        instructions=req.instructions,
    )
    try:
        result = await synthesize_tts(synth_req, user_id=user_id, db=db)
    except TtsProviderError as exc:
        return TtsSmokeResponse(
            ok=False,
            provider=req.provider,
            error_code=exc.error_code,
            detail=exc.message,
            model=req.model,
            voice=req.voice,
        )
    return TtsSmokeResponse(
        ok=True,
        provider=req.provider,
        content_type=result.content_type,
        audio_size=len(result.audio_bytes),
        model=result.model,
        voice=result.voice,
    )
