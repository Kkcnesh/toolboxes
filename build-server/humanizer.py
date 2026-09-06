from typing import Optional

from openai import AsyncOpenAI

from config import get_settings

GENERIC_FALLBACK_MESSAGE = (
    "Something went wrong while packaging this tool. We've logged the details and our team will take a look."
)

# Checked before ever calling the LLM: fast, free, and deterministic. Keys are
# matched as case-insensitive substrings of the raw log.
PATTERNS: dict[str, str] = {
    "No module named": "A required library couldn't be installed.",
    "Could not find a version": "This tool needs a library version we couldn't find.",
    "Microsoft Visual C++": "This tool needs Windows build tools we don't have.",
    "CUDA": "This tool requires a GPU. We only support CPU-based tools right now.",
    "killed": "The build ran out of memory.",
    "timeout": "The build took too long and was cancelled.",
}

# If the LLM's own summary still contains one of these, it leaked something
# technical - throw the answer away and use the generic fallback instead.
LEAK_MARKERS = ("traceback", 'file "', '.py", line', "exit code", "errno", "0x", "stderr:", "stdout:")


class HumanizeError(RuntimeError):
    pass


async def _ask_llm_for_summary(raw_log: str, *, client: Optional[AsyncOpenAI] = None) -> str:
    settings = get_settings()
    prompt = (
        "Translate the build error log below into exactly ONE short sentence a non-technical "
        "person can understand. Do not mention file paths, line numbers, exit codes, or exception "
        "class names. Do not use technical jargon. Respond with plain text only, one sentence.\n\n"
        f"Error log:\n{raw_log[-3000:]}"
    )

    try:
        active_client = client or AsyncOpenAI(api_key=settings.qwen_api_key, base_url=settings.qwen_base_url)
        completion = await active_client.chat.completions.create(
            model=settings.qwen_model,
            messages=[{"role": "user", "content": prompt}],
            timeout=settings.llm_timeout_seconds,
        )
    except Exception as exc:
        raise HumanizeError(f"Qwen request failed: {exc}") from exc

    text = completion.choices[0].message.content or ""
    if not text:
        raise HumanizeError("Qwen returned an empty response")
    return text


async def humanize_error(raw_log: str, *, client: Optional[AsyncOpenAI] = None) -> str:
    """Translate a raw build error log into a single plain-English sentence.

    Called before every status update that sets `error_message`. Never returns
    anything resembling a stack trace, exit code, or file path.
    """
    if not raw_log or not raw_log.strip():
        return GENERIC_FALLBACK_MESSAGE

    for pattern, human in PATTERNS.items():
        if pattern.lower() in raw_log.lower():
            return human

    try:
        text = await _ask_llm_for_summary(raw_log, client=client)
    except HumanizeError:
        return GENERIC_FALLBACK_MESSAGE

    sentence = text.strip().splitlines()[0].strip() if text.strip() else ""
    if not sentence:
        return GENERIC_FALLBACK_MESSAGE

    if any(marker in sentence.lower() for marker in LEAK_MARKERS):
        return GENERIC_FALLBACK_MESSAGE

    return sentence
