import hashlib
import io
import json
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import transcribe
from transcribe import cached_checkpoint, verify_cached_checkpoint


class CachedModelVerificationTests(unittest.TestCase):
    def test_accepts_only_checkpoint_with_expected_sha256(self):
        payload = b"disposable model fixture"
        expected = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "base.pt"
            checkpoint.write_bytes(payload)
            url = f"https://models.example/{expected}/base.pt"
            verified_path, digest = verify_cached_checkpoint(url, directory)
            self.assertEqual(verified_path, str(checkpoint))
            self.assertEqual(digest, expected)
            self.assertEqual(cached_checkpoint(url, directory), str(checkpoint))

    def test_rejects_missing_corrupt_and_in_memory_checkpoints_without_fetching(self):
        expected = hashlib.sha256(b"expected").hexdigest()
        url = f"https://models.example/{expected}/base.pt"
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "missing"):
                cached_checkpoint(url, directory)
            (Path(directory) / "base.pt").write_bytes(b"corrupt")
            with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                cached_checkpoint(url, directory)
            with self.assertRaisesRegex(RuntimeError, "In-memory"):
                cached_checkpoint(url, directory, in_memory=True)


class WhisperProgressHookTests(unittest.TestCase):
    def test_hook_reports_actual_tqdm_frame_updates_and_restores_original_class(self):
        class FakeTqdm:
            def __init__(self, total=None, file=None):
                self.total = total
                self.n = 0
                self.file = file

            def update(self, n=1):
                self.n += n
                # tqdm returns False when it skipped a redraw, despite real counter progress.
                return False

        tqdm_namespace = types.SimpleNamespace(tqdm=FakeTqdm)
        fake_module = types.SimpleNamespace(tqdm=tqdm_namespace)
        stdout = io.StringIO()
        redirected_stdout = io.StringIO()
        with patch.object(transcribe.importlib, "import_module", return_value=fake_module):
            with patch.object(transcribe.sys, "stdout", stdout):
                restore = transcribe.install_whisper_progress_hook(object(), True, stdout)
                progress = tqdm_namespace.tqdm(total=80)
                with redirect_stdout(redirected_stdout):
                    progress.update(17)
                restore()
        event = json.loads(stdout.getvalue())
        self.assertEqual(event, {
            "type": "progress",
            "stage": "transcribing",
            "description": "Whisper processed audio frames.",
            "current": 17,
            "total": 80,
        })
        self.assertEqual(redirected_stdout.getvalue(), "")
        self.assertIs(tqdm_namespace.tqdm, FakeTqdm)
        self.assertIsInstance(progress.file, io.StringIO)


if __name__ == "__main__":
    unittest.main()
