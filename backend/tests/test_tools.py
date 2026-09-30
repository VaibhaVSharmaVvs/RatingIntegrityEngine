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
