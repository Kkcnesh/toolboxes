from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.preflight import (
    GPU_REQUIRED,
    INACTIVE_UNPOPULAR,
    NO_PYTHON_CODE,
    classify_repo,
)
from pipeline.readme_parser import ReadmeAnalysis


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeGithubClient:
    def __init__(self, stars: int = 10, pushed_at: str = "2024-06-01T00:00:00Z"):
        self.stars = stars
        self.pushed_at = pushed_at

    def get(self, url, headers=None):
        return _FakeResponse(200, {"stargazers_count": self.stars, "pushed_at": self.pushed_at})

    def close(self):
        pass


def _make_repo(tmp_path: Path, files: dict[str, str]) -> Path:
    for relpath, content in files.items():
        path = tmp_path / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    return tmp_path


def test_rejects_repo_with_no_python_files(tmp_path):
    repo = _make_repo(tmp_path, {"README.md": "Just some docs, no code here."})
    analysis = ReadmeAnalysis(entry_point=None, confidence=0.9)

    verdict = classify_repo(
        repo,
        "Just some docs, no code here.",
        analysis,
        github_url="https://github.com/acme/empty",
        http_client=_FakeGithubClient(),
    )

    assert verdict.is_red is True
    assert verdict.reason_code == NO_PYTHON_CODE


def test_rejects_repo_whose_readme_mentions_cuda(tmp_path):
    readme_text = "This project requires CUDA and an NVIDIA A100 GPU to run."
    repo = _make_repo(tmp_path, {"app.py": "print('hi')\n", "README.md": readme_text})
    analysis = ReadmeAnalysis(entry_point="app.py", confidence=0.9)

    verdict = classify_repo(
        repo,
        readme_text,
        analysis,
        github_url="https://github.com/acme/gpu-tool",
        http_client=_FakeGithubClient(),
    )

    assert verdict.is_red is True
    assert verdict.reason_code == GPU_REQUIRED


def test_rejects_repo_with_no_entry_point_and_low_confidence(tmp_path):
    repo = _make_repo(tmp_path, {"lib/helpers.py": "def helper():\n    pass\n", "README.md": "Some library."})
    analysis = ReadmeAnalysis(entry_point=None, confidence=0.2)

    verdict = classify_repo(
        repo,
        "Some library.",
        analysis,
        github_url="https://github.com/acme/unclear-tool",
        http_client=_FakeGithubClient(),
    )

    assert verdict.is_red is True


def test_rejects_inactive_and_unpopular_repo(tmp_path):
    repo = _make_repo(tmp_path, {"app.py": "print('hi')\n", "README.md": "A tool."})
    analysis = ReadmeAnalysis(entry_point="app.py", confidence=0.9)
    old_pushed_at = (datetime.now(timezone.utc) - timedelta(days=900)).strftime("%Y-%m-%dT%H:%M:%SZ")

    verdict = classify_repo(
        repo,
        "A tool.",
        analysis,
        github_url="https://github.com/acme/dead-tool",
        http_client=_FakeGithubClient(stars=0, pushed_at=old_pushed_at),
    )

    assert verdict.is_red is True
    assert verdict.reason_code == INACTIVE_UNPOPULAR


def test_accepts_a_normal_active_repo(tmp_path):
    repo = _make_repo(tmp_path, {"app.py": "print('hi')\n", "README.md": "A simple CLI tool."})
    analysis = ReadmeAnalysis(entry_point="app.py", confidence=0.9)

    verdict = classify_repo(
        repo,
        "A simple CLI tool.",
        analysis,
        github_url="https://github.com/acme/simple-tool",
        http_client=_FakeGithubClient(stars=50),
    )

    assert verdict.is_red is False
    assert verdict.resolved_entry_point == "app.py"
