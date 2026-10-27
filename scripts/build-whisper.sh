#!/usr/bin/env bash
# Build whisper.cpp's whisper-server for the desktop installers (release
# wave, 2026-10-27): Vulkan GPU backend + every CPU variant, loaded at run
# time (GGML_BACKEND_DL) — no GPU / no Vulkan driver → the CPU backend.
# Output: resources/whisper/ (whisper-server[.exe] + its shared libraries),
# shipped by electron-builder as extraResources → <resources>/whisper.
#   scripts/build-whisper.sh            # Vulkan + CPU (CI: Vulkan SDK / libvulkan-dev + glslc)
#   scripts/build-whisper.sh --cpu-only # no Vulkan toolchain needed (local smoke tests)
set -euo pipefail
VERSION="v1.9.5"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/build/whisper-src/whisper.cpp-${VERSION#v}"
OUT="$ROOT/resources/whisper"
VULKAN=ON
[ "${1:-}" = "--cpu-only" ] && VULKAN=OFF

if [ ! -d "$SRC" ]; then
	mkdir -p "$ROOT/build/whisper-src"
	curl -fsSL "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${VERSION}.tar.gz" | tar -xz -C "$ROOT/build/whisper-src"
fi

cmake -S "$SRC" -B "$SRC/build" \
	-DCMAKE_BUILD_TYPE=Release \
	-DBUILD_SHARED_LIBS=ON \
	-DGGML_BACKEND_DL=ON \
	-DGGML_CPU_ALL_VARIANTS=ON \
	-DGGML_NATIVE=OFF \
	-DGGML_VULKAN="$VULKAN" \
	-DGGML_OPENMP=OFF \
	-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded \
	-DWHISPER_BUILD_SERVER=ON \
	-DWHISPER_BUILD_TESTS=OFF \
	-DWHISPER_BUILD_EXAMPLES=ON \
	-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON \
	-DCMAKE_INSTALL_RPATH='$ORIGIN'
cmake --build "$SRC/build" --config Release --target whisper-server -j "$(nproc 2>/dev/null || echo 4)"

# whisper-server plus every shared library next to it (backends load from
# the executable's own directory). Windows multi-config builds land in
# bin/Release.
BIN="$SRC/build/bin"
[ -d "$BIN/Release" ] && BIN="$BIN/Release"
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$BIN"/whisper-server* "$OUT"/
find "$SRC/build" \( -name '*.so' -o -name '*.so.*' -o -name '*.dll' \) -exec cp -L {} "$OUT"/ \;
# whisper.cpp / ggml are MIT — the notice ships with the binaries.
cp "$SRC/LICENSE" "$OUT/LICENSE-whisper.cpp.txt"
ls -la "$OUT"
