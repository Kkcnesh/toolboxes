import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from pydantic import BaseModel

from config import get_settings
from pipeline.readme_parser import ReadmeAnalysis

NO_PYTHON_CODE = "no_python_files"
GPU_REQUIRED = "gpu_required"
NO_ENTRY_POINT = "no_entry_point"
INACTIVE_UNPOPULAR = "inactive_unpopular"

REASON_MESSAGES = {
    NO_PYTHON_CODE: "This repository doesn't contain any Python code we can package.",
    GPU_REQUIRED: "This tool requires a GPU. We only support CPU-based tools right now.",
    NO_ENTRY_POINT: "We couldn't figure out how to run this tool automatically.",
    INACTIVE_UNPOPULAR: "This project doesn't look active or widely used enough for us to package automatically.",
}

GPU_KEYWORDS_RE = re.compile(
    r"requires?\s+cuda|cuda\s+required|gpu\s+required|requires?\s+(?:an?\s+)?gpu|\bA100\b|\bH100\b",
    re.IGNORECASE,
)

COMMON_ENTRY_POINT_NAMES = ("main.py", "app.py", "__main__.py", "run.py")

GITHUB_URL_RE = re.compile(r"github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?/?$")


class PreflightVerdict(BaseModel):
    is_red: bool
    reason_code: Optional[str] = None
    reason_human: Optional[str] = None
    resolved_entry_point: Optional[str] = None


def _reject(code: str) -> PreflightVerdict:
    return PreflightVerdict(is_red=True, reason_code=code, reason_human=REASON_MESSAGES[code])


def _has_python_files(repo_dir: Path) -> bool:
    if any(repo_dir.glob("*.py")):
        return True
    src_dir = repo_dir / "src"
    if src_dir.is_dir() and any(src_dir.rglob("*.py")):
        return True
    return False


def _resolve_entry_point(repo_dir: Path, reported: Optional[str]) -> Optional[str]:
    if reported:
        candidate = (repo_dir / reported).resolve()
        try:
            candidate.relative_to(repo_dir.resolve())
        except ValueError:
            candidate = None
        if candidate is not None and candidate.is_file() and candidate.suffix == ".py":
            return str(candidate.relative_to(repo_dir.resolve()))

    for name in COMMON_ENTRY_POINT_NAMES:
        for base in (repo_dir, repo_dir / "src"):
            candidate = base / name
            if candidate.is_file():
                return str(candidate.relative_to(repo_dir))

    top_level_py = list(repo_dir.glob("*.py"))
    if len(top_level_py) == 1:
        return top_level_py[0].name

    return None


def _parse_owner_repo(github_url: str) -> Optional[tuple[str, str]]:
    match = GITHUB_URL_RE.search(github_url.strip())
    if not match:
        return None
    return match.group("owner"), match.group("repo")


def _fetch_repo_activity(github_url: str, *, http_client: Optional[httpx.Client] = None) -> Optional[dict]:
    """Return {"stars": int, "pushed_at": datetime} for a repo, or None if it can't be determined.

    Fails open: any network/parse problem returns None rather than raising, so a
    flaky GitHub API call never blocks an otherwise-valid build.
    """
    parsed = _parse_owner_repo(github_url)
    if parsed is None:
        return None
    owner, repo = parsed

    settings = get_settings()
    owns_client = http_client is None
    client = http_client or httpx.Client(timeout=settings.github_api_timeout_seconds)
    try:
        response = client.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            headers={"Accept": "application/vnd.github+json"},
        )
        if response.status_code != 200:
            return None
        data = response.json()
        pushed_at_raw = data.get("pushed_at")
        pushed_at = datetime.fromisoformat(pushed_at_raw.replace("Z", "+00:00")) if pushed_at_raw else None
        return {"stars": data.get("stargazers_count", 0), "pushed_at": pushed_at}
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    finally:
        if owns_client:
            client.close()


def classify_repo(
    repo_dir: Path,
    readme_text: str,
    analysis: ReadmeAnalysis,
    *,
    github_url: str,
    http_client: Optional[httpx.Client] = None,
) -> PreflightVerdict:
    settings = get_settings()

    if not _has_python_files(repo_dir):
        return _reject(NO_PYTHON_CODE)

    if GPU_KEYWORDS_RE.search(readme_text or ""):
        return _reject(GPU_REQUIRED)

    entry_point = _resolve_entry_point(repo_dir, analysis.entry_point)
    if entry_point is None and analysis.confidence < settings.preflight_entry_point_confidence_floor:
        return _reject(NO_ENTRY_POINT)

    activity = _fetch_repo_activity(github_url, http_client=http_client)
    if activity is not None:
        stars = activity.get("stars") or 0
        pushed_at = activity.get("pushed_at")
        if stars == 0 and pushed_at is not None:
            age = datetime.now(timezone.utc) - pushed_at
            if age > timedelta(days=settings.inactive_repo_max_age_days):
                return _reject(INACTIVE_UNPOPULAR)

    return PreflightVerdict(is_red=False, resolved_entry_point=entry_point)
