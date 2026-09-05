import io
import json
import tarfile
from pathlib import Path

from db import Build
from worker import execute_build


def _make_output_tar() -> bytes:
    """A minimal tar matching what `docker cp`-ing /output would produce:
    a top-level "output" entry containing a fake venv."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tar:
        content = b"#!/bin/sh\necho fake-python\n"
        info = tarfile.TarInfo(name="output/venv/bin/python")
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class _FakeHttpClient:
    """Serves both the Ollama README-parse call and the GitHub activity call."""

    def __init__(self, readme_json: str):
        self._readme_json = readme_json

    def get(self, url, headers=None):
        return _FakeResponse(200, {"stargazers_count": 500, "pushed_at": "2024-06-01T00:00:00Z"})

    def post(self, url, json=None):
        return _FakeResponse(200, {"response": self._readme_json})

    def close(self):
        pass


class _FakeContainer:
    def __init__(self, tar_bytes: bytes):
        self._tar_bytes = tar_bytes
        self.removed = False

    def get_archive(self, path: str):
        return [self._tar_bytes], {"size": len(self._tar_bytes)}

    def remove(self, force: bool = False):
        self.removed = True


class _FakeImages:
    def __init__(self):
        self.built_tags: list[str] = []
        self.removed_tags: list[str] = []

    def build(self, path: str, tag: str, rm: bool = True):
        self.built_tags.append(tag)
        return object(), iter([{"stream": "Successfully built\n"}])

    def remove(self, tag: str, force: bool = False):
        self.removed_tags.append(tag)


class _FakeContainers:
    def __init__(self, tar_bytes: bytes):
        self._tar_bytes = tar_bytes
        self.created: list[_FakeContainer] = []

    def create(self, tag: str):
        container = _FakeContainer(self._tar_bytes)
        self.created.append(container)
        return container


class _FakeDockerClient:
    def __init__(self):
        self.images = _FakeImages()
        self.containers = _FakeContainers(_make_output_tar())
        self.closed = False

    def close(self):
        self.closed = True


class _FakeS3Client:
    def __init__(self):
        self.uploaded: list[tuple[str, str, str]] = []

    def upload_file(self, filename: str, bucket: str, key: str):
        self.uploaded.append((filename, bucket, key))

    def generate_presigned_url(self, operation: str, Params: dict, ExpiresIn: int):
        return f"https://example-r2.test/{Params['Key']}?sig=fake"


def _fake_clone(github_url: str, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "README.md").write_text("A simple tool that transcribes audio files to text using ffmpeg.")
    (dest / "app.py").write_text("print('hello world')\n")
    (dest / "requirements.txt").write_text("")


def _fake_scan(command: str, path: str) -> str:
    return f"{path}: OK\n"


def test_happy_path_build_produces_a_valid_manifest(db_session):
    build = Build(
        id="test-build-1",
        github_url="https://github.com/acme/transcribe-tool",
        platform="mac",
        status="queued",
    )
    db_session.add(build)
    db_session.commit()

    readme_json = json.dumps(
        {
            "entry_point": "app.py",
            "python_version": "3.11",
            "system_deps": [],
            "run_command": "python app.py",
            "description": "Transcribes audio files to text.",
            "confidence": 0.9,
        }
    )
    fake_docker = _FakeDockerClient()

    execute_build(
        "test-build-1",
        clone=_fake_clone,
        docker_client_factory=lambda: fake_docker,
        http_client=_FakeHttpClient(readme_json),
        s3_client_factory=lambda: _FakeS3Client(),
        scan_send_command=_fake_scan,
    )

    db_session.expire_all()
    refreshed = db_session.get(Build, "test-build-1")

    assert refreshed.status == "success"
    assert refreshed.error_message is None
    assert refreshed.download_url is not None
    assert refreshed.download_url.startswith("https://example-r2.test/")

    manifest = refreshed.manifest
    assert manifest is not None
    assert manifest["id"] == "acme-transcribe-tool"
    assert manifest["entry_point"] == "run.py"
    assert manifest["python_version"] == "3.11"
    assert manifest["panel_type"] == "file_in_text_out"
    assert manifest["input_types"] == ["audio", "video"]
    assert manifest["output_types"] == ["text"]
    assert manifest["runs_offline"] is True
    assert "icon_color" in manifest

    assert fake_docker.containers.created[0].removed is True
    assert fake_docker.images.removed_tags == fake_docker.images.built_tags
    assert fake_docker.closed is True
