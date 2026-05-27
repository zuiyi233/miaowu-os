from __future__ import annotations

import base64
import io
import json
import zipfile
from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.models.tts_studio_workspace import TtsStudioWorkspace
from app.gateway.routers.tts_support.service import (
    TtsGeneratedAudioResponse,
    TtsProviderError,
    TtsVoiceCloneRequest,
    TtsVoiceDesignRequest,
    clone_tts_voice,
    design_tts_voice,
    read_tts_audio_asset,
)

StudioNodeType = Literal[
    "referenceAudio",
    "voiceStyle",
    "prompt",
    "voiceClone",
    "voiceDesign",
    "artifact",
]
MAX_STUDIO_NODES = 100
MAX_STUDIO_EDGES = 200
MAX_STUDIO_STASH_ITEMS = 100
MAX_STUDIO_BOARD_JSON_BYTES = 1_000_000
MAX_STUDIO_NODE_DATA_JSON_BYTES = 32_000
LARGE_NODE_DATA_KEYS = {
    "audio",
    "audio_data",
    "base64",
    "data_url",
    "reference_audio_data_url",
    "referenceAudioDataUrl",
}


class TtsStudioNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=120)
    type: StudioNodeType
    data: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, Any] = Field(default_factory=dict)

    @field_validator("data")
    @classmethod
    def _validate_node_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        for key in LARGE_NODE_DATA_KEYS:
            if key in value:
                raise ValueError(f"node data must store asset references, not inline audio data: {key}")
        encoded = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
        if len(encoded) > MAX_STUDIO_NODE_DATA_JSON_BYTES:
            raise ValueError("node data is too large")
        return value


class TtsStudioEdge(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=160)
    source: str = Field(min_length=1, max_length=120)
    target: str = Field(min_length=1, max_length=120)


class TtsStudioArtifact(BaseModel):
    model_config = ConfigDict(extra="allow")

    asset_id: str = Field(min_length=1, max_length=128)
    url: str | None = None
    download_url: str | None = None
    content_type: str | None = None
    provider: str | None = None
    model: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TtsStudioBoard(BaseModel):
    model_config = ConfigDict(extra="allow")

    version: int = 1
    nodes: list[TtsStudioNode] = Field(default_factory=list)
    edges: list[TtsStudioEdge] = Field(default_factory=list)
    stash: list[TtsStudioArtifact] = Field(default_factory=list)

    @field_validator("nodes")
    @classmethod
    def _validate_nodes(cls, value: list[TtsStudioNode]) -> list[TtsStudioNode]:
        if len(value) > MAX_STUDIO_NODES:
            raise ValueError(f"workspace board supports at most {MAX_STUDIO_NODES} nodes")
        return value

    @field_validator("edges")
    @classmethod
    def _validate_edges(cls, value: list[TtsStudioEdge]) -> list[TtsStudioEdge]:
        if len(value) > MAX_STUDIO_EDGES:
            raise ValueError(f"workspace board supports at most {MAX_STUDIO_EDGES} edges")
        return value

    @field_validator("stash")
    @classmethod
    def _validate_stash(cls, value: list[TtsStudioArtifact]) -> list[TtsStudioArtifact]:
        if len(value) > MAX_STUDIO_STASH_ITEMS:
            raise ValueError(f"workspace board supports at most {MAX_STUDIO_STASH_ITEMS} stashed artifacts")
        return value


class TtsStudioWorkspaceCreate(BaseModel):
    name: str = Field(default="音频工作站", min_length=1, max_length=200)
    board: TtsStudioBoard | None = None


class TtsStudioWorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    board: TtsStudioBoard | None = None


class TtsStudioWorkspaceResponse(BaseModel):
    id: str
    name: str
    board: TtsStudioBoard
    created_at: str | None = None
    updated_at: str | None = None


class TtsStudioWorkspaceListResponse(BaseModel):
    items: list[TtsStudioWorkspaceResponse]


class TtsStudioRunNodeRequest(BaseModel):
    node_id: str = Field(min_length=1, max_length=120)
    board: TtsStudioBoard | None = None


