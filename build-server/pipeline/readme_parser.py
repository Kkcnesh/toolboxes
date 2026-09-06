import json
import re
from pathlib import Path
from typing import Optional

from openai import OpenAI
from pydantic import BaseModel, Field

from config import get_settings


class ReadmeAnalysis(BaseModel):
    entry_point: Optional[str] = None
    python_version: str = "3.11"
    system_deps: list[str] = Field(default_factory=list)
    run_command: Optional[str] = None
    description: str = ""
    confidence: float = 0.0


class LLMError(RuntimeError):
    pass


def _openrouter_generate(prompt: str, *, client: Optional[OpenAI] = None) -> str:
    settings = get_settings()

    try:
        active_client = client or OpenAI(api_key=settings.openrouter_api_key, base_url=settings.openrouter_base_url)
        completion = active_client.chat.completions.create(
            model=settings.openrouter_readme_model,
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


def parse_readme(readme_text: str, *, client: Optional[OpenAI] = None) -> ReadmeAnalysis:
    """Read a project's README via OpenRouter and extract a build spec.

    Falls back to a zero-confidence, minimal-guess analysis whenever the model
    is unreachable or doesn't return parseable JSON - the caller decides what
    to do with low confidence, this function never raises for that reason.
    """
    prompt = (
        "You are analyzing the README of a Python project so it can be packaged into a "
        "portable virtual environment bundle. Read the README below and respond with ONLY "
        "a JSON object (no prose, no markdown fences) with exactly these keys:\n"
        '  "entry_point": the relative path to the main Python file to run, e.g. "app.py", or null if unclear\n'
        '  "python_version": a Python version string like "3.10", best guess if unstated\n'
        '  "system_deps": a JSON array of Python package/import names this project relies on '
        "that typically need extra system libraries (e.g. \"ffmpeg\", \"cv2\")\n"
        '  "run_command": the shell command used to run the program, e.g. "python app.py"\n'
        '  "description": one short sentence, in plain English, describing what the program does\n'
        '  "confidence": a number from 0 to 1 for how confident you are in this analysis\n\n'
        f"README:\n{readme_text[:8000]}"
    )

    try:
        raw = _openrouter_generate(prompt, client=client)
        data = _extract_json_object(raw)
        return ReadmeAnalysis.model_validate(data)
    except (LLMError, ValueError):
        return ReadmeAnalysis(
            entry_point=None,
            python_version="3.11",
            system_deps=[],
            run_command=None,
            description="",
            confidence=0.0,
        )


def _parse_min_version_from_specifier(specifier: str) -> Optional[str]:
    match = re.search(r">=\s*(\d+\.\d+)", specifier)
    if match:
        return match.group(1)
    match = re.search(r"==\s*(\d+\.\d+)", specifier)
    if match:
        return match.group(1)
    return None


def detect_declared_python_version(repo_dir: Path) -> Optional[str]:
    """Look for a project-declared minimum Python version in pyproject.toml's
    `requires-python` or setup.cfg's `python_requires`.

    This is a far more reliable signal than an LLM's guess from README prose -
    a repo like yt-dlp declares `requires-python = ">=3.10"` explicitly, and
    trusting that over a guess avoids packaging it against a Python version
    its own dependencies will refuse to install under.
    """
    pyproject = repo_dir / "pyproject.toml"
    if pyproject.is_file():
        try:
            text = pyproject.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            text = ""
        match = re.search(r'requires-python\s*=\s*["\']([^"\']+)["\']', text)
        if match:
            version = _parse_min_version_from_specifier(match.group(1))
            if version:
                return version

    setup_cfg = repo_dir / "setup.cfg"
    if setup_cfg.is_file():
        try:
            text = setup_cfg.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            text = ""
        match = re.search(r"python_requires\s*=\s*([^\n]+)", text)
        if match:
            version = _parse_min_version_from_specifier(match.group(1))
            if version:
                return version

    return None
