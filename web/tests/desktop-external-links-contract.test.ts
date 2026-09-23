import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("external links open only allowlisted protocols with opener isolation", () => {
    const externalLinks = readSource("../src/services/external-links.ts");
    const appProviders = readSource("../src/components/layout/app-providers.tsx");
    const desktopMain = readSource("../src-tauri/src/main.rs");
    const appTopNav = readSource("../src/components/layout/app-top-nav.tsx");
    const channelEditor = readSource("../src/components/layout/channel-editor-drawer.tsx");

    // `noopener,noreferrer` plus a per-call protocol allowlist is what keeps a
    // `javascript:` or `file:` URL from a catalog or a user paste from being
    // handed to the browser as a navigation target.
    assert.match(externalLinks, /export async function openExternalUrl/u);
    assert.match(externalLinks, /new Set\(\["http:", "https:", "mailto:", "tel:"\]\)/u);
    assert.match(externalLinks, /window\.open\(url\.toString\(\), "_blank", "noopener,noreferrer"\)/u);
    assert.match(desktopMain, /\.on_new_window\(\|url, _\|/u);
    assert.match(desktopMain, /Command::new\("\/usr\/bin\/open"\)/u);
    assert.match(appTopNav, /openExternalUrl\(EXPLORE_URL\)/u);
    assert.match(channelEditor, /openExternalUrl\(keyUrl\)/u);
    assert.match(channelEditor, /bailian\.console\.aliyun\.com\/cn-beijing\/model\/settings\/api-key/u);
    assert.doesNotMatch(externalLinks, /location\.href\s*=/u);
    assert.match(appProviders, /无法打开链接，请检查系统默认浏览器后重试。/u);
    assert.match(appProviders, /DESKTOP_EXTERNAL_LINK_ERROR_EVENT/u);
});
