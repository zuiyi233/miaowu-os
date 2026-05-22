import logging
from pathlib import Path

from .types import Skill

logger = logging.getLogger(__name__)


def get_skills_root_path() -> Path:
    from .storage import get_or_new_skill_storage

    storage = get_or_new_skill_storage()
    host_path = getattr(storage, "host_path", None)
    if host_path:
        return Path(host_path)
    backend_dir = Path(__file__).resolve().parent.parent.parent.parent.parent
    return backend_dir.parent / "skills"


def load_skills(skills_path: Path | None = None, use_config: bool = True, enabled_only: bool = False) -> list[Skill]:
    from .storage import get_or_new_skill_storage

    try:
        storage_kwargs: dict = {}
        if skills_path is not None:
            storage_kwargs["skills_path"] = str(skills_path)

        if skills_path is not None or use_config:
            try:
                from deerflow.config import get_app_config

                config = get_app_config()
                storage_kwargs["app_config"] = config
            except Exception:
                logger.debug("App config unavailable; using default skill storage")

        storage = get_or_new_skill_storage(**storage_kwargs)
        skills = list(storage.list_skills())

        try:
            from deerflow.config.extensions_config import ExtensionsConfig

            extensions_config = ExtensionsConfig.from_file()
            for skill in skills:
                skill.enabled = extensions_config.is_skill_enabled(skill.name, skill.category)
        except Exception as e:
            logger.warning("Failed to load extensions config: %s", e)

        if enabled_only:
            skills = [skill for skill in skills if skill.enabled]

        skills.sort(key=lambda s: s.name)
        return skills
    except Exception:
        logger.exception("Failed to load skills")
        return []
