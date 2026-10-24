"""Compatibility entry point for the packaged Copernicus Marine downloader."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from ghana_upwelling.cli import main


if __name__ == "__main__":
    raise SystemExit(main())
