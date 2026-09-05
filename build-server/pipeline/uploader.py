import tarfile
from pathlib import Path
from typing import Optional

import boto3
from botocore.client import Config as BotoConfig

from config import get_settings


def make_r2_client(*, boto3_client=None):
    if boto3_client is not None:
        return boto3_client

    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key,
        aws_secret_access_key=settings.r2_secret_key,
        config=BotoConfig(signature_version="s3v4"),
        region_name="auto",
    )


def make_tarball(staging_dir: Path, tool_id: str, dest_dir: Optional[Path] = None) -> Path:
    """tar -czf {tool_id}.tar.gz {tool_id}/  (relative to staging_dir)"""
    bundle_dir = staging_dir / tool_id
    if not bundle_dir.is_dir():
        raise FileNotFoundError(f"No bundle directory found at {bundle_dir}")

    dest = (dest_dir or staging_dir) / f"{tool_id}.tar.gz"
    with tarfile.open(dest, "w:gz") as tar:
        tar.add(bundle_dir, arcname=tool_id)
    return dest


def upload_and_presign(archive_path: Path, key: str, *, s3_client=None) -> str:
    settings = get_settings()
    client = s3_client or make_r2_client()

    client.upload_file(str(archive_path), settings.r2_bucket, key)

    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": key},
        ExpiresIn=settings.presigned_url_expiry_seconds,
    )


def package_and_upload(staging_dir: Path, tool_id: str, *, s3_client=None) -> str:
    archive_path = make_tarball(staging_dir, tool_id)
    key = f"{tool_id}/{archive_path.name}"
    return upload_and_presign(archive_path, key, s3_client=s3_client)
