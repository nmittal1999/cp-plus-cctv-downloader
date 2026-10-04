$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$buildRoot = Join-Path $projectRoot '.build'
$archivePath = Join-Path $buildRoot 'go2rtc-v1.9.14.zip'
$sourceRoot = Join-Path $buildRoot 'go2rtc-1.9.14'
$outputPath = Join-Path $projectRoot 'runtime\go2rtc\go2rtc-speed.exe'
Get-Command go, git -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
if (-not (Test-Path -LiteralPath $sourceRoot)) {
    Invoke-WebRequest 'https://github.com/AlexxIT/go2rtc/archive/refs/tags/v1.9.14.zip' -OutFile $archivePath
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualHash -ne 'A7A4E68F0B6269A5273B1C0E2F4105A7AD1459251640EEF6ED8D3B010A7F1885') {
        throw 'The go2rtc source archive checksum differs from the tested archive.'
    }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $buildRoot
}
$patchMarker = Join-Path $sourceRoot '.replay-patch-applied'
if (-not (Test-Path -LiteralPath $patchMarker)) {
    Push-Location $sourceRoot
    try {
        git apply --check (Join-Path $projectRoot 'patches\go2rtc-v1.9.14-replay.patch')
        if ($LASTEXITCODE -ne 0) { throw 'Replay patch validation failed.' }
        git apply (Join-Path $projectRoot 'patches\go2rtc-v1.9.14-replay.patch')
        if ($LASTEXITCODE -ne 0) { throw 'Replay patch application failed.' }
        Set-Content -LiteralPath $patchMarker -Value 'v0.0.1'
    } finally { Pop-Location }
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'tests\scale_test.go') -Destination (Join-Path $sourceRoot 'pkg\rtsp\scale_test.go') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'tests\replay_timing_test.go') -Destination (Join-Path $sourceRoot 'pkg\mp4\replay_timing_test.go') -Force
Push-Location $sourceRoot
try {
    go test ./pkg/rtsp -run TestPlaybackScaleOnWire -count=1
    if ($LASTEXITCODE -ne 0) { throw 'RTSP Scale regression check failed.' }
    go test ./pkg/mp4 -run TestRecordedFrameGap -count=1
    if ($LASTEXITCODE -ne 0) { throw 'Recorded frame timing regression check failed.' }
    go build -trimpath -ldflags '-s -w' -o $outputPath .
    if ($LASTEXITCODE -ne 0) { throw 'Streaming build failed.' }
} finally { Pop-Location }
Write-Host 'Streaming component built.'
