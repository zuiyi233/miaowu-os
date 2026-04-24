"""AI使用统计服务 - 支持内存缓存 + 数据库持久化"""

from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, delete, select

from app.gateway.novel_migrated.core.database import AsyncSessionLocal
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.ai_metric import AIMetric

logger = get_logger(__name__)

_in_memory_stats: dict[str, list[dict[str, Any]]] = {}
_pending_writes: list[dict[str, Any]] = []
_write_lock = threading.Lock()
_flush_interval = 300  # 5分钟自动刷新一次
_max_pending_writes = 100  # 最大待写入条数
_last_flush_time = 0.0
_max_flush_retries = 3
_flush_task: asyncio.Task[None] | None = None


def _record_in_memory_and_queue(record: dict[str, Any], timestamp_seconds: float) -> bool:
    """Thread-safe state update used by sync call paths."""
    global _last_flush_time

    user_id = str(record["user_id"])
    with _write_lock:
        if user_id not in _in_memory_stats:
            _in_memory_stats[user_id] = []

        _in_memory_stats[user_id].append(record)

        # 内存限制：保留最近500条
        if len(_in_memory_stats[user_id]) > 1000:
            _in_memory_stats[user_id] = _in_memory_stats[user_id][-500:]

        _pending_writes.append(record)
        return len(_pending_writes) >= _max_pending_writes or (timestamp_seconds - _last_flush_time) > _flush_interval


def _drain_pending_batch(flush_timestamp: float) -> list[dict[str, Any]]:
    """Thread-safe pending queue drain for async flush."""
    global _last_flush_time

    with _write_lock:
        if not _pending_writes:
            return []
        batch = _pending_writes.copy()
        _pending_writes.clear()
        _last_flush_time = flush_timestamp
        return batch


def _requeue_failed_batch(batch: list[dict[str, Any]]) -> tuple[int, int]:
    """Thread-safe bounded retry requeue."""
    with _write_lock:
        retryable: list[dict[str, Any]] = []
        dropped = 0
        for record in batch:
            retry_count = int(record.get("_flush_retry_count", 0)) + 1
            if retry_count > _max_flush_retries:
                dropped += 1
                continue
            record["_flush_retry_count"] = retry_count
            retryable.append(record)
        if retryable:
            _pending_writes.extend(retryable)
        return len(retryable), dropped