class TtsStudioRunNodeResponse(BaseModel):
    workspace: TtsStudioWorkspaceResponse
    node_id: str
    artifact: TtsStudioArtifact
    diagnostics: list[str] = Field(default_factory=list)


class TtsStudioExportRequest(BaseModel):
    asset_ids: list[str] = Field(default_factory=list)

    @field_validator("asset_ids")
    @classmethod
    def _dedupe_asset_ids(cls, value: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for item in value:
            asset_id = item.strip()
            if asset_id and asset_id not in seen:
                seen.add(asset_id)
                result.append(asset_id)
        return result


def _model_to_response(model: TtsStudioWorkspace) -> TtsStudioWorkspaceResponse:
    try:
        raw_board = json.loads(model.board_json or "{}")
    except json.JSONDecodeError:
        raw_board = {}
    return TtsStudioWorkspaceResponse(
        id=model.id,
        name=model.name,
        board=TtsStudioBoard.model_validate(raw_board),
        created_at=_iso(model.created_at),
        updated_at=_iso(model.updated_at),
    )


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    return None


def _dump_board(board: TtsStudioBoard | None) -> str:
    payload = (board or _default_board()).model_dump_json()
    if len(payload.encode("utf-8")) > MAX_STUDIO_BOARD_JSON_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"error_code": "board_too_large", "message": "TTS studio board is too large"},
        )
    return payload


def _default_board() -> TtsStudioBoard:
    return TtsStudioBoard(
        nodes=[
            TtsStudioNode(id="reference-1", type="referenceAudio", position={"x": 0, "y": 80}, data={"label": "参考音频"}),
            TtsStudioNode(id="style-1", type="voiceStyle", position={"x": 0, "y": 280}, data={"style": "温柔、清晰、有叙事感"}),
            TtsStudioNode(id="prompt-1", type="prompt", position={"x": 360, "y": 80}, data={"text": "你好，这是喵呜音频工作站试听。"}),
            TtsStudioNode(id="clone-1", type="voiceClone", position={"x": 720, "y": 80}, data={"label": "声音克隆", "status": "idle"}),
            TtsStudioNode(id="design-1", type="voiceDesign", position={"x": 720, "y": 300}, data={"voice_description": "年轻、自然、适合小说旁白", "status": "idle"}),
        ],
        edges=[
            TtsStudioEdge(id="reference-1-clone-1", source="reference-1", target="clone-1"),
            TtsStudioEdge(id="style-1-clone-1", source="style-1", target="clone-1"),
            TtsStudioEdge(id="prompt-1-clone-1", source="prompt-1", target="clone-1"),
            TtsStudioEdge(id="prompt-1-design-1", source="prompt-1", target="design-1"),
        ],
    )


async def list_workspaces(*, user_id: str, db: AsyncSession) -> TtsStudioWorkspaceListResponse:
    result = await db.execute(
        select(TtsStudioWorkspace)
        .where(TtsStudioWorkspace.user_id == user_id, TtsStudioWorkspace.status == "active")
        .order_by(TtsStudioWorkspace.updated_at.desc())
    )
    return TtsStudioWorkspaceListResponse(items=[_model_to_response(item) for item in result.scalars().all()])


async def create_workspace(
    *,
    req: TtsStudioWorkspaceCreate,
    user_id: str,
    db: AsyncSession,
) -> TtsStudioWorkspaceResponse:
    workspace = TtsStudioWorkspace(user_id=user_id, name=req.name.strip(), board_json=_dump_board(req.board))
    db.add(workspace)
    await db.commit()
    await db.refresh(workspace)
    return _model_to_response(workspace)


async def get_workspace(*, workspace_id: str, user_id: str, db: AsyncSession) -> TtsStudioWorkspaceResponse:
    return _model_to_response(await _get_owned_workspace(workspace_id=workspace_id, user_id=user_id, db=db))


