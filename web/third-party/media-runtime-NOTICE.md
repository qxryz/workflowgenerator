# FFmpeg and x264

The macOS application includes a separate FFmpeg executable for local motion
preview encoding and local episode composition (video, audio and switchable
subtitle tracks). It is built from FFmpeg 8.0.1 and x264 revision
`b35605ace3ddf7c1a5d67a2eb553f034aef41d55`, with GPL components enabled.

- FFmpeg: https://ffmpeg.org/ — copyright the FFmpeg developers, GPL-2.0-or-later for this build.
- x264: https://www.videolan.org/developers/x264.html — copyright the x264 project authors, GPL-2.0-or-later.

The application bundle's `Contents/Resources/runtime/media/` directory contains
the license texts, build manifest, and matching unmodified source archives under
`sources/`, together with the build script. These components are provided without
warranty. They run as a separate local process and do not send media over a network.

Maintainers can reproduce the macOS encoder with
`node scripts/prepare-media-runtime.mjs` from `web/` using Xcode command line tools,
Node.js, make, and pkg-config. The build verifies source checksums and rejects
non-system dynamic dependencies. The binaries and source archives are packaging
artifacts, not checked-in source files.
