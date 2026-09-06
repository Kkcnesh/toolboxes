import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/1")
os.environ.setdefault("QWEN_API_KEY", "test-qwen-key")
os.environ.setdefault("R2_BUCKET", "test-bucket")
os.environ.setdefault("R2_ENDPOINT", "http://localhost:9000")
os.environ.setdefault("R2_ACCESS_KEY", "test-access-key")
os.environ.setdefault("R2_SECRET_KEY", "test-secret-key")
os.environ.setdefault("CLAMAV_HOST", "localhost")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from db import Base, SessionLocal, engine  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _init_schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()
        session.close()
