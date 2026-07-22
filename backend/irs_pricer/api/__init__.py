"""IRS Pricer HTTP API package.  Exports the FastAPI app for uvicorn."""

from .app import app  # noqa: F401

__all__ = ["app"]
