import asyncio
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import docker
import httpx
from celery import Celery

from config import get_settings
from db import Build, BuildRejection, session_scope
from humanizer import humanize_error
from pipeline import docker_builder, preflight, readme_parser, recovery, scanner, uploader

settings = get_settings()

celery_app = Celery("toolbox_build", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

GITHUB_URL_RE = re.compile(r"github\.com/(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+?)(?:\.git)?/?$")


class CloneError(RuntimeError):
    pass


def derive_tool_id(github_url: str) -> str:
    match = GITHUB_URL_RE.search(github_url.strip())
    if not match:
        return "tool-" + str(abs(hash(github_url)))[:8]
    owner = match.group("owner").lower()
    repo = match.group("repo").lower()
    return f"{owner}-{repo}"


def clone_repo(github_url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        completed = subprocess.run(
            ["git", "clone", "--depth", "1", github_url, str(dest)],
            capture_output=True,
            text=True,
            timeout=settings.clone_timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise CloneError("Cloning this repository took too long.") from exc

    if completed.returncode != 0:
        raise CloneError(completed.stderr or "We couldn't clone that repository.")


def read_readme(repo_dir: Path) -> str:
    for name in ("README.md", "readme.md", "README.rst", "README.txt", "README"):
        candidate = repo_dir / name
        if candidate.is_file():
            try:
                return candidate.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                return ""
    return ""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _update_build(build_id: str, **fields) -> None:
    with session_scope() as session:
        build = session.get(Build, build_id)
        if build is None:
            return
        for key, value in fields.items():
            setattr(build, key, value)


def _fail_build(
    build_id: str, raw_or_human_message: str, *, already_human: bool = False, llm_client: Optional[object] = None
) -> None:
    message = (
        raw_or_human_message
        if already_human
        else asyncio.run(humanize_error(raw_or_human_message, client=llm_client))
    )
    _update_build(build_id, status="failed", current_step="Failed", error_message=message, finished_at=_now())


def execute_build(
    build_id: str,
    *,
    clone: Callable[[str, Path], None] = clone_repo,
    docker_client_factory: Optional[Callable[[], object]] = None,
    github_client: Optional[httpx.Client] = None,
    llm_client: Optional[object] = None,
    s3_client_factory: Optional[Callable[[], object]] = None,
    scan_send_command: Optional[Callable[[str, str], str]] = None,
) -> None:
    with session_scope() as session:
        build = session.get(Build, build_id)
        if build is None:
            return
        github_url = build.github_url
        platform = build.platform

    # staging_dir must live under settings.build_workdir specifically, not the
    # container's default temp dir - that path is a volume shared with the
    # clamav service (Step 5 scans it by path over the network), and only the
    # portion of the filesystem under build_workdir is actually shared.
    Path(settings.build_workdir).mkdir(parents=True, exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix="toolbox-build-", dir=settings.build_workdir))
    # mkdtemp defaults to 0700, readable only by the (root) worker process.
    # clamd drops privileges to run as its own unprivileged "clamav" user, so
    # without opening this up it can't even traverse into the directory to
    # scan it - not a virus flag, just a permission wall.
    workdir.chmod(0o755)
    repo_dir = workdir / "repo"
    staging_dir = workdir / "staging"
    docker_client = None

    try:
        _update_build(build_id, status="cloning", current_step="Cloning the repository")
        try:
            clone(github_url, repo_dir)
        except CloneError:
            _fail_build(build_id, "We couldn't access that repository. Please check the link and try again.", already_human=True)
            return

        _update_build(build_id, status="reading", current_step="Reading the project's documentation")
        readme_text = read_readme(repo_dir)
        analysis = readme_parser.parse_readme(readme_text, client=llm_client)

        declared_python_version = readme_parser.detect_declared_python_version(repo_dir)
        if declared_python_version:
            analysis.python_version = declared_python_version

        if analysis.confidence < settings.readme_confidence_floor:
            _fail_build(build_id, "We couldn't figure out how to run this tool automatically.", already_human=True)
            return

        verdict = preflight.classify_repo(repo_dir, readme_text, analysis, github_url=github_url, http_client=github_client)
        if verdict.is_red:
            with session_scope() as session:
                session.add(BuildRejection(github_url=github_url, reason_code=verdict.reason_code, reason_human=verdict.reason_human))
            _fail_build(build_id, verdict.reason_human, already_human=True)
            return

        _update_build(build_id, status="building", current_step="Building a virtual environment")

        tool_id = derive_tool_id(github_url)
        apt_packages = docker_builder.resolve_apt_packages(analysis.system_deps)
        context = docker_builder.BuildContext(python_version=analysis.python_version, apt_packages=apt_packages)

        docker_client = (docker_client_factory or docker.from_env)()

        outcome = None
        pending_fix: Optional[recovery.FixSuggestion] = None
        pending_fingerprint: Optional[str] = None

        for attempt in range(1, settings.max_build_attempts + 1):
            outcome = docker_builder.build_bundle(
                repo_dir=repo_dir,
                staging_dir=staging_dir,
                tool_id=tool_id,
                context=context,
                system_deps=analysis.system_deps,
                docker_client=docker_client,
            )

            if outcome.success:
                if pending_fix is not None and pending_fingerprint is not None:
                    with session_scope() as session:
                        recovery.record_fix_outcome(
                            session, pending_fingerprint, pending_fix.fix_type, pending_fix.fix_payload, success=True
                        )
                break

            if pending_fix is not None and pending_fingerprint is not None:
                with session_scope() as session:
                    recovery.record_fix_outcome(
                        session, pending_fingerprint, pending_fix.fix_type, pending_fix.fix_payload, success=False
                    )

            if attempt == settings.max_build_attempts:
                break

            with session_scope() as session:
                fix, _from_kb = recovery.get_fix(session, outcome.log, context.as_dict(), client=llm_client)

            context = docker_builder.apply_fix(fix, context, repo_dir)
            pending_fix = fix
            pending_fingerprint = recovery.fingerprint_error(outcome.log)

        if outcome is None or not outcome.success:
            _fail_build(
                build_id,
                outcome.log if outcome else "The build failed before it could start.",
                llm_client=llm_client,
            )
            return

        manifest = docker_builder.write_bundle_metadata(
            staging_dir, tool_id=tool_id, analysis=analysis, apt_packages=apt_packages, platform=platform
        )

        _update_build(build_id, status="scanning", current_step="Running a safety scan")
        scan_result = scanner.scan_directory(staging_dir / tool_id, send_command=scan_send_command)
        if not scan_result.clean:
            _fail_build(build_id, "This tool was flagged by our safety scanner and cannot be installed.", already_human=True)
            return

        _update_build(build_id, status="uploading", current_step="Uploading your tool")
        download_url = uploader.package_and_upload(
            staging_dir, tool_id, s3_client=(s3_client_factory() if s3_client_factory else None)
        )

        _update_build(
            build_id,
            status="success",
            current_step="Done",
            download_url=download_url,
            manifest=manifest,
            finished_at=_now(),
        )

    except Exception as exc:  # last-resort safety net: never leak a raw exception into error_message
        _fail_build(build_id, str(exc), llm_client=llm_client)
    finally:
        if docker_client is not None:
            try:
                docker_client.close()
            except Exception:
                pass
        shutil.rmtree(workdir, ignore_errors=True)


@celery_app.task(name="builds.run")
def run_build_task(build_id: str) -> None:
    execute_build(build_id)
