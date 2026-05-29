"""Offline script: build writing_skill_index.json from ai_creator builtin-skills.

Usage:
    python -m scripts.build_writing_skill_index [--source DIR] [--output DIR]

Reads all .md skill files from the source directory, extracts structured
metadata, maps tags to categories, and writes a pre-built index JSON plus
standardised skill files into the output directory.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

import yaml

TAG_TO_CATEGORY: dict[str, str] = {
    "角色": "角色",
    "人设": "角色",
    "弧线": "角色",
    "反派": "角色",
    "主角": "角色",
    "配角": "角色",
    "CP": "情感",
    "感情": "情感",
    "推拉": "情感",
    "虐心": "情感",
    "甜": "情感",
    "暧昧": "情感",
    "章节": "节奏",
    "节奏": "节奏",
    "场景": "节奏",
    "切场": "节奏",
    "结构": "长篇结构",
    "大纲": "长篇结构",
    "卷": "长篇结构",
    "多线": "长篇结构",
    "情节": "情节",
    "矛盾": "情节",
    "转折": "情节",
    "高潮": "情节",
    "冲突": "情节",
    "开篇": "开篇",
    "钩子": "开篇",
    "开局": "开篇",
    "黄金三章": "开篇",
    "爽点": "爽点",
    "打脸": "爽点",
    "逆袭": "爽点",
    "装逼": "爽点",
    "金手指": "爽点",
    "伏笔": "伏笔",
    "悬念": "伏笔",
    "埋线": "伏笔",
    "回收": "伏笔",
    "文风": "文风",
    "语言": "文风",
    "叙事": "文风",
    "视角": "文风",
    "描写": "文风",
    "世界观": "世界观",
    "设定": "世界观",
    "体系": "世界观",
    "规则": "世界观",
    "对话": "对话",
    "台词": "对话",
    "潜台词": "对话",
    "群戏": "对话",
    "修稿": "修稿",
    "精修": "修稿",
    "删改": "修稿",
    "一致性": "修稿",
    "职业": "职业线",
    "行业": "职业线",
    "职场": "职业线",
    "升级": "职业线",
}

_APPLICABLE_SECTION_RE = re.compile(
    r"^##\s*适用情况\s*\n(.*?)(?=\n##\s|\Z)",
    re.DOTALL | re.IGNORECASE,
)

_CN_PUNCTUATION = str.maketrans(
    "，。！？；：、""''（）【】《》—…",
    ",.!?;:,'\"()[]<>-.",
)

_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _extract_routing_hints(content: str) -> str:
    m = _APPLICABLE_SECTION_RE.search(content)
    if not m:
        return ""
    text = m.group(1).strip()
    lines = [l.strip().lstrip("-•–— ").strip() for l in text.splitlines() if l.strip()]
    hints = "; ".join(lines[:3])
    if len(hints) > 200:
        hints = hints[:197] + "..."
    return hints


def _extract_keywords(name: str, description: str, tags: list[str], content_body: str) -> list[str]:
    parts = [name, description, " ".join(tags), content_body[:500]]
    combined = " ".join(parts)
    combined = combined.translate(_CN_PUNCTUATION)
    tokens = re.findall(r"[\u4e00-\u9fff]{2,4}|[a-zA-Z]{2,}", combined)
    seen: set[str] = set()
    result: list[str] = []
    for t in tokens:
        low = t.lower()
        if low not in seen:
            seen.add(low)
            result.append(low)
    return result[:20]


def _map_category(tags: list[str]) -> str:
    for tag in tags:
        cat = TAG_TO_CATEGORY.get(tag)
        if cat:
            return cat
    return "综合"


def _content_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


_STEPS_RE = re.compile(r"^##?\s*步骤\s*\n(.*?)(?=\n##\s|\Z)", re.DOTALL | re.IGNORECASE)
_EXAMPLE_RE = re.compile(r"^##?\s*(?:快速)?示例\s*\n(.*?)(?=\n##\s|\Z)", re.DOTALL | re.IGNORECASE)
_NOTE_RE = re.compile(r"^##?\s*注意\s*\n(.*?)(?=\n##\s|\Z)", re.DOTALL | re.IGNORECASE)


def _compute_quality_score(body: str, tags: list[str], routing_hints: str) -> float:
    score = 5.0

    has_steps = bool(_STEPS_RE.search(body))
    has_example = bool(_EXAMPLE_RE.search(body))
    has_note = bool(_NOTE_RE.search(body))
    step_count = body.count("步骤") + len(re.findall(r"^\d+\.\s", body, re.MULTILINE))

    if has_steps:
        score += 1.0
    if step_count >= 5:
        score += 0.5
    if step_count >= 8:
        score += 0.5
    if has_example:
        score += 1.0
    if has_note:
        score += 0.5

    if len(tags) >= 3:
        score += 0.5
    if len(tags) >= 5:
        score += 0.5

    if routing_hints:
        score += 0.5

    body_len = len(body)
    if body_len < 200:
        score -= 1.0
    elif body_len < 500:
        score -= 0.5
    elif body_len >= 2000:
        score += 0.5

    return max(1.0, min(10.0, score))


def parse_skill_file(md_path: Path) -> dict | None:
    try:
        raw = md_path.read_text(encoding="utf-8")
    except Exception:
        return None

    fm_match = re.match(r"^---\s*\n(.*?)\n---\s*\n", raw, re.DOTALL)
    if not fm_match:
        return None

    try:
        meta = yaml.safe_load(fm_match.group(1))
    except yaml.YAMLError:
        return None

    if not isinstance(meta, dict):
        return None

    slug = meta.get("slug") or md_path.stem
    name = meta.get("name", "")
    description = meta.get("description", "")
    tags = meta.get("tags", [])

    if not isinstance(tags, list):
        tags = []
    tags = [str(t) for t in tags if t]

    if not name or not description:
        return None

    slug = str(slug).strip().lower()
    if not _SLUG_PATTERN.fullmatch(slug):
        return None

    body = raw[fm_match.end():]
    routing_hints = _extract_routing_hints(raw)
    keywords = _extract_keywords(str(name), str(description), tags, body)
    category = _map_category(tags)
    version_hash = _content_hash(raw)
    quality_score = _compute_quality_score(body, tags, routing_hints)

    return {
        "slug": slug,
        "name": str(name).strip(),
        "description": str(description).strip(),
        "category": category,
        "tags": tags,
        "keywords": keywords,
        "routing_hints": routing_hints,
        "source": "ai_creator_builtin",
        "version_hash": version_hash,
        "content_path": f"writing-skills/{slug}.md",
        "quality_score": round(quality_score, 1),
    }


def build_index(source_dir: Path, output_dir: Path) -> dict:
    source_dir = source_dir.resolve()
    output_dir = output_dir.resolve()

    skills_dir = output_dir / "writing-skills"
    skills_dir.mkdir(parents=True, exist_ok=True)

    md_files = sorted(source_dir.glob("*.md"))
    print(f"Found {len(md_files)} .md files in {source_dir}")

    entries: list[dict] = []
    slug_set: set[str] = set()
    skipped = 0

    for md_path in md_files:
        entry = parse_skill_file(md_path)
        if entry is None:
            skipped += 1
            continue

        slug = entry["slug"]
        if slug in slug_set:
            print(f"  WARNING: duplicate slug '{slug}', skipping {md_path.name}")
            skipped += 1
            continue
        slug_set.add(slug)

        dest = skills_dir / f"{slug}.md"
        try:
            dest.write_text(md_path.read_text(encoding="utf-8"), encoding="utf-8")
        except Exception as exc:
            print(f"  WARNING: failed to copy {md_path.name}: {exc}")
            skipped += 1
            continue

        entries.append(entry)

    categories: dict[str, dict] = {}
    for e in entries:
        cat = e["category"]
        if cat not in categories:
            categories[cat] = {"count": 0, "slugs": []}
        categories[cat]["count"] += 1
        categories[cat]["slugs"].append(e["slug"])

    for cat_info in categories.values():
        cat_info.pop("slugs", None)

    combined = json.dumps(entries, ensure_ascii=False, sort_keys=True)
    content_hash = _content_hash(combined)

    index = {
        "version": 1,
        "built_at": datetime.now(UTC).isoformat(),
        "total_skills": len(entries),
        "skipped": skipped,
        "content_hash": content_hash,
        "categories": categories,
        "skills": entries,
    }

    index_path = output_dir / "writing_skill_index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"Index written: {index_path}")
    print(f"  Total: {len(entries)}, Skipped: {skipped}")
    cat_summary = ", ".join(f"{k}({v['count']})" for k, v in sorted(categories.items()))
    print(f"  Categories: {cat_summary}")

    return index


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build writing skill index from ai_creator builtin-skills")
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "技能" / "ai_creator-main" / "apps" / "server" / "builtin-skills",
        help="Source directory containing .md skill files",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "backend" / "data",
        help="Output directory for index and skill files",
    )
    args = parser.parse_args()

    if not args.source.is_dir():
        print(f"ERROR: source directory not found: {args.source}")
        sys.exit(1)

    build_index(args.source, args.output)


if __name__ == "__main__":
    main()
