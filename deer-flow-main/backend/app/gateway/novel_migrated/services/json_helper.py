"""JSON清洗/解析工具服务"""
from __future__ import annotations

import json
import re
from typing import Any

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.ai_service import AIService

logger = get_logger(__name__)


class JSONHelper:

    @staticmethod
    def clean_and_parse(text: str) -> Any:
        if not text or not text.strip():
            raise ValueError("Empty text provided")

        cleaned = AIService.clean_json_response(text)
        cleaned = JSONHelper._fix_common_issues(cleaned)

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        json_objects = JSONHelper._extract_json_objects(cleaned)
        if json_objects:
            return json_objects[0] if len(json_objects) == 1 else json_objects

        json_arrays = JSONHelper._extract_json_arrays(cleaned)
        if json_arrays:
            return json_arrays[0] if len(json_arrays) == 1 else json_arrays

        fixed = JSONHelper._aggressive_fix(cleaned)
        try:
            return json.loads(fixed)
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse failed after all attempts: {e}")
            raise ValueError(f"Failed to parse JSON: {str(e)}")

    @staticmethod
    def _strip_markdown(text: str) -> str:
        text = re.sub(r'```json\s*', '', text)
        text = re.sub(r'```\s*', '', text)
        text = re.sub(r'`([^`]+)`', r'\1', text)
        return text.strip()

    @staticmethod
    def _strip_code_block(text: str) -> str:
        text = re.sub(r'^\s*```[\w]*\s*\n?', '', text)
        text = re.sub(r'\n?\s*```\s*$', '', text)
        return text.strip()

    @staticmethod
    def _fix_common_issues(text: str) -> str:
        text = re.sub(r',\s*([}\]])', r'\1', text)
        text = re.sub(r'[\x00-\x1f\x7f]', '', text)
        text = text.replace('\u201c', '"').replace('\u201d', '"')
        text = text.replace('\u2018', "'").replace('\u2019', "'")
        return text

    @staticmethod
    def _extract_json_objects(text: str) -> list[dict[str, Any]]:
        objects = []
        depth = 0
        start = -1
        for i, c in enumerate(text):
            if c == '{':
                if depth == 0:
                    start = i
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0 and start >= 0:
                    try:
                        obj = json.loads(text[start:i + 1])
                        objects.append(obj)
                    except json.JSONDecodeError:
                        pass
                    start = -1
        return objects

    @staticmethod
    def _extract_json_arrays(text: str) -> list[list[Any]]:
        arrays = []
        depth = 0
        start = -1
        for i, c in enumerate(text):
            if c == '[':
                if depth == 0:
                    start = i
                depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0 and start >= 0:
                    try:
                        arr = json.loads(text[start:i + 1])
                        arrays.append(arr)
                    except json.JSONDecodeError:
                        pass
                    start = -1
        return arrays

    @staticmethod
    def _aggressive_fix(text: str) -> str:
        text = re.sub(r'//.*?\n', '\n', text)
        text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
        text = re.sub(r'(\w+)\s*:', r'"\1":', text)
        text = re.sub(r':\s*([^",\[\]{}\s:]+)(\s*[,}\]])', r': "\1"\2', text)
        return text

    @staticmethod
    def safe_parse(text: str, default: Any = None) -> Any:
        try:
            return JSONHelper.clean_and_parse(text)
        except (ValueError, json.JSONDecodeError):
            return default


_json_helper = None

def get_json_helper() -> JSONHelper:
    global _json_helper
    if _json_helper is None:
        _json_helper = JSONHelper()
    return _json_helper
