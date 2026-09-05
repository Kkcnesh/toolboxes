import json
import re
from typing import Optional

import httpx
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


def _ollama_generate(model: str, prompt: str, *, client: Optional[httpx.Client] = None) -> str:
    settings = get_settings()
    owns_client = client is None
    http_client = client or httpx.Client(timeout=settings.llm_timeout_seconds)

    try:
        try:
            response = http_client.post(
                f"{settings.ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False, "format": "json"},
            )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise LLMError(f"Ollama request failed: {exc}") from exc
    finally:
        if owns_client:
            http_client.close()

    data = response.json()
    text = data.get("response", "")
    if not text:
        raise LLMError("Ollama returned an empty response")
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


def parse_readme(readme_text: str, *, client: Optional[httpx.Client] = None) -> ReadmeAnalysis:
    """Read a project's README with Llama 3.1 8B and extract a build spec.

    Falls back to a zero-confidence, minimal-guess analysis whenever the model
    is unreachable or doesn't return parseable JSON - the caller decides what
    to do with low confidence, this function never raises for that reason.
    """
    settings = get_settings()
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
        raw = _ollama_generate(settings.ollama_readme_model, prompt, client=client)
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
