"""Gateway router package.

Keep this module side-effect free so importing a single router (for example
``app.gateway.routers.novel``) will not eagerly import all other routers.
"""

__all__ = [
    "agents",
    "artifacts",
    "assistants_compat",
    "channels",
    "features",
    "mcp",
    "memory",
    "models",
    "novel",
    "runs",
    "skills",
    "suggestions",
    "thread_runs",
    "threads",
    "uploads",
]
