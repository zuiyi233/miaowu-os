"""Register novel ORM models on the shared DeerFlow metadata.

Do not import the retired compatibility ``user`` model here.  Main DeerFlow owns
the canonical ``users`` table via ``deerflow.persistence.user.model.UserRow``.
"""

from app.gateway.novel_migrated.models import ai_metric  # noqa: F401
from app.gateway.novel_migrated.models import analysis_task  # noqa: F401
from app.gateway.novel_migrated.models import author_control  # noqa: F401
from app.gateway.novel_migrated.models import batch_generation_task  # noqa: F401
from app.gateway.novel_migrated.models import career  # noqa: F401
from app.gateway.novel_migrated.models import chapter  # noqa: F401
from app.gateway.novel_migrated.models import character  # noqa: F401
from app.gateway.novel_migrated.models import document_index  # noqa: F401
from app.gateway.novel_migrated.models import dual_write_log  # noqa: F401
from app.gateway.novel_migrated.models import foreshadow  # noqa: F401
from app.gateway.novel_migrated.models import generation_history  # noqa: F401
from app.gateway.novel_migrated.models import intent_session  # noqa: F401
from app.gateway.novel_migrated.models import mcp_plugin  # noqa: F401
from app.gateway.novel_migrated.models import media_asset  # noqa: F401
from app.gateway.novel_migrated.models import memory  # noqa: F401
from app.gateway.novel_migrated.models import novel_agent_config  # noqa: F401
from app.gateway.novel_migrated.models import outline  # noqa: F401
from app.gateway.novel_migrated.models import project  # noqa: F401
from app.gateway.novel_migrated.models import project_default_style  # noqa: F401
from app.gateway.novel_migrated.models import prompt_template  # noqa: F401
from app.gateway.novel_migrated.models import prompt_workshop  # noqa: F401
from app.gateway.novel_migrated.models import regeneration_task  # noqa: F401
from app.gateway.novel_migrated.models import relationship  # noqa: F401
from app.gateway.novel_migrated.models import settings  # noqa: F401
from app.gateway.novel_migrated.models import writing_style  # noqa: F401
