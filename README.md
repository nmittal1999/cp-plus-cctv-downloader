# CP Plus CCTV Downloader

**v0.0.2** — a local web interface for viewing and exporting recorded footage from compatible CP Plus recorders.

## Features

- Camera names and channel numbers loaded from the recorder, with a refresh button.
- Select multiple cameras and a shared start/end time using the recorder's local clock.
- View up to 16 streams in a responsive grid, with independent and shared playback controls.
- A shared playback clock waits for cameras to buffer; enable audio for one camera at a time.
- Stream recorded H.265 video through go2rtc without video re-encoding.
- Playback speeds: 0.5×, 1×, 2×, 4×, and 8×.
- Per-camera and shared clip timelines.
- Seeking and speed changes preserve pause state.
- Queue separate MP4 exports for selected cameras, with two concurrent exports and individual cancellation.
- Thumbnails are temporarily disabled pending a speed and accuracy rework.
- A scrollable layout that adapts to narrower windows.

## Compatibility

Developed against a **CP-UNR-4K5164-FI** using recorded RTSP playback and HTTPS camera discovery. H.265 preview and 2× playback were verified in Microsoft Edge on Windows. The fixed timeline and paused seeking were also verified. Multi-camera playback was verified by the user. Recorder, network, and browser capacity determine how many full-resolution streams are practical. Other recorder models and all speed settings need their own playback checks.

Non-normal speeds use video only; return to 1× for audio. Browser H.265 support varies, so use Edge for the tested configuration.

Preview streams video; it does not download a clip first. Export copies the original video when possible and converts audio to AAC. If stream-copy export fails, the exporter retries with H.264 encoding.

## Synchronization limitations

The shared clock aligns browser playback and waits for buffering; it cannot guarantee matching original recording timestamps. The tested recorder can return footage before the requested start and did not provide ONVIF replay timestamps in the metadata check. **Early footage (seconds)** advances an affected camera relative to the shared clock. A camera starting at 11:59:57 for a 12:00:00 request needs a 3-second adjustment. This is manual and must be checked again after seeking. Adjustments affect preview only, not exports. Frame-accurate automatic alignment remains future work.

## Run from source

Requires Windows, Python 3.14 or later, and the runtime components below. Application code uses the Python standard library; no KVMS installation or vendor SDK is required.

1. Build the modified go2rtc component with `Build Streaming.ps1` (requires Git and Go 1.24+).
2. Download the [FFmpeg Windows essentials archive](https://www.gyan.dev/ffmpeg/builds/) and extract it so these files exist:

   ```text
   runtime/ffmpeg/bin/ffmpeg.exe
   runtime/ffmpeg/bin/ffprobe.exe
   ```

   Keep the archive's license and build information alongside the executables. The tested runtime used the Gyan 9.0.2 essentials build.
3. Run `python web_server.py`.
4. Enter your recorder address and login in the page opened in Edge. The web port defaults to 80; discovery also tries HTTPS on port 443. Playback uses RTSP port 554 by default.

The UI runs at `http://127.0.0.1:8765/`, with its streaming component at `http://127.0.0.1:1986/`. This version is configured for access from the same computer, not phones or other computers.

Credentials stay in application memory; they are not written to configuration files. Use **Disconnect** or **Close app** to clear the recorder session. Closing the browser tab alone leaves the local app running. The recorder HTTPS client accepts the configured appliance's self-signed certificate and refuses redirects; it does not provide certificate identity verification.

## Build the Windows application

Once the runtime components are present:

```powershell
python -m venv .buildenv
.buildenv\Scripts\python.exe -m pip install -r requirements-build.txt
.buildenv\Scripts\python.exe -m PyInstaller --noconfirm --onefile --windowed --name "Camera Clips" --distpath . --workpath .build/python --specpath .build --paths . --add-data "web;web" web_server.py
```

Run **Open Camera Clips.cmd**. Keep the `runtime` directory beside `Camera Clips.exe`. The packaged app includes Python, so users do not need a separate Python installation.

This release publishes source and build instructions. Recorder footage, credentials, local defaults, and runtime binaries are excluded from the repository.

## Streaming modifications

The patch in `patches/go2rtc-v1.9.14-replay.patch` adds optional RTSP `Scale` requests and preserves video frame gaps of up to 60 seconds in MP4 packaging. Fast replay from the tested recorder sends sparse frames; upstream's one-second timing cutoff collapsed these gaps and prevented browser playback.

The bundled browser player uses a fixed recording duration, preserves paused positions, and grows its incoming data buffer as needed. Speed changes and unbuffered seeking reopen the recording at the requested recorder-local timestamp, which can cause a brief pause. Recorder keyframe spacing can affect the first displayed frame after a seek.

## Checks

```powershell
python tests/check_discovery.py
python tests/check_rpc_discovery.py
python tests/check_web.py
```

These checks use local fixtures, not real recorder credentials. The streaming build also runs regression checks for the RTSP Scale header and recorded-frame timing.

See [third-party notices](THIRD_PARTY_NOTICES.md) for component licenses and sources.

## Verification

Run the Python fixture checks in `tests/` with Python, and the `.cjs` checks with Node.js. Tests use fake recorder data and do not require credentials. Real recorder timestamp alignment and resource limits require hardware testing.
