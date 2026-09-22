import assert from "node:assert/strict";
import test from "node:test";

import { assetFileCategory, assetFileCategoryLabel, classifyImportedFile, fileExtension, inferAssetFileMimeType, safeOriginalFileName } from "../src/lib/asset-file.ts";

test("known preview media keep their native asset kinds", () => {
    assert.equal(classifyImportedFile({ name: "photo.JPG", type: "image/jpeg" }), "image");
    assert.equal(classifyImportedFile({ name: "clip.mov", type: "video/quicktime" }), "video");
    assert.equal(classifyImportedFile({ name: "voice.m4a", type: "audio/mp4" }), "audio");
    assert.equal(classifyImportedFile({ name: "track.mp3", type: "audio/mp3" }), "audio");
    assert.equal(classifyImportedFile({ name: "track.flac", type: "audio/x-flac" }), "audio");
    assert.equal(classifyImportedFile({ name: "photo.jpg", type: "application/octet-stream" }), "image");
});

test("unsupported, active, and unknown formats remain generic files", () => {
    assert.equal(classifyImportedFile({ name: "photo.heic", type: "image/heic" }), "file");
    assert.equal(classifyImportedFile({ name: "diagram.svg", type: "image/svg+xml" }), "file");
    assert.equal(classifyImportedFile({ name: "movie.mkv", type: "video/x-matroska" }), "file");
    assert.equal(classifyImportedFile({ name: "renamed.png", type: "text/html" }), "file");
    assert.equal(classifyImportedFile({ name: "README", type: "" }), "file");
});

test("generic file metadata preserves useful type and category information", () => {
    assert.equal(fileExtension("draft.v3.PDF"), "pdf");
    assert.equal(fileExtension(".env"), "");
    assert.equal(inferAssetFileMimeType({ name: "paper.pdf", type: "" }), "application/pdf");
    assert.equal(inferAssetFileMimeType({ name: "records.jsonl", type: "" }), "application/x-ndjson");
    assert.equal(inferAssetFileMimeType({ name: "photo.jpg", type: "image/jpg" }), "image/jpeg");
    assert.equal(inferAssetFileMimeType({ name: "payload.bin", type: "application/x-custom" }), "application/x-custom");
    assert.equal(assetFileCategory("paper.pdf"), "document");
    assert.equal(assetFileCategory("records.csv"), "data");
    assert.equal(assetFileCategory("source.ts"), "code");
    assert.equal(assetFileCategory("scene.glb"), "model");
    assert.equal(assetFileCategoryLabel("archive"), "压缩包");
});

test("original names are reduced to one safe filename", () => {
    assert.equal(safeOriginalFileName("../secret:report.pdf"), "secret-report.pdf");
    assert.equal(safeOriginalFileName("folder\\notes.txt"), "notes.txt");
    assert.equal(safeOriginalFileName(".."), "文件");
});
