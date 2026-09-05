import socket
from pathlib import Path
from typing import Callable, Optional

from pydantic import BaseModel

from config import get_settings

SendCommand = Callable[[str, str], str]


class ScanResult(BaseModel):
    clean: bool
    details: str = ""


def _default_send_command(command: str, path: str) -> str:
    """Send a plain clamd command (e.g. CONTSCAN /some/path) over TCP and
    return the raw response text. clamd runs as its own container/service, so
    `path` must be visible to it - the worker and clamav services share a
    volume mounted at the same path for exactly this reason."""
    settings = get_settings()
    with socket.create_connection(
        (settings.clamav_host, settings.clamav_port), timeout=settings.clamav_timeout_seconds
    ) as sock:
        sock.sendall(f"{command} {path}\n".encode("utf-8"))
        chunks: list[bytes] = []
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks).decode("utf-8", errors="ignore")


def scan_directory(path: Path, *, send_command: Optional[SendCommand] = None) -> ScanResult:
    """Recursively scan a build's output directory with ClamAV (via clamd's
    CONTSCAN command) before it is tarred up and uploaded anywhere.

    `send_command` is injectable so tests can simulate clamd's response
    without a real daemon.
    """
    sender = send_command or _default_send_command

    try:
        response = sender("CONTSCAN", str(path))
    except OSError:
        return ScanResult(clean=False, details="The safety scan couldn't finish, so we can't distribute this file yet.")

    lines = [line.strip() for line in response.splitlines() if line.strip()]
    if not lines:
        return ScanResult(clean=False, details="The safety scan couldn't finish, so we can't distribute this file yet.")

    if any(line.endswith("FOUND") for line in lines):
        return ScanResult(clean=False, details="This tool was flagged by our safety scanner and cannot be installed.")

    if all(line.endswith("OK") for line in lines):
        return ScanResult(clean=True, details="No threats found.")

    return ScanResult(clean=False, details="The safety scan couldn't finish, so we can't distribute this file yet.")
