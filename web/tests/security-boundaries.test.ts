import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readResponseBytes } from "../src/lib/limited-response.ts";

function source(relativePath: string) {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("official Markdown and SVG plugins sanitize markup before inserting it", () => {
    const markdown = source("../../plugins/canvas/markdown/src/index.tsx");
    const svg = source("../../plugins/canvas/svg/src/index.tsx");
    const sanitizer = source("../../plugins/canvas/security/sanitize-markup.ts");

    assert.match(markdown, /sanitizeMarkdownHtml\(marked\.parse\(key,/u);
    assert.match(svg, /sanitizeSvgMarkup\(/u);
    assert.match(sanitizer, /"script"/u);
    assert.match(sanitizer, /"foreignobject"|SAFE_SVG_TAGS/u);
    assert.match(sanitizer, /attribute\.name\.toLowerCase\(\)/u);
    assert.match(sanitizer, /!safeLink\(href\)/u);
});

test("remote publisher catalogs are signed and official plugin bundles are hash-pinned", () => {
    const publisher = source("../src/services/publisher-signature.ts");
    const authorCatalog = source("../src/services/author-library/catalog.ts");
    const pluginCatalog = source("../src/lib/canvas/plugin-registry.ts");
    const pluginLoader = source("../src/lib/canvas/plugin-loader.ts");
    const serverPublisher = source("../server/src/publisher.rs");
    const pluginBuild = source("../../plugins/canvas/registry/build.mjs");

    // Verification moved out of the desktop binary and into the HTTP server.
    assert.match(publisher, /\/api\/publisher\/verify/u);
    assert.match(authorCatalog, /fetchSignedPublisherText/u);
    assert.match(pluginCatalog, /fetchSignedPublisherText/u);
    assert.match(pluginBuild, /sha256/u);
    assert.match(pluginLoader, /expectedSha256/u);
    assert.match(pluginLoader, /import\.meta\.env\?\.DEV && import\.meta\.env\?\.VITE_ENABLE_UNSAFE_PLUGINS/u);
    assert.match(pluginLoader, /只允许安装经过签名校验的官方插件/u);
    assert.match(serverPublisher, /minisign_verify::PublicKey/u);
});

test("remote response reads use one absolute timeout for the whole download", async () => {
    let chunks = 0;
    const response = new Response(
        new ReadableStream<Uint8Array>({
            async pull(controller) {
                await new Promise((resolve) => setTimeout(resolve, 12));
                if (chunks >= 4) {
                    controller.close();
                    return;
                }
                chunks += 1;
                controller.enqueue(new Uint8Array([chunks]));
            },
        }),
    );
    await assert.rejects(() => readResponseBytes(response, 1024, "too large", 30), /读取下载内容超时/u);
});
