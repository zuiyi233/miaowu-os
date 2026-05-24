"""Add local product entitlement cache and agent run usage.

Revision ID: 20260524_product_entitlements
Revises: 20260524_storage_quota_admin
Create Date: 2026-05-24
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260524_product_entitlements"
down_revision = "20260524_storage_quota_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_product_entitlement_cache",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("product_key", sa.String(length=64), nullable=False),
        sa.Column("plan_key", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entitlements_json", sa.Text(), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=True),
        sa.Column("source_id", sa.String(length=128), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "product_key"),
    )
    op.create_index(
        "idx_user_product_entitlement_cache_status",
        "user_product_entitlement_cache",
        ["user_id", "product_key", "status"],
    )
    op.create_table(
        "user_agent_run_usage",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_runs", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "period_start", "period_end", name="uq_user_agent_run_usage_period"),
    )
    op.create_index("ix_user_agent_run_usage_user_id", "user_agent_run_usage", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_user_agent_run_usage_user_id", table_name="user_agent_run_usage")
    op.drop_table("user_agent_run_usage")
    op.drop_index("idx_user_product_entitlement_cache_status", table_name="user_product_entitlement_cache")
    op.drop_table("user_product_entitlement_cache")
