"""Input loaders. Convert files of various types to plain text.

Currently implemented: text and markdown.
Stubs (raise NotImplementedError with install hint): pdf, video, audio, html.
Adding a new loader = one function + an entry in LOADERS.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable


def _load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _load_pdf(path: Path) -> str:
    """For PDFs we don't extract text here — the CLI attaches the raw bytes
    as a document content block to the AnthropicExtractor, which lets Claude
    read the PDF natively (with full visual context including tables and
    formatting). The extractor falls back to text-only if no attachments
    were provided. This loader returns a minimal text stub so the rest of
    the pipeline (validation, audit) doesn't choke on empty input."""
    return f"[PDF document attached: {path.name} — see attachments]"


def _load_image(path: Path) -> str:
    """For images, attached as image content blocks. Stub text only."""
    return f"[Image attached: {path.name} — see attachments]"


def _load_audio_or_video(path: Path) -> str:
    raise NotImplementedError(
        f"Audio/video loading not implemented yet for {path.name}. "
        "Transcribe externally (whisper, hyperframes transcribe, etc.) "
        "and pass the resulting .txt or .md instead."
    )


def _load_html(path: Path) -> str:
    raise NotImplementedError(
        f"HTML loading not implemented yet for {path.name}. "
        "Install `beautifulsoup4` and add a loader, or paste the article body as .md."
    )


LOADERS: dict[str, Callable[[Path], str]] = {
    ".txt": _load_text,
    ".md": _load_text,
    ".markdown": _load_text,
    ".pdf": _load_pdf,
    ".png": _load_image,
    ".jpg": _load_image,
    ".jpeg": _load_image,
    ".webp": _load_image,
    ".mp3": _load_audio_or_video,
    ".mp4": _load_audio_or_video,
    ".m4a": _load_audio_or_video,
    ".wav": _load_audio_or_video,
    ".html": _load_html,
    ".htm": _load_html,
}


# Which extensions are passed as binary attachments (vs. text)
ATTACHMENT_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}


def mime_for(path: Path) -> str:
    """Best-guess MIME type for an attachment-supported file."""
    suffix = path.suffix.lower()
    return {
        ".pdf":  "application/pdf",
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(suffix, "application/octet-stream")


def load_document(path: Path) -> str:
    """Load a document to plain text. Raises NotImplementedError for unsupported types."""
    suffix = path.suffix.lower()
    loader = LOADERS.get(suffix)
    if loader is None:
        raise ValueError(
            f"No loader registered for {suffix!r}. Supported: {sorted(LOADERS)}"
        )
    return loader(path)
