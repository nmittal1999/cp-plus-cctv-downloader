# Third-party components

## go2rtc

go2rtc v1.9.14, Copyright AlexxIT and contributors, MIT license.

- Upstream: https://github.com/AlexxIT/go2rtc/tree/v1.9.14
- License: `runtime/go2rtc/LICENSE.txt`
- Changes: `patches/go2rtc-v1.9.14-replay.patch`
- Browser player base: `runtime/go2rtc/player/video-rtc.js`, modified from upstream's browser player.

## FFmpeg

FFmpeg binaries are not committed or included as release assets. Users obtain them from the upstream distribution. The tested Windows runtime was Gyan's 9.0.2 essentials build, licensed under GPL v3.

- Builds, license, and source information: https://www.gyan.dev/ffmpeg/builds/
- FFmpeg: https://ffmpeg.org/

Retain the downloaded distribution's license and build information. This application invokes FFmpeg and FFprobe as separate processes.

## Packaged Python application

Building with PyInstaller includes Python and the PyInstaller bootloader.

- Python license: https://www.python.org/psf/license/
- PyInstaller license and bootloader exception: https://pyinstaller.org/en/stable/license.html

These runtime components are not present in the source-only release.
