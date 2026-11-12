"""Lazy access to the reloadable application configuration.

``app.config`` is read from the environment at import time and tests (and operators using a
profile switch) reload it. A module that binds ``from ..config import VALUE`` at import time keeps
the *stale* value forever; a module that binds the module object keeps a stale module object.
Resolving the module through :mod:`sys.modules` on every read avoids both traps.
"""
from __future__ import annotations

import importlib

_CONFIG_MODULE = __name__.rpartition(".")[0] + ".config"


def app_config():
    """Return the *current* ``app.config`` module object."""
    return importlib.import_module(_CONFIG_MODULE)
