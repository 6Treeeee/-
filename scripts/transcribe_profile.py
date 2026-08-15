"""Generate timestamped public-video transcripts with local faster-whisper.

The output is a resumable raw artifact. It contains no media URLs or credentials.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from faster_whisper import WhisperModel


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--media-dir", default="artifacts/douyin/media")
    parser.add_argument("--output", default="artifacts/douyin/transcripts.raw.json")
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--compute-type", default=None)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def confidence(avg_logprob: float | None) -> float | None:
    if avg_logprob is None or not math.isfinite(avg_logprob):
        return None
    return round(max(0.0, min(1.0, math.exp(avg_logprob))), 4)


def clean_text(value: str) -> str:
    # Some CTranslate2/Whisper tokenizer combinations emit U+FFFD where a
    # punctuation token should be. Preserve the clause boundary without
    # presenting a corrupt Unicode replacement glyph as recognized speech.
    return value.replace("\ufffd", "，").strip()


def write_output(path: Path, output: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    args = parse_args()
    media_dir = Path(args.media_dir).resolve()
    output_path = Path(args.output).resolve()
    compute_type = args.compute_type or ("float16" if args.device == "cuda" else "int8")
    existing: dict = {}
    if output_path.exists():
        existing = json.loads(output_path.read_text(encoding="utf-8"))

    output = {
        "schema_version": "1.0",
        "started_at": existing.get("started_at", utc_now()),
        "updated_at": utc_now(),
        "engine": "faster-whisper",
        "model": args.model,
        "device": args.device,
        "compute_type": compute_type,
        "transcripts": existing.get("transcripts", {}),
        "failures": existing.get("failures", []),
    }

    paths = sorted(media_dir.glob("*.mp4"))
    if args.only:
        requested = set(args.only)
        paths = [path for path in paths if path.stem in requested]
    if not paths:
        raise SystemExit(f"No matching MP4 media found in {media_dir}")

    model_started = time.perf_counter()
    model = WhisperModel(args.model, device=args.device, compute_type=compute_type)
    print(json.dumps({
        "event": "model_loaded",
        "model": args.model,
        "device": args.device,
        "compute_type": compute_type,
        "seconds": round(time.perf_counter() - model_started, 2),
    }))

    for path in paths:
        aweme_id = path.stem
        if aweme_id in output["transcripts"] and not args.only and not args.force:
            print(json.dumps({"event": "skipped_existing", "aweme_id": aweme_id}))
            continue
        started = time.perf_counter()
        try:
            generated, info = model.transcribe(
                str(path),
                language="zh",
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
                # Disabling prompt carry-over prevents long-form timestamp windows
                # from silently dropping clauses while still preserving context via
                # the short domain prompt below.
                condition_on_previous_text=False,
                initial_prompt="智能体，人工智能，县城经济，创业，商业思维，实体商家，获客，产品流程PPT，产品验证，交付。",
            )
            normalized_segments = []
            texts = []
            for segment in generated:
                text = clean_text(segment.text)
                if not text:
                    continue
                texts.append(text)
                normalized_segments.append({
                    "start_ms": round(segment.start * 1000),
                    "end_ms": round(segment.end * 1000),
                    "text": text,
                    "confidence": confidence(segment.avg_logprob),
                    "no_speech_probability": round(segment.no_speech_prob, 4),
                })

            elapsed = time.perf_counter() - started
            transcript = {
                "status": "complete",
                "text": "".join(texts),
                "segments": normalized_segments,
                "language": info.language,
                "language_probability": round(info.language_probability, 4),
                "duration_seconds": round(info.duration, 3),
                "method": "local_faster_whisper_asr",
                "model": args.model,
                "device": args.device,
                "compute_type": compute_type,
                "transcribed_at": utc_now(),
                "processing_seconds": round(elapsed, 3),
                "confidence": {
                    "kind": "segment_log_probability",
                    "mean": round(sum(
                        item["confidence"] for item in normalized_segments
                        if item["confidence"] is not None
                    ) / max(1, sum(
                        1 for item in normalized_segments if item["confidence"] is not None
                    )), 4),
                },
                "limitations": [
                    "ASR text can contain recognition or punctuation errors.",
                    "Confidence is derived from model segment log probabilities, not independently calibrated accuracy.",
                ],
            }
            output["transcripts"][aweme_id] = transcript
            output["failures"] = [item for item in output["failures"] if item.get("aweme_id") != aweme_id]
            print(json.dumps({
                "event": "transcribed",
                "aweme_id": aweme_id,
                "media_seconds": transcript["duration_seconds"],
                "processing_seconds": transcript["processing_seconds"],
                "segments": len(normalized_segments),
            }))
        except Exception as error:  # keep the profile run isolated per video
            output["failures"] = [item for item in output["failures"] if item.get("aweme_id") != aweme_id]
            output["failures"].append({
                "aweme_id": aweme_id,
                "error_type": type(error).__name__,
                "message": str(error)[:500],
                "failed_at": utc_now(),
            })
            print(json.dumps({
                "event": "transcription_failed",
                "aweme_id": aweme_id,
                "error_type": type(error).__name__,
                "message": str(error)[:500],
            }))
        finally:
            output["updated_at"] = utc_now()
            write_output(output_path, output)


if __name__ == "__main__":
    main()
