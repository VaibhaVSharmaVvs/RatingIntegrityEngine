"""Every CLI tool must at least import and parse --help (they aren't otherwise tested)."""

import subprocess
import sys
from pathlib import Path

import pytest

TOOLS = Path(__file__).resolve().parents[2] / "tools"
ARGPARSE_TOOLS = sorted(
    p.name for p in TOOLS.glob("*.py") if "argparse" in p.read_text(encoding="utf-8")
)


@pytest.mark.parametrize("tool", ARGPARSE_TOOLS)
def test_tool_imports_and_parses_help(tool: str) -> None:
    r = subprocess.run(
        [sys.executable, str(TOOLS / tool), "--help"], capture_output=True, text=True, timeout=120
    )
    assert r.returncode == 0, r.stderr[-2000:]


def test_export_bundle_scrubs_contact_details() -> None:
    sys.path.insert(0, str(TOOLS))
    from export_bundle import scrub

    text = (
        "Great game, add me: gamer@example.com or discord.gg/abc123, "
        "my channel youtube.com/@bob, call +1 (555) 123-4567, ping @NightOwl_7. 10/10 for 2024."
    )
    out = scrub(text)
    assert "example.com" not in out and "discord.gg" not in out and "youtube.com" not in out
    assert "555" not in out and "NightOwl" not in out
    assert "Great game" in out and "10/10 for 2024" in out  # ordinary text and numbers stay
    assert scrub(None) is None and scrub("") == ""