async def update_workspace(
    *,
    workspace_id: str,
    req: TtsStudioWorkspaceUpdate,
    user_id: str,
    db: AsyncSession,
) -> TtsStudioWorkspaceResponse:
    workspace = await _get_owned_workspace(workspace_id=workspace_id, user_id=user_id, db=db)
    if req.name is not None:
        workspace.name = req.name.strip()
    if req.board is not None:
        workspace.board_json = _dump_board(req.board)
    await db.commit()
    await db.refresh(workspace)
    return _model_to_response(workspace)


async def delete_workspace(*, workspace_id: str, user_id: str, db: AsyncSession) -> dict[str, Any]:
    workspace = await _get_owned_workspace(workspace_id=workspace_id, user_id=user_id, db=db)
    workspace.status = "deleted"
    await db.commit()
    return {"success": True, "id": workspace_id}


async def run_workspace_node(
    *,
    workspace_id: str,
    req: TtsStudioRunNodeRequest,
    user_id: str,
    db: AsyncSession,
) -> TtsStudioRunNodeResponse:
    workspace = await _get_owned_workspace(workspace_id=workspace_id, user_id=user_id, db=db)
    board = req.board or TtsStudioBoard.model_validate(json.loads(workspace.board_json or "{}"))
    node = _find_node(board, req.node_id)
    if node.type not in {"voiceClone", "voiceDesign"}:
        raise HTTPException(status_code=400, detail={"error_code": "unsupported_node", "message": "Only voice clone/design nodes can be run"})

    artifact_response = await _run_generation_node(node=node, board=board, user_id=user_id, db=db)
    artifact = TtsStudioArtifact.model_validate(artifact_response.model_dump())
    _apply_artifact_to_board(board=board, source_node=node, artifact=artifact)
    workspace.board_json = _dump_board(board)
    await db.commit()
    await db.refresh(workspace)
    return TtsStudioRunNodeResponse(
        workspace=_model_to_response(workspace),
        node_id=node.id,
        artifact=artifact,
        diagnostics=artifact_response.diagnostics,
    )


async def build_export_zip(
    *,
    workspace_id: str,
    req: TtsStudioExportRequest,
    user_id: str,
    db: AsyncSession,
) -> tuple[bytes, str, str]:
    workspace = await _get_owned_workspace(workspace_id=workspace_id, user_id=user_id, db=db)
    board = TtsStudioBoard.model_validate(json.loads(workspace.board_json or "{}"))
    asset_ids = req.asset_ids or [item.asset_id for item in board.stash]
    if not asset_ids:
        raise HTTPException(status_code=400, detail={"error_code": "no_assets", "message": "No stashed artifacts to export"})

    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        manifest: list[dict[str, Any]] = []
        for index, asset_id in enumerate(asset_ids, start=1):
            try:
                content, content_type, filename = await read_tts_audio_asset(asset_id=asset_id, user_id=user_id, db=db)
            except TtsProviderError as exc:
                raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc
            safe_name = filename.replace("\\", "/").split("/")[-1] or f"audio-{index}.bin"
            archive.writestr(f"{index:02d}-{safe_name}", content)
            manifest.append({"asset_id": asset_id, "filename": safe_name, "content_type": content_type, "size_bytes": len(content)})
        archive.writestr("manifest.json", json.dumps({"workspace_id": workspace.id, "assets": manifest}, ensure_ascii=False, indent=2))
    return output.getvalue(), "application/zip", f"tts-studio-{workspace.id}.zip"


async def _get_owned_workspace(*, workspace_id: str, user_id: str, db: AsyncSession) -> TtsStudioWorkspace:
    result = await db.execute(
        select(TtsStudioWorkspace).where(
            TtsStudioWorkspace.id == workspace_id,
            TtsStudioWorkspace.user_id == user_id,
            TtsStudioWorkspace.status == "active",
        )
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="TTS studio workspace not found")
    return workspace


def _find_node(board: TtsStudioBoard, node_id: str) -> TtsStudioNode:
    for node in board.nodes:
        if node.id == node_id:
            return node
    raise HTTPException(status_code=404, detail="TTS studio node not found")


def _input_nodes(board: TtsStudioBoard, target_node_id: str) -> list[TtsStudioNode]:
    source_ids = {edge.source for edge in board.edges if edge.target == target_node_id}
    return [node for node in board.nodes if node.id in source_ids]


