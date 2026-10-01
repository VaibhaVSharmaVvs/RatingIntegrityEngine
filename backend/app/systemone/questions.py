"""Question-set registry. Runs store the version they used; old versions stay intact."""

from types import ModuleType

from app.systemone import questions_v1, questions_v2, questions_v3, questions_v4

QUESTION_SETS: dict[str, ModuleType] = {
    "v1": questions_v1,
    "v2": questions_v2,
    "v3": questions_v3,
    "v4": questions_v4,
}
DEFAULT_QUESTION_SET = "v2"


def get(version: str) -> dict[str, dict]:
    return QUESTION_SETS[version].QUESTIONS


def score_levels(version: str) -> dict[str, int]:
    return {q: len(s["criteria"]) for q, s in get(version).items() if s["type"] == "score"}
