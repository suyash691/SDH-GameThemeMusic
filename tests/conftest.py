"""Mocks for Decky Loader runtime dependencies."""
import sys
import os
import tempfile
from unittest.mock import MagicMock

# Create a temp dir for plugin runtime
_tmp = tempfile.mkdtemp(prefix="gtm_test_")

# Mock the decky module before main.py imports it
decky_mock = MagicMock()
decky_mock.DECKY_PLUGIN_DIR = os.path.join(_tmp, "plugin")
decky_mock.DECKY_PLUGIN_RUNTIME_DIR = os.path.join(_tmp, "runtime")
decky_mock.DECKY_PLUGIN_SETTINGS_DIR = os.path.join(_tmp, "settings")
sys.modules["decky"] = decky_mock

# Mock the settings module
settings_mock = MagicMock()


class FakeSettingsManager:
    def __init__(self, name="", settings_directory=""):
        self._data = {}

    def setSetting(self, key, value):
        self._data[key] = value

    def getSetting(self, key, default=None):
        return self._data.get(key, default)


settings_mock.SettingsManager = FakeSettingsManager
sys.modules["settings"] = settings_mock

# Create required directories
os.makedirs(decky_mock.DECKY_PLUGIN_DIR, exist_ok=True)
os.makedirs(decky_mock.DECKY_PLUGIN_RUNTIME_DIR, exist_ok=True)
os.makedirs(decky_mock.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
os.makedirs(os.path.join(decky_mock.DECKY_PLUGIN_RUNTIME_DIR, "music"), exist_ok=True)
os.makedirs(os.path.join(decky_mock.DECKY_PLUGIN_RUNTIME_DIR, "cache"), exist_ok=True)
