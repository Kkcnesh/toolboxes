import uuid
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator, Optional

from sqlalchemy import JSON, DateTime, Integer, String, UniqueConstraint, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from config import get_settings


class Base(DeclarativeBase):
    pass


class Build(Base):
    __tablename__ = "builds"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    client_job_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    github_url: Mapped[str] = mapped_column(String, nullable=False)
    platform: Mapped[str] = mapped_column(String, default="mac", server_default="mac")
    status: Mapped[str] = mapped_column(String, default="queued", server_default="queued")
    current_step: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    download_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    manifest: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class BuildFix(Base):
    __tablename__ = "build_fixes"
    __table_args__ = (UniqueConstraint("error_fingerprint", "fix_type", name="uq_build_fixes_fingerprint_type"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    error_fingerprint: Mapped[str] = mapped_column(String, nullable=False, index=True)
    fix_type: Mapped[str] = mapped_column(String, nullable=False)
    fix_payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    success_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    failure_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BuildRejection(Base):
    __tablename__ = "build_rejections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    github_url: Mapped[str] = mapped_column(String, nullable=False)
    reason_code: Mapped[str] = mapped_column(String, nullable=False)
    reason_human: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


def _make_engine():
    url = get_settings().database_url
    if url.startswith("sqlite"):
        from sqlalchemy.pool import StaticPool

        return create_engine(url, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    return create_engine(url, pool_pre_ping=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