class AIMetricsService:
    """AI使用统计服务 - 双层存储（内存 + 数据库）"""

    def record_usage(self, user_id: str, provider: str, model: str, prompt_tokens: int = 0, completion_tokens: int = 0, operation_type: str = "generation", success: bool = True):
        """
        记录AI使用统计

        策略：
        1. 立即写入内存缓存（保证快速响应）
        2. 加入待写入队列（异步批量写入数据库）
        """
        timestamp = datetime.now()
        record = {
            "timestamp": timestamp.isoformat(),
            "provider": provider,
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
            "operation_type": operation_type,
            "success": success,
            "user_id": user_id,
            "_flush_retry_count": 0,
        }

        should_flush = _record_in_memory_and_queue(record, timestamp.timestamp())

        if should_flush:
            self._schedule_flush()

    def _schedule_flush(self) -> None:
        """Schedule one in-flight async flush task at most."""
        global _flush_task
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # Best effort: caller may be in sync context without running loop.
            return

        if _flush_task is not None and not _flush_task.done():
            return
        _flush_task = loop.create_task(self._flush_to_db_async())

    async def _flush_to_db_async(self):
        """异步批量写入数据库"""
        global _flush_task

        batch = await asyncio.to_thread(_drain_pending_batch, datetime.now().timestamp())
        if not batch:
            return

        try:
            async with AsyncSessionLocal() as session:
                for record in batch:
                    metric = AIMetric(
                        user_id=record["user_id"],
                        provider=record["provider"],
                        model=record["model"],
                        prompt_tokens=record["prompt_tokens"],
                        completion_tokens=record["completion_tokens"],
                        total_tokens=record["total_tokens"],
                        operation_type=record["operation_type"],
                        success=record["success"],
                    )
                    session.add(metric)

                await session.commit()
                logger.info("✅ 已持久化 %s 条AI使用记录到数据库", len(batch))

        except Exception as e:
            logger.error("❌ AI统计数据持久化失败: %s", e, exc_info=True)
            retry_count, dropped = await asyncio.to_thread(_requeue_failed_batch, batch)
            if retry_count:
                logger.warning("⚠️ 回收 %s 条AI统计记录等待重试", retry_count)
            if dropped:
                logger.error("❌ 丢弃 %s 条AI统计写入记录（超过最大重试 %s 次）", dropped, _max_flush_retries)
        finally:
            _flush_task = None

    async def get_user_stats(self, user_id: str, days: int = 30) -> dict[str, Any]:
        """
        获取用户AI使用统计

        策略：
        1. 优先从内存读取（快速响应）
        2. 如果内存数据不足，从数据库加载历史数据
        """
        records = _in_memory_stats.get(user_id, [])
        cutoff = datetime.now() - timedelta(days=days)

        recent_from_memory = [r for r in records if datetime.fromisoformat(r["timestamp"]) >= cutoff]

        need_db_fallback = len(recent_from_memory) < 10 and days > 7

        all_records = recent_from_memory

        if need_db_fallback or not all_records:
            db_records = await self._load_from_db(user_id, days)
            # 合并去重（以内存数据为准，避免同一timestamp的重复记录）
            memory_timestamps = {r["timestamp"] for r in recent_from_memory}
            merged = [r for r in db_records if r.get("timestamp") not in memory_timestamps]
            all_records = merged + recent_from_memory

        return self._calculate_stats(all_records, days)

    async def _load_from_db(self, user_id: str, days: int) -> list[dict[str, Any]]:
        """从数据库加载历史统计"""
        try:
            cutoff = datetime.now() - timedelta(days=days)

            async with AsyncSessionLocal() as session:
                result = await session.execute(select(AIMetric).where(and_(AIMetric.user_id == user_id, AIMetric.created_at >= cutoff)).order_by(AIMetric.created_at.desc()))
                metrics = result.scalars().all()

                records = [
                    {
                        "timestamp": m.created_at.isoformat() if m.created_at else datetime.now().isoformat(),
                        "provider": m.provider,
                        "model": m.model,
                        "prompt_tokens": m.prompt_tokens or 0,
                        "completion_tokens": m.completion_tokens or 0,
                        "total_tokens": m.total_tokens or 0,
                        "operation_type": m.operation_type or "generation",
                        "success": m.success if m.success is not None else True,
                    }
                    for m in metrics
                ]

                logger.info("📊 从数据库加载 %s 条历史记录 (user=%s, days=%s)", len(records), user_id, days)
                return records

        except Exception as e:
            logger.error("❌ 从数据库加载AI统计失败: %s", e, exc_info=True)
            return []

    def _calculate_stats(self, records: list[dict], days: int) -> dict[str, Any]:
        """计算统计数据"""
        if not records:
            return {"total_calls": 0, "total_tokens": 0, "period_days": days}

        total_calls = len(records)
        total_tokens = sum(r["total_tokens"] for r in records)
        total_prompt = sum(r["prompt_tokens"] for r in records)
        total_completion = sum(r["completion_tokens"] for r in records)
        success_rate = sum(1 for r in records if r["success"]) / total_calls * 100

        by_provider = {}
        for r in records:
            p = r["provider"]
            if p not in by_provider:
                by_provider[p] = {"calls": 0, "tokens": 0}
            by_provider[p]["calls"] += 1
            by_provider[p]["tokens"] += r["total_tokens"]

        by_operation = {}
        for r in records:
            op = r["operation_type"]
            if op not in by_operation:
                by_operation[op] = {"calls": 0, "tokens": 0}
            by_operation[op]["calls"] += 1
            by_operation[op]["tokens"] += r["total_tokens"]

        return {
            "total_calls": total_calls,
            "total_tokens": total_tokens,
            "total_prompt_tokens": total_prompt,
            "total_completion_tokens": total_completion,
            "success_rate": round(success_rate, 2),
            "by_provider": by_provider,
            "by_operation": by_operation,
            "period_days": days,
            "data_source": "memory+database" if records else "none",
        }

    async def force_flush(self):
        """强制刷新所有待写入数据到数据库"""
        await self._flush_to_db_async()

    async def cleanup_old_records(self, days: int = 90):
        """清理超过指定天数的历史记录"""
        try:
            cutoff = datetime.now() - timedelta(days=days)

            async with AsyncSessionLocal() as session:
                result = await session.execute(delete(AIMetric).where(AIMetric.created_at < cutoff))
                await session.commit()

                deleted_count = result.rowcount
                if deleted_count > 0:
                    logger.info("🗑️ 已清理 %s 条超过 %s 天的AI统计记录", deleted_count, days)

        except Exception as e:
            logger.error("❌ 清理历史AI统计失败: %s", e, exc_info=True)


_ai_metrics_service = None


def get_ai_metrics_service() -> AIMetricsService:
    global _ai_metrics_service
    if _ai_metrics_service is None:
        _ai_metrics_service = AIMetricsService()
    return _ai_metrics_service
