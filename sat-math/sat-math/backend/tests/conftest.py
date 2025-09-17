import os
import sys


def _ensure_backend_root_on_path() -> None:
    tests_dir = os.path.dirname(__file__)
    backend_root = os.path.abspath(os.path.join(tests_dir, ".."))
    if backend_root not in sys.path:
        sys.path.insert(0, backend_root)


_ensure_backend_root_on_path()
