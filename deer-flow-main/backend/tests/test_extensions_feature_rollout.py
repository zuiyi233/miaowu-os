from deerflow.config.extensions_config import ExtensionsConfig, FeatureFlagConfig


def test_is_feature_enabled_for_user_falls_back_to_default():
    cfg = ExtensionsConfig(features={})

    assert cfg.is_feature_enabled_for_user("intent_recognition", user_id="u1", default=True) is True
    assert cfg.is_feature_enabled_for_user("intent_recognition", user_id="u1", default=False) is False


def test_is_feature_enabled_for_user_honors_allow_and_deny_lists():
    cfg = ExtensionsConfig(
        features={
            "intent_recognition": FeatureFlagConfig(
                enabled=True,
                rollout_percentage=0,
                allow_users=["allow-user"],
                deny_users=["deny-user"],
            )
        }
    )

    assert cfg.is_feature_enabled_for_user("intent_recognition", user_id="allow-user", default=False) is True
    assert cfg.is_feature_enabled_for_user("intent_recognition", user_id="deny-user", default=True) is False


def test_is_feature_enabled_for_user_rollout_is_deterministic():
    cfg = ExtensionsConfig(
        features={
            "intent_recognition": FeatureFlagConfig(
                enabled=True,
                rollout_percentage=37,
                allow_users=[],
                deny_users=[],
            )
        }
    )

    first = cfg.is_feature_enabled_for_user("intent_recognition", user_id="hash-user-1", default=False)
    second = cfg.is_feature_enabled_for_user("intent_recognition", user_id="hash-user-1", default=False)
    assert first == second


def test_is_feature_enabled_for_user_handles_extreme_rollout_values():
    cfg = ExtensionsConfig(
        features={
            "intent_recognition": FeatureFlagConfig(
                enabled=True,
                rollout_percentage=100,
            )
        }
    )
    assert cfg.is_feature_enabled_for_user("intent_recognition", user_id="any-user", default=False) is True

    cfg.features["intent_recognition"] = FeatureFlagConfig(
        enabled=True,
        rollout_percentage=0,
    )
    assert cfg.is_feature_enabled_for_user("intent_recognition", user_id="any-user", default=True) is False
