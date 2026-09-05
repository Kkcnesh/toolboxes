import re
import uuid
from contextlib import asynccontextmanager
from enum import Enum
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

from db import Build, init_db, session_scope
from worker import run_build_task

GITHUB_URL_RE = re.compile(r"^https?://github\.com/[\w.-]+/[\w.-]+(?:\.git)?/?$")


class Platform(str, Enum):
    mac = "mac"
    windows = "windows"
    linux = "linux"


class BuildStatus(str, Enum):
    queued = "queued"
    cloning = "cloning"
    reading = "reading"
    building = "building"
    scanning = "scanning"
    uploading = "uploading"
    success = "success"
    failed = "failed"


class BuildCreateRequest(BaseModel):
    github_url: str
    platform: Platform = Platform.mac
    client_job_id: Optional[str] = None

    @field_validator("github_url")
    @classmethod
    def strip_and_check(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("github_url must not be empty")
        return value


class BuildCreateResponse(BaseModel):
    job_id: str
    estimated_minutes: int = 3


class BuildStatusResponse(BaseModel):
    status: BuildStatus
    current_step: Optional[str] = None
    download_url: Optional[str] = None
    error_message: Optional[str] = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Toolbox Build Server", lifespan=lifespan)


@app.post("/builds", response_model=BuildCreateResponse, status_code=202)
def create_build(payload: BuildCreateRequest) -> BuildCreateResponse:
    if not GITHUB_URL_RE.match(payload.github_url):
        raise HTTPException(status_code=422, detail="That doesn't look like a GitHub repository link.")

    build_id = uuid.uuid4().hex
    with session_scope() as session:
        session.add(
            Build(
                id=build_id,
                client_job_id=payload.client_job_id,
                github_url=payload.github_url,
                platform=payload.platform.value,
                status="queued",
                current_step="Waiting to start",
            )
        )

    run_build_task.delay(build_id)
    return BuildCreateResponse(job_id=build_id, estimated_minutes=3)


@app.get("/builds/{job_id}", response_model=BuildStatusResponse)
def get_build(job_id: str) -> BuildStatusResponse:
    with session_scope() as session:
        build = session.get(Build, job_id)
        if build is None:
            raise HTTPException(status_code=404, detail="We couldn't find a build with that id.")
        return BuildStatusResponse(
            status=BuildStatus(build.status),
            current_step=build.current_step,
            download_url=build.download_url,
            error_message=build.error_message,
        )
