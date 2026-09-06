import hashlib
import json
import re
from typing import Optional

from openai import OpenAI
from pydantic import BaseModel, Field
from sqlalchemy import and_
from sqlalchemy.orm import Session

from config import get_settings
from db import BuildFix


class FixSuggestion(BaseModel):
    fix_type: str
    fix_payload: dict = Field(default_factory=dict)
    explanation: str = ""


class LLMError(RuntimeError):
    pass


def first_error_line(raw_log: str) -> str:
    for line in raw_log.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def fingerprint_error(raw_log: str) -> str:
    """Match the SQL knowledge base's key: md5(first_error_line)."""
    return hashlib.md5(first_error_line(raw_log).encode("utf-8")).hexdigest()


def lookup_known_fix(session: Session, fingerprint: str) -> Optional[BuildFix]:
    return (
        session.query(BuildFix)
        .filter(
            and_(
                BuildFix.error_fingerprint == fingerprint,
                BuildFix.success_count > BuildFix.failure_count,
            )
        )
        .order_by(BuildFix.success_count.desc())
        .first()
    )


def record_fix_outcome(
    session: Session, fingerprint: str, fix_type: str, fix_payload: Optional[dict], *, success: bool
) -> BuildFix:
    """Upsert into build_fixes, keyed by (error_fingerprint, fix_type)."""
    existing = (
        session.query(BuildFix)
        .filter(BuildFix.error_fingerprint == fingerprint, BuildFix.fix_type == fix_type)
        .one_or_none()
    )
    if existing is None:
        existing = BuildFix(
            error_fingerprint=fingerprint,
            fix_type=fix_type,
            fix_payload=fix_payload or {},
            success_count=0,
            failure_count=0,
        )
        session.add(existing)

    if success:
        existing.success_count += 1
    else:
        existing.failure_count += 1
    if fix_payload:
        existing.fix_payload = fix_payload

    session.flush()
    return existing


def _openrouter_generate(prompt: str, *, client: Optional[OpenAI] = None) -> str:
    settings = get_settings()

    try:
        active_client = client or OpenAI(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url)
        completion = active_client.chat.completions.create(
            model=settings.openrouter_fix_model,
            messages=[{"role": "user", "content": prompt}],
            timeout=settings.llm_timeout_seconds,
            extra_headers={
                "HTTP-Referer": settings.openrouter_referer,
                "X-Title": settings.openrouter_title,
            },
        )
        text = completion.choices[0].message.content or ""
    except Exception as exc:
        raise LLMError(f"OpenRouter request failed: {exc}") from exc

    if not text:
        raise LLMError("OpenRouter returned an empty response")
    return text


def _extract_json_object(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    raise LLMError("Could not parse JSON out of the model's response")


def suggest_fix_via_llm(error_log: str, context: dict, *, client: Optional[OpenAI] = None) -> FixSuggestion:
    prompt = (
        "A Docker build that packages a Python project into a portable virtual environment "
        "just failed. Suggest ONE concrete fix. Respond with ONLY a JSON object (no prose) "
        "with exactly these keys:\n"
        '  "fix_type": one of "add_apt_package", "pip_flag", "pin_python_version", "edit_requirements", "retry"\n'
        '  "fix_payload": a JSON object with whatever fields the fix needs, e.g. {"packages": ["libgl1-mesa-glx"]} '
        'or {"flag": "--pre"}\n'
        '  "explanation": one short sentence, for internal logs only\n\n'
        f"Build context: {json.dumps(context)[:2000]}\n\n"
        f"Error log (last portion):\n{error_log[-4000:]}"
    )

    try:
        raw = _openrouter_generate(prompt, client=client)
        data = _extract_json_object(raw)
        return FixSuggestion.model_validate(data)
    except (LLMError, ValueError):
        return FixSuggestion(fix_type="retry", fix_payload={}, explanation="Could not get a fix suggestion from the model.")


def get_fix(
    session: Session, error_log: str, context: dict, *, client: Optional[OpenAI] = None
) -> tuple[FixSuggestion, bool]:
    """Return (fix, came_from_knowledge_base). Checks the fix knowledge base first,
    skipping the LLM entirely when a fix with more successes than failures exists."""
    fingerprint = fingerprint_error(error_log)
    known = lookup_known_fix(session, fingerprint)
    if known is not None:
        return FixSuggestion(fix_type=known.fix_type, fix_payload=known.fix_payload or {}), True

    return suggest_fix_via_llm(error_log, context, client=client), False
