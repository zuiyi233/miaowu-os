from app.gateway.novel_migrated.api.characters import CharacterCreateRequest, CharacterUpdateRequest


def test_character_create_request_accepts_legacy_relationships_text_alias():
    payload = CharacterCreateRequest(
        name="林彻",
        relationships_text="与周舟是搭档",
    )

    assert payload.relationships == "与周舟是搭档"


def test_character_update_request_prefers_relationships_over_legacy_alias():
    payload = CharacterUpdateRequest(
        relationships="新关系",
        relationships_text="旧关系",
    )

    assert payload.relationships == "新关系"
