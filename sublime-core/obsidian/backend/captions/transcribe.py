"""Run cached OpenAI Whisper locally and emit bounded JSON timestamps."""

import json
import hashlib
import importlib
import io
import re
import sys
from contextlib import redirect_stdout
from pathlib import Path


def verify_cached_checkpoint(url, download_root):
    url_parts = url.rstrip("/").split("/")
    if len(url_parts) < 2:
        raise RuntimeError("The Whisper package did not provide a recognized checkpoint URL.")
    expected_hash = url_parts[-2]
    checkpoint = Path(download_root) / url_parts[-1]
    if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        raise RuntimeError("The Whisper package did not provide a recognized checkpoint hash.")
    if not checkpoint.is_file():
        raise RuntimeError(f"The cached Whisper model is missing: {checkpoint}")
    digest = hashlib.sha256()
    with checkpoint.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_hash:
        raise RuntimeError(f"The cached Whisper model failed its SHA-256 check: {checkpoint}")
    return str(checkpoint), digest.hexdigest()


def cached_checkpoint(url, download_root, in_memory=False):
    if in_memory:
        raise RuntimeError("In-memory model downloads are disabled.")
    checkpoint, _ = verify_cached_checkpoint(url, download_root)
    return checkpoint


def check_model(model_name, model_directory):
    try:
        import whisper
    except ImportError as error:
        raise RuntimeError("Install openai-whisper in the configured local Python environment.") from error
    url = whisper._MODELS.get(model_name)
    if not url:
        raise RuntimeError(f"Unsupported Whisper model: {model_name}")
    checkpoint, digest = verify_cached_checkpoint(url, model_directory)
    if whisper.load_model.__globals__.get("_download") is None:
        raise RuntimeError("The installed Whisper version does not expose a supported cache-only loader.")
    return {"verified": True, "model": model_name, "path": checkpoint, "sha256": digest}


def emit_event(enabled, event, output_stream=None):
    if enabled:
        print(json.dumps(event, ensure_ascii=False), file=output_stream or sys.stdout, flush=True)


def install_whisper_progress_hook(whisper, enabled, output_stream=None):
    if not enabled:
        return lambda: None
    event_stream = output_stream or sys.stdout
    transcribe_module = importlib.import_module("whisper.transcribe")
    original_tqdm = transcribe_module.tqdm.tqdm

    class ProgressTqdm(original_tqdm):
        def __init__(self, *args, **kwargs):
            # Keep tqdm's real counters while suppressing its terminal animation.
            kwargs["file"] = io.StringIO()
            super().__init__(*args, **kwargs)

        def update(self, n=1):
            previous = self.n
            changed = super().update(n)
            if self.n != previous and self.total and self.n is not None:
                emit_event(True, {
                    "type": "progress",
                    "stage": "transcribing",
                    "description": "Whisper processed audio frames.",
                    "current": min(int(self.n), int(self.total)),
                    "total": int(self.total),
                }, event_stream)
            return changed

    transcribe_module.tqdm.tqdm = ProgressTqdm
    return lambda: setattr(transcribe_module.tqdm, "tqdm", original_tqdm)


def main():
    if len(sys.argv) == 4 and sys.argv[1] == "--check":
        print(json.dumps(check_model(sys.argv[2], sys.argv[3])))
        return
    progress_enabled = len(sys.argv) == 5 and sys.argv[1] == "--progress"
    if progress_enabled:
        audio_path, model_name, model_directory = sys.argv[2:]
    elif len(sys.argv) == 4:
        audio_path, model_name, model_directory = sys.argv[1:]
    else:
        raise SystemExit("Expected audio path, model name, and local model directory.")
    try:
        import whisper
    except ImportError as error:
        raise SystemExit("Install openai-whisper in the configured local Python environment.") from error

    # Whisper's normal loader downloads missing or invalid checkpoints. Replace
    # its downloader with a cache-only resolver and validate the model hash so
    # this path cannot fetch a checkpoint during transcription.
    loader_globals = whisper.load_model.__globals__
    if "_download" not in loader_globals:
        raise SystemExit("The installed Whisper version does not expose a supported cache-only loader; refusing transcription.")
    loader_globals["_download"] = cached_checkpoint
    with redirect_stdout(sys.stderr):
        model = whisper.load_model(model_name, device="cpu", download_root=model_directory)

    emit_event(progress_enabled, {
        "type": "stage",
        "phase": "complete",
        "stage": "loading_model",
    })
    progress_output = sys.stdout
    restore_progress_hook = install_whisper_progress_hook(whisper, progress_enabled, progress_output)
    emit_event(progress_enabled, {
        "type": "stage",
        "phase": "start",
        "stage": "transcribing",
        "description": "Whisper is processing the extracted audio locally.",
    })
    try:
        with redirect_stdout(sys.stderr):
            result = model.transcribe(
                audio_path,
                fp16=False,
                word_timestamps=True,
                condition_on_previous_text=False,
                # Whisper's real frame counter is enabled only for progress-stream requests.
                verbose=False if progress_enabled else None,
            )
    finally:
        restore_progress_hook()
    emit_event(progress_enabled, {
        "type": "stage",
        "phase": "complete",
        "stage": "transcribing",
    })

    segments = []
    for segment in result.get("segments", []):
        words = []
        for word in segment.get("words", []):
            try:
                start = float(word["start"])
                end = float(word["end"])
                text = str(word["word"]).strip()
            except (KeyError, TypeError, ValueError):
                continue
            if text and end > start:
                words.append({"text": text, "start": start, "end": end})
        try:
            start = float(segment["start"])
            end = float(segment["end"])
            text = str(segment["text"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if text and end > start:
            segments.append({"text": text, "start": start, "end": end, "words": words})
        if len(segments) > 5000:
            raise SystemExit("Transcript contains too many segments.")

    print(json.dumps({"duration": float(result.get("duration") or 0), "segments": segments}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
