"""更新日志 API

提供 GitHub 提交历史的缓存和代理服务。
适配 deer-flow 项目，使用可配置的仓库信息。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/changelog", tags=["更新日志"])

# GitHub API 配置（可通过环境变量或配置覆盖）
GITHUB_API_BASE = "https://api.github.com"
DEFAULT_REPO_OWNER = "xiamuceer-j"
DEFAULT_REPO_NAME = "MuMuAINovel"

# 缓存配置
_cache = {
    "data": None,
    "timestamp": None,
    "ttl": timedelta(hours=1),  # 缓存1小时
}


def _get_repo_config() -> tuple:
    """
    获取仓库配置

    优先从配置模块读取，否则使用默认值
    """
    try:
        import importlib

        config_module = importlib.import_module("app.gateway.novel_migrated.core.config")
        owner = getattr(config_module, "GITHUB_REPO_OWNER", DEFAULT_REPO_OWNER)
        name = getattr(config_module, "GITHUB_REPO_NAME", DEFAULT_REPO_NAME)
        return owner, name
    except ImportError:
        logger.warning("无法导入配置模块，使用默认 GitHub 仓库配置")
        return DEFAULT_REPO_OWNER, DEFAULT_REPO_NAME


# ==================== 响应模型 ====================


class GitHubAuthor(BaseModel):
    """GitHub 作者信息"""

    name: str
    email: str
    date: str


class GitHubCommitInfo(BaseModel):
    """GitHub 提交信息"""

    author: GitHubAuthor
    message: str


class GitHubUser(BaseModel):
    """GitHub 用户信息"""

    login: str
    avatar_url: str


class GitHubCommit(BaseModel):
    """GitHub 提交数据"""

    sha: str
    commit: GitHubCommitInfo
    html_url: str
    author: GitHubUser | None = None


class ChangelogResponse(BaseModel):
    """更新日志响应"""

    commits: list[GitHubCommit]
    cached: bool
    cache_time: str | None = None


# ==================== 辅助函数 ====================


def is_cache_valid() -> bool:
    """检查缓存是否有效"""
    if _cache["data"] is None or _cache["timestamp"] is None:
        return False

    now = datetime.now()
    cache_age = now - _cache["timestamp"]

    return cache_age < _cache["ttl"]


async def fetch_github_commits(page: int = 1, per_page: int = 30) -> list[dict]:
    """
    从 GitHub API 获取提交历史

    Args:
        page: 页码
        per_page: 每页数量

    Returns:
        提交数据列表
    """
    repo_owner, repo_name = _get_repo_config()
    url = f"{GITHUB_API_BASE}/repos/{repo_owner}/{repo_name}/commits"
    params = {
        "author": repo_owner,
        "page": page,
        "per_page": per_page,
    }

    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "DeerFlow-Novels-App",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, params=params, headers=headers)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        logger.error(f"GitHub API 请求失败: {str(e)}")
        raise HTTPException(status_code=502, detail=f"获取 GitHub 提交历史失败: {str(e)}")


# ==================== API 端点 ====================


@router.get("/changelog", response_model=ChangelogResponse)
async def get_changelog(
    page: int = Query(1, ge=1, description="页码"),
    per_page: int = Query(30, ge=1, le=100, description="每页数量"),
):
    """
    获取更新日志

    从 GitHub 获取项目的提交历史，支持缓存以减少 API 调用。

    - **page**: 页码，从 1 开始
    - **per_page**: 每页返回的提交数量，最大 100
    """
    try:
        # 只缓存第一页
        if page == 1 and is_cache_valid():
            logger.info("使用缓存的更新日志")
            return ChangelogResponse(
                commits=_cache["data"],
                cached=True,
                cache_time=_cache["timestamp"].isoformat(),
            )

        # 从 GitHub 获取数据
        logger.info(f"从 GitHub 获取更新日志 (page={page}, per_page={per_page})")
        commits_data = await fetch_github_commits(page, per_page)

        # 解析数据
        commits = []
        for commit_data in commits_data:
            try:
                commit = GitHubCommit(
                    sha=commit_data["sha"],
                    commit=GitHubCommitInfo(
                        author=GitHubAuthor(
                            name=commit_data["commit"]["author"]["name"],
                            email=commit_data["commit"]["author"]["email"],
                            date=commit_data["commit"]["author"]["date"],
                        ),
                        message=commit_data["commit"]["message"],
                    ),
                    html_url=commit_data["html_url"],
                    author=(
                        GitHubUser(
                            login=commit_data["author"]["login"],
                            avatar_url=commit_data["author"]["avatar_url"],
                        )
                        if commit_data.get("author")
                        else None
                    ),
                )
                commits.append(commit)
            except (KeyError, TypeError) as e:
                logger.warning(f"解析提交数据失败: {str(e)}")
                continue

        # 缓存第一页数据
        if page == 1:
            _cache["data"] = commits
            _cache["timestamp"] = datetime.now()
            logger.info("已缓存更新日志")

        return ChangelogResponse(commits=commits, cached=False, cache_time=None)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取更新日志时发生错误: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取更新日志失败: {str(e)}")


@router.post("/changelog/refresh")
async def refresh_changelog():
    """
    刷新更新日志缓存

    强制从 GitHub 重新获取最新的提交历史
    """
    try:
        logger.info("刷新更新日志缓存")

        # 清除缓存
        _cache["data"] = None
        _cache["timestamp"] = None

        # 重新获取
        commits_data = await fetch_github_commits(1, 30)

        # 解析数据
        commits = []
        for commit_data in commits_data:
            try:
                commit = GitHubCommit(
                    sha=commit_data["sha"],
                    commit=GitHubCommitInfo(
                        author=GitHubAuthor(
                            name=commit_data["commit"]["author"]["name"],
                            email=commit_data["commit"]["author"]["email"],
                            date=commit_data["commit"]["author"]["date"],
                        ),
                        message=commit_data["commit"]["message"],
                    ),
                    html_url=commit_data["html_url"],
                    author=(
                        GitHubUser(
                            login=commit_data["author"]["login"],
                            avatar_url=commit_data["author"]["avatar_url"],
                        )
                        if commit_data.get("author")
                        else None
                    ),
                )
                commits.append(commit)
            except (KeyError, TypeError) as e:
                logger.warning(f"解析提交数据失败: {str(e)}")
                continue

        # 更新缓存
        _cache["data"] = commits
        _cache["timestamp"] = datetime.now()

        return {
            "success": True,
            "message": "缓存已刷新",
            "commit_count": len(commits),
            "cache_time": _cache["timestamp"].isoformat(),
        }

    except Exception as e:
        logger.error(f"刷新缓存时发生错误: {str(e)}")
        raise HTTPException(status_code=500, detail=f"刷新缓存失败: {str(e)}")