def _first_input_data(board: TtsStudioBoard, target_node_id: str, node_type: StudioNodeType, key: str) -> str | None:
    for node in _input_nodes(board, target_node_id):
        if node.type == node_type:
            for candidate in (key, f"{key}_text"):
                value = node.data.get(candidate)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


async def _run_generation_node(
    *,
    node: TtsStudioNode,
    board: TtsStudioBoard,
    user_id: str,
    db: AsyncSession,
) -> TtsGeneratedAudioResponse:
    text = _node_text(node) or _first_input_data(board, node.id, "prompt", "text") or "你好，这是喵呜音频工作站试听。"
    model = _node_string(node, "model")
    fmt = _node_string(node, "fmt") or "mp3"
    ai_provider_id = _node_string(node, "ai_provider_id")
    if node.type == "voiceDesign":
        description = _node_string(node, "voice_description") or _first_input_data(board, node.id, "voiceStyle", "style")
        if not description:
            raise HTTPException(status_code=422, detail={"error_code": "missing_voice_description", "message": "Voice design requires a description"})
        try:
            return await design_tts_voice(
                TtsVoiceDesignRequest(
                    voice_description=description,
                    text=text,
                    instruction=_node_string(node, "instruction"),
                    model=model,
                    fmt=fmt,
                    ai_provider_id=ai_provider_id,
                ),
                user_id=user_id,
                db=db,
            )
        except TtsProviderError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc

    reference_asset_id = _node_string(node, "reference_audio_asset_id") or _first_input_data(board, node.id, "referenceAudio", "asset_id")
    if not reference_asset_id:
        raise HTTPException(status_code=422, detail={"error_code": "missing_reference_audio", "message": "Voice clone requires a reference audio asset"})
    reference_data_url = await _reference_audio_data_url(reference_asset_id=reference_asset_id, user_id=user_id, db=db)
    try:
        return await clone_tts_voice(
            TtsVoiceCloneRequest(
                text=text,
                reference_audio_data_url=reference_data_url,
                instruction=_node_string(node, "instruction"),
                style=_node_string(node, "style") or _node_string(node, "style_text") or _first_input_data(board, node.id, "voiceStyle", "style"),
                model=model,
                fmt=fmt,
                ai_provider_id=ai_provider_id,
            ),
            user_id=user_id,
            db=db,
        )
    except TtsProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc


async def _reference_audio_data_url(*, reference_asset_id: str, user_id: str, db: AsyncSession) -> str:
    try:
        audio_bytes, content_type, _filename = await read_tts_audio_asset(asset_id=reference_asset_id, user_id=user_id, db=db)
        return f"data:{content_type};base64,{base64.b64encode(audio_bytes).decode('ascii')}"
    except TtsProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc


def _node_string(node: TtsStudioNode, key: str) -> str | None:
    value = node.data.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _node_text(node: TtsStudioNode) -> str | None:
    return _node_string(node, "text") or _node_string(node, "prompt")


def _apply_artifact_to_board(*, board: TtsStudioBoard, source_node: TtsStudioNode, artifact: TtsStudioArtifact) -> None:
    source_node.data = {**source_node.data, "status": "completed", "artifact": artifact.model_dump()}
    artifact_node = TtsStudioNode(
        id=f"artifact-{artifact.asset_id}",
        type="artifact",
        position={
            "x": float(source_node.position.get("x") or 0) + 360,
            "y": float(source_node.position.get("y") or 0),
        },
        data={"label": "生成音频", **artifact.model_dump()},
    )
    board.nodes = [node for node in board.nodes if node.id != artifact_node.id] + [artifact_node]
    board.edges = [
        edge for edge in board.edges if edge.id != f"{source_node.id}-{artifact_node.id}"
    ] + [TtsStudioEdge(id=f"{source_node.id}-{artifact_node.id}", source=source_node.id, target=artifact_node.id)]
    existing = {item.asset_id: item for item in board.stash}
    existing[artifact.asset_id] = artifact
    board.stash = list(existing.values())
