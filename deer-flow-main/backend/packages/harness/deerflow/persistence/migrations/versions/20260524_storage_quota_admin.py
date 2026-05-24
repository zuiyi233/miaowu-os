"""Add storage quota and admin audit tables.

Revision ID: 20260524_storage_quota_admin
Revises:
Create Date: 2026-05-24
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260524_storage_quota_admin"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("value_type", sa.String(length=32), nullable=False),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "user_storage_usage",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("used_bytes", sa.Integer(), nullable=False),
        sa.Column("quota_bytes", sa.Integer(), nullable=True),
        sa.Column("browser_reported_used_bytes", sa.Integer(), nullable=False),
        sa.Column("browser_reported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recalculated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "user_storage_objects",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("resource_id", sa.String(length=256), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("content_hash", sa.String(length=128), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("client_reported", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "source", "resource_id", name="uq_user_storage_object_resource"),
    )
    op.create_index("ix_user_storage_objects_user_id", "user_storage_objects", ["user_id"])
    op.create_index("idx_user_storage_objects_status", "user_storage_objects", ["user_id", "status"])
    op.create_table(
        "user_quota_overrides",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("backend_quota_bytes", sa.Integer(), nullable=True),
        sa.Column("browser_quota_bytes", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.String(length=36), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("admin_user_id", sa.String(length=36), nullable=False),
        sa.Column("target_user_id", sa.String(length=36), nullable=True),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("field", sa.String(length=128), nullable=True),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_audit_logs_admin_user_id", "admin_audit_logs", ["admin_user_id"])
    op.create_index("ix_admin_audit_logs_target_user_id", "admin_audit_logs", ["target_user_id"])
    op.create_table(
        "storage_recalculate_tasks",
        sa.Column("task_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("users_recalculated", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("result_json", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("task_id"),
    )
    op.create_index("ix_storage_recalculate_tasks_status", "storage_recalculate_tasks", ["status"])
    op.create_index("ix_storage_recalculate_tasks_created_by", "storage_recalculate_tasks", ["created_by"])

    op.bulk_insert(
        sa.table(
            "system_settings",
            sa.column("key", sa.String),
            sa.column("value", sa.Text),
            sa.column("value_type", sa.String),
            sa.column("updated_by", sa.String),
            sa.column("updated_at", sa.DateTime),
        ),
        [
            {"key": "backend_storage_quota_bytes", "value": "104857600", "value_type": "int", "updated_by": None, "updated_at": sa.func.now()},
            {"key": "browser_storage_quota_bytes", "value": "104857600", "value_type": "int", "updated_by": None, "updated_at": sa.func.now()},
            {"key": "backend_storage_quota_enabled", "value": "true", "value_type": "bool", "updated_by": None, "updated_at": sa.func.now()},
            {"key": "browser_storage_quota_enabled", "value": "true", "value_type": "bool", "updated_by": None, "updated_at": sa.func.now()},
        ],
    )


def downgrade() -> None:
    op.drop_index("ix_storage_recalculate_tasks_created_by", table_name="storage_recalculate_tasks")
    op.drop_index("ix_storage_recalculate_tasks_status", table_name="storage_recalculate_tasks")
    op.drop_table("storage_recalculate_tasks")
    op.drop_index("ix_admin_audit_logs_target_user_id", table_name="admin_audit_logs")
    op.drop_index("ix_admin_audit_logs_admin_user_id", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")
    op.drop_table("user_quota_overrides")
    op.drop_index("idx_user_storage_objects_status", table_name="user_storage_objects")
    op.drop_index("ix_user_storage_objects_user_id", table_name="user_storage_objects")
    op.drop_table("user_storage_objects")
    op.drop_table("user_storage_usage")
    op.drop_table("system_settings")
