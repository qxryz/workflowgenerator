import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("desktop external links use the scoped Tauri opener", () => {
    const cargo = readSource("../src-tauri/Cargo.toml");
    const rustApp = readSource("../src-tauri/src/lib.rs");
    const capability = JSON.parse(readSource("../src-tauri/capabilities/default.json")) as { permissions: unknown[] };
    const externalLinks = readSource("../src/services/external-links.ts");
    const appProviders = readSource("../src/components/layout/app-providers.tsx");

    assert.match(cargo, /tauri-plugin-opener = "2"/u);
    assert.match(rustApp, /\.plugin\(tauri_plugin_opener::init\(\)\)/u);
    assert.ok(capability.permissions.includes("opener:allow-open-url"));
    assert.ok(capability.permissions.includes("opener:allow-default-urls"));
    assert.ok(!capability.permissions.includes("opener:default"));
    assert.match(externalLinks, /plugin:opener\|open_url/u);
    assert.match(externalLinks, /export async function openExternalUrl/u);
    assert.match(externalLinks, /window\.open\(url\.toString\(\), "_blank", "noopener,noreferrer"\)/u);
    assert.match(externalLinks, /new Set\(\["http:", "https:", "mailto:", "tel:"\]\)/u);
    assert.match(externalLinks, /anchor\.target\.toLowerCase\(\) !== "_blank"/u);
    assert.match(appProviders, /installDesktopExternalLinkHandler\(\)/u);
    assert.match(appProviders, /无法打开链接，请检查系统默认浏览器后重试。/u);
});
