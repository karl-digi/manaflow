#!/usr/bin/env python3
"""Regression test: snapshot results writing must not persist execd tokens.

The runtime smoke injects a freshly generated disposable execd token per
clone via PVE_EXECD_TOKEN_FILE; the results writer must never write
``execd-token-<snapshotId>.txt`` files into the results directory (which is
uploaded as a GitHub artifact).

Usage: uv run python scripts/test-snapshot-pvelxc-results.py
"""

from __future__ import annotations

import importlib.util
import inspect
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# Synthetic 64-hex fixture (never a real token).
SYNTHETIC_TOKEN = "ab" * 32


def load_snapshot_pvelxc() -> object:
    sys.path.insert(0, str(SCRIPT_DIR))
    spec = importlib.util.spec_from_file_location(
        "snapshot_pvelxc_results_test", SCRIPT_DIR / "snapshot-pvelxc.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(
            "could not create import spec for scripts/snapshot-pvelxc.py"
        )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


MODULE = load_snapshot_pvelxc()
WRITE_RESULTS_JSON = MODULE._write_results_json

SAMPLE_RESULTS = [
    {
        "presetId": "standard",
        "snapshotId": "snapshot_abc123",
        "templateVmid": 9001,
        "capturedAt": "2026-08-16T00:00:00Z",
        "node": "pve1",
        "vcpus": 4,
        "memoryMib": 8192,
        "diskSizeMib": 131072,
    }
]


class ResultsWriterTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write(self, *, mode: str = "snapshot") -> Path:
        out_path = self.tmp_path / "results.json"
        kwargs = dict(
            out_path=out_path,
            mode=mode,
            base_template_vmid=9000,
            ide_provider="cmux-code",
            results_payload=SAMPLE_RESULTS,
        )
        if "execd_tokens" in inspect.signature(WRITE_RESULTS_JSON).parameters:
            # Regression guard: if a snapshot-token persistence parameter is
            # reintroduced, exercise it so the no-token-file assertion below
            # fails instead of silently passing.
            kwargs["execd_tokens"] = {9001: SYNTHETIC_TOKEN}
        WRITE_RESULTS_JSON(**kwargs)
        return out_path

    def test_results_json_written_without_execd_token_files(self) -> None:
        out_path = self._write()
        self.assertTrue(out_path.is_file())
        self.assertFalse(list(self.tmp_path.glob("execd-token-*.txt")))

    def test_core_result_data_preserved(self) -> None:
        out_path = self._write()
        data = json.loads(out_path.read_text(encoding="utf-8"))
        self.assertEqual(data["schemaVersion"], 1)
        self.assertEqual(data["mode"], "snapshot")
        self.assertEqual(data["baseTemplateVmid"], 9000)
        self.assertEqual(data["ideProvider"], "cmux-code")
        self.assertIn("generatedAt", data)
        self.assertEqual(len(data["results"]), 1)
        result = data["results"][0]
        self.assertEqual(result["presetId"], "standard")
        self.assertEqual(result["snapshotId"], "snapshot_abc123")
        self.assertEqual(result["templateVmid"], 9001)
        self.assertEqual(result["memoryMib"], 8192)
        self.assertNotIn("token", result)

    def test_update_mode_results_written_without_execd_token_files(self) -> None:
        out_path = self._write(mode="update")
        data = json.loads(out_path.read_text(encoding="utf-8"))
        self.assertEqual(data["mode"], "update")
        self.assertEqual(data["results"][0]["presetId"], "standard")
        self.assertFalse(list(self.tmp_path.glob("execd-token-*.txt")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
