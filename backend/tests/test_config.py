from app.config import _setting, setting


def test_new_setting_takes_precedence_over_legacy(monkeypatch):
    monkeypatch.setenv("ROADSCOPE_DEFAULT_SEED", "11")
    monkeypatch.setenv("UAI_DEFAULT_SEED", "12")
    assert _setting("DEFAULT_SEED", "42") == "11"
    assert setting("DEFAULT_SEED", "42") == "11"


def test_legacy_setting_and_default(monkeypatch):
    monkeypatch.delenv("ROADSCOPE_DEFAULT_SEED", raising=False)
    monkeypatch.setenv("UAI_DEFAULT_SEED", "12")
    assert _setting("DEFAULT_SEED", "42") == "12"
    monkeypatch.delenv("UAI_DEFAULT_SEED")
    assert _setting("DEFAULT_SEED", "42") == "42"
