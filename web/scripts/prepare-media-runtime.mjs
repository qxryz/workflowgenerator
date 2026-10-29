import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
// Offline media composer, pinned sources, no host Homebrew dylibs.
const sources = [
    { name: "ffmpeg", version: "8.0.1", archive: "ffmpeg-8.0.1.tar.xz", directory: "ffmpeg-8.0.1", sha256: "05ee0b03119b45c0bdb4df654b96802e909e0a752f72e4fe3794f487229e5a41", url: "https://ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz" },
    {
        name: "x264",
        version: "b35605ace3ddf7c1a5d67a2eb553f034aef41d55",
        archive: "x264.tar.gz",
        directory: "x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55",
        sha256: "cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9",
        url: "https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz",
    },
];
if (process.platform !== "darwin") throw new Error("The bundled media runtime build currently targets macOS.");
const target = resolve("src-tauri/runtime/media"),
    cache = resolve(process.env.WG_MEDIA_BUILD_DIR || tmpdir(), "wg-media-runtime-8.0.1-" + process.arch),
    prefix = resolve(cache, "install");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const signature = hash(JSON.stringify({ sources, platform: process.platform, arch: process.arch, buildScript: hash(await readFile(new URL(import.meta.url))), notice: hash(await readFile(resolve("third-party/media-runtime-NOTICE.md"))) }));
try {
    const old = JSON.parse(await readFile(resolve(target, "manifest.json"), "utf8"));
    const binariesMatch = old.sha256 === hash(await readFile(resolve(target, "ffmpeg"))) && old.ffprobeSha256 === hash(await readFile(resolve(target, "ffprobe")));
    const sourceChecks = await Promise.all(sources.map(async (source) => hash(await readFile(resolve(target, "sources", source.archive))) === source.sha256));
    for (const name of ["NOTICE.md", "FFmpeg-COPYING.GPLv2", "x264-COPYING", "sources/build.mjs"]) await access(resolve(target, name));
    if (old.signature === signature && binariesMatch && sourceChecks.every(Boolean)) {
        console.log("Media runtime already verified");
        process.exit(0);
    }
} catch {}
process.env.MACOSX_DEPLOYMENT_TARGET = "12.0";
await mkdir(cache, { recursive: true });
await mkdir(target, { recursive: true });
function run(file, args, cwd = cache, env = process.env) {
    execFileSync(file, args, { cwd, env, stdio: "inherit" });
}
for (const source of sources) {
    const archive = resolve(cache, source.archive);
    let bytes;
    try {
        bytes = await readFile(archive);
    } catch {}
    if (!bytes || hash(bytes) !== source.sha256) {
        run("curl", ["--fail", "--location", "--retry", "2", source.url, "--output", archive]);
        bytes = await readFile(archive);
    }
    if (hash(bytes) !== source.sha256) throw new Error(source.name + " source checksum mismatch");
    run("tar", ["xf", archive]);
}
const xdir = resolve(cache, sources[1].directory),
    fdir = resolve(cache, sources[0].directory);
async function cleanConfiguredBuild(directory, configuration) {
    try { await access(resolve(directory, configuration)); } catch { return; }
    run("make", ["distclean"], directory);
}
await cleanConfiguredBuild(xdir, "config.mak");
await cleanConfiguredBuild(fdir, "ffbuild/config.mak");
run("./configure", ["--prefix=" + prefix, "--enable-static", "--disable-cli", "--disable-opencl", "--bit-depth=8", "--chroma-format=420"], xdir);
run("make", ["-j4"], xdir);
run("make", ["install"], xdir);
const env = { ...process.env, PKG_CONFIG_PATH: resolve(prefix, "lib/pkgconfig") };
run(
    "./configure",
    [
        "--prefix=/usr/local",
        "--disable-autodetect",
        "--disable-everything",
        "--disable-shared",
        "--enable-static",
        "--disable-doc",
        "--disable-debug",
        "--disable-network",
        "--disable-ffplay",
        "--enable-ffmpeg",
        "--enable-ffprobe",
        "--enable-gpl",
        "--enable-libx264",
        "--enable-zlib",
        "--enable-swscale",
        "--enable-protocol=file,pipe",
        "--enable-demuxer=image2,image_png_pipe,image_jpeg_pipe,image_webp_pipe,mov,concat,wav,mp3,aac,flac,ogg,matroska,srt",
        "--enable-decoder=png,mjpeg,webp,h264,hevc,vp8,vp9,aac,mp3,mp3float,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,flac,vorbis,opus,alac,subrip",
        "--enable-parser=png,mjpeg,webp,h264,hevc,vp8,vp9,aac,mpegaudio,flac,opus,vorbis",
        "--enable-encoder=libx264,aac,png,movtext,wrapped_avframe,pcm_s16le",
        "--enable-muxer=mp4,image2,null",
        "--enable-bsf=h264_mp4toannexb,aac_adtstoasc",
        "--enable-filter=scale,format,null,fps,pad,setsar,trim,setpts,zoompan,aresample,aformat,atrim,asetpts,volume,adelay,amix,apad,anullsrc,alimiter,blackdetect",
        "--pkg-config-flags=--static",
    ],
    fdir,
    env,
);
run("make", ["-j4"], fdir, env);
for (const binary of ["ffmpeg", "ffprobe"]) {
    const path = resolve(fdir, binary);
    const libs = execFileSync("otool", ["-L", path], { encoding: "utf8" })
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(" ")[0])
        .filter(Boolean);
    if (libs.some((lib) => !lib.startsWith("/usr/lib/") && !lib.startsWith("/System/Library/"))) throw new Error("Encoder links a non-system dynamic library");
    await copyFile(path, resolve(target, binary));
}
for (const [flag, required] of [
    ["-encoders", ["libx264", "aac", "png", "mov_text", "wrapped_avframe"]],
    ["-decoders", ["h264", "aac", "subrip", "png", "mjpeg", "webp", "pcm_s16le"]],
    ["-filters", ["zoompan", "amix", "alimiter", "blackdetect", "aresample"]],
    ["-bsfs", ["h264_mp4toannexb", "aac_adtstoasc"]],
    ["-demuxers", ["png_pipe", "jpeg_pipe", "webp_pipe", "concat", "wav", "srt"]],
]) {
    const listing = execFileSync(resolve(target, "ffmpeg"), ["-hide_banner", flag], { encoding: "utf8" });
    for (const component of required) if (!listing.split(/\s+/).includes(component)) throw new Error(`Missing media component: ${component}`);
}
await mkdir(resolve(target, "sources"), { recursive: true });
for (const source of sources) await copyFile(resolve(cache, source.archive), resolve(target, "sources", source.archive));
await copyFile(resolve(fdir, "COPYING.GPLv2"), resolve(target, "FFmpeg-COPYING.GPLv2"));
await copyFile(resolve(xdir, "COPYING"), resolve(target, "x264-COPYING"));
await copyFile(resolve("third-party/media-runtime-NOTICE.md"), resolve(target, "NOTICE.md"));
await copyFile(new URL(import.meta.url), resolve(target, "sources/build.mjs"));
await writeFile(
    resolve(target, "manifest.json"),
    JSON.stringify({ signature, sha256: hash(await readFile(resolve(target, "ffmpeg"))), ffprobeSha256: hash(await readFile(resolve(target, "ffprobe"))), platform: process.platform, arch: process.arch, sources }, null, 2),
);
console.log("Prepared FFmpeg 8.0.1 and x264 with matching source archives");
