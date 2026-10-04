import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
HERE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
MEDIA = HERE / "runtime" / "ffmpeg" / "bin"


def run_process(command, cancel):
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    while True:
        try:
            output, errors = process.communicate(timeout=0.25)
            return process.returncode, output, errors
        except subprocess.TimeoutExpired:
            if cancel.is_set():
                process.kill()
                process.communicate()
                raise InterruptedError("Export cancelled. Any partial MP4 is kept in the clips folder.")


def export_stream(recorder, channel, start, end, target, cancel, report):
    recorder.describe(recorder.url(channel, start, end))
    duration = (end - start).total_seconds()
    url = recorder.url(channel, start, end, credentials=True)
    ffmpeg, ffprobe = MEDIA / "ffmpeg.exe", MEDIA / "ffprobe.exe"
    if not ffmpeg.exists() or not ffprobe.exists():
        raise RuntimeError("The bundled video components are missing. Keep the runtime folder beside the app.")
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
               "-rtsp_transport", "tcp", "-timeout", "15000000", "-fflags", "+genpts",
               "-i", url, "-t", str(duration), "-map", "0:v:0", "-map", "0:a:0?",
               "-avoid_negative_ts", "make_zero"]
    report("Saving the selected recording stream…", None)
    code, _, _ = run_process(command + ["-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", str(target)], cancel)
    if code:
        report("Saving with compatible video encoding…", None)
        code, _, _ = run_process(command + ["-c:v", "libx264", "-preset", "fast", "-crf", "20",
                                           "-c:a", "aac", "-movflags", "+faststart", str(target)], cancel)
    if code:
        raise RuntimeError("The recording stream could not be saved. Check the camera/time and whether recorded RTSP playback is supported. Any partial MP4 is kept.")
    code, output, _ = run_process([str(ffprobe), "-v", "error", "-show_entries",
        "format=duration:stream=codec_type", "-of", "json", str(target)], cancel)
    info = json.loads(output) if not code else {}
    if not any(stream.get("codec_type") == "video" for stream in info.get("streams", [])):
        raise RuntimeError("The exported file could not be verified as a video.")
    length = float(info.get("format", {}).get("duration", 0))
    if length < max(0.5, duration - 2):
        raise RuntimeError(f"Only {length:.1f} seconds of the requested {duration:.0f} seconds were returned. The partial MP4 is kept for review.")
    return length
