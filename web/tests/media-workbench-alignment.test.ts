import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const historySource = readFileSync(new URL("../src/components/media-workbench-history.tsx", import.meta.url), "utf8");
const modeTabsSource = readFileSync(new URL("../src/components/media-workbench-mode-tabs.tsx", import.meta.url), "utf8");
const audioSource = readFileSync(new URL("../src/pages/audio/index.tsx", import.meta.url), "utf8");
const seedanceSource = readFileSync(new URL("../src/pages/seedance-2-5/index.tsx", import.meta.url), "utf8");
const assetPickerSource = readFileSync(new URL("../src/components/canvas/asset-picker-modal.tsx", import.meta.url), "utf8");
const imageSource = readFileSync(new URL("../src/pages/image/index.tsx", import.meta.url), "utf8");
const videoSource = readFileSync(new URL("../src/pages/video/index.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

test("audio and SD2.5 reuse the standard media generation history anatomy", () => {
    assert.match(historySource, /\{t\("生成记录"\)\}/u);
    assert.match(historySource, /t\(managing \? "完成" : "多选"\)/u);
    assert.match(historySource, /t\("新创作"\)/u);
    assert.match(historySource, /t\(allSelected \? "取消全选" : "全选"\)/u);
    assert.match(historySource, /t\("删除（\{count\}）", \{ count: selectedCount \}\)/u);
    assert.match(historySource, /wg-media-history-thumb/u);
    assert.match(audioSource, /<MediaWorkbenchHistory/u);
    assert.match(audioSource, /countLabel=\{t\("\{count\} 条音频创作", \{ count: logs\.length \}\)\}/u);
    assert.match(audioSource, /selectedLogIds/u);
    assert.match(audioSource, /deleteSelectedLogs/u);
    assert.match(seedanceSource, /<MediaWorkbenchHistory/u);
    assert.match(seedanceSource, /countLabel=\{`\$\{records\.length\} 条 SD2\.5 创作`\}/u);
    assert.match(seedanceSource, /selectedRecordIds/u);
    assert.match(seedanceSource, /deleteSelectedRecords/u);
    assert.match(seedanceSource, /border-t border-\[color:var\(--wg-studio-line\)\][\s\S]*?创作草稿/u);
});

test("audio shares the SD2.5 result frame, mode tabs, and standard model inspector chrome", () => {
    assert.match(audioSource, /<div className="wg-media-workbench-preview">[\s\S]*?<AudioResult/u);
    assert.match(seedanceSource, /<div className="wg-media-workbench-preview">/u);
    assert.match(styles, /\.wg-media-workbench-preview\s*\{[\s\S]*?min-height:\s*270px[\s\S]*?border:\s*1px dashed/u);
    assert.match(modeTabsSource, /role="tablist"/u);
    assert.match(modeTabsSource, /relative flex h-14 flex-1/u);
    assert.match(modeTabsSource, /absolute inset-x-3 bottom-0 h-0\.5/u);
    assert.match(audioSource, /<MediaWorkbenchModeTabs ariaLabel="音频创作模式"/u);
    assert.match(seedanceSource, /<MediaWorkbenchModeTabs ariaLabel="Seedance 2\.5 创作模式"/u);
    assert.match(audioSource, /<ModelPicker[\s\S]*?capability="audio"[\s\S]*?fullWidth/u);
    assert.match(audioSource, /按当前模型与任务调整可用选项/u);
    assert.match(audioSource, /qwenAudioNativeRoute/u);
    assert.match(audioSource, /miniMaxNativeRoute/u);
    assert.match(audioSource, /POST \{route\.path\}/u);
    assert.match(audioSource, /接口文档 ↗/u);
});

test("audio and SD2.5 import prompts and compatible local assets like the image and video workbenches", () => {
    for (const source of [imageSource, videoSource, audioSource, seedanceSource]) {
        assert.match(source, /<PromptSelectDialog/u);
        assert.match(source, /<AssetPickerModal/u);
        assert.match(source, /提示词库/u);
        assert.match(source, /我的资产/u);
    }
    assert.match(audioSource, /task === "speech" \? \["text"\] : \["audio"\]/u);
    assert.match(audioSource, /payload\.storageKey \|\| staged\?\.storageKey/u);
    assert.match(audioSource, /new File\(\[blob\], audioAssetFilename/u);
    assert.match(audioSource, /assertMiniMaxCloneAudioDuration\(file\)/u);
    assert.match(seedanceSource, /mode === "generate" && inputMode !== "reference" \? \["text", "image"\]/u);
    assert.match(seedanceSource, /payload\.kind === "text"/u);
    assert.match(seedanceSource, /payload\.kind === "image"/u);
    assert.match(seedanceSource, /payload\.kind === "video"/u);
    assert.match(seedanceSource, /setAudioReferences/u);
    assert.match(seedanceSource, /requestVideoGeneration\(requestConfig, requestPrompt, references, referenceVideos, audioReferences\)/u);
    assert.match(seedanceSource, /audioReferences: record\.audioReferences\?\.map/u);
    assert.match(seedanceSource, /resolveMediaUrl\(audio\.storageKey, audio\.url\)/u);
    assert.match(assetPickerSource, /acceptedKinds\?: readonly AssetKind\[\]/u);
    assert.match(assetPickerSource, /acceptedKindSet\.has\(a\.kind\)/u);
    assert.match(assetPickerSource, /visibleKindOptions/u);
    assert.doesNotMatch(imageSource, /acceptedKinds=/u);
    assert.doesNotMatch(videoSource, /acceptedKinds=/u);
});
