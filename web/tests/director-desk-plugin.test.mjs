import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import React from "react";

const webRoot = process.cwd();
const repositoryRoot = path.resolve(webRoot, "..");
const pluginEntry = path.join(repositoryRoot, "plugins/canvas/director-desk/src/index.tsx");
const pluginSource = readFileSync(pluginEntry, "utf8");

async function importBundle(options) {
    const bundle = await build({
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        alias: { "@": path.join(webRoot, "src") },
        define: {
            __APP_VERSION__: JSON.stringify("test"),
            "import.meta.env.VITE_DOC_URL": JSON.stringify(""),
            "import.meta.env.VITE_PLUGIN_REGISTRY_URL": JSON.stringify(""),
        },
        ...options,
    });
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
    return import(moduleUrl);
}

async function loadDirectorPluginModule() {
    return importBundle({ entryPoints: [pluginEntry] });
}

function canvasNode(id, type, metadata = {}, title = id) {
    return {
        id,
        type,
        title,
        position: { x: 10, y: 20 },
        width: 340,
        height: 240,
        metadata,
    };
}

test("director desk exposes an inert project node and durable navigation contract", async () => {
    const module = await loadDirectorPluginModule();
    const plugin = module.default({ React });
    const definition = plugin.nodes[0];

    assert.equal(plugin.id, "director-desk");
    assert.equal(plugin.version, "1.0.0");
    assert.equal(definition.type, "director-desk:project");
    assert.equal(definition.hidePanel, true);
    assert.equal(definition.interactionToggle, true);
    assert.equal(definition.defaultMetadata.interactive, false);
    assert.equal("useBuiltinPanel" in definition, false);
    assert.equal("run" in definition, false);
    assert.equal(module.directorProjectStorageKey("node 7"), "project:node 7");
    assert.equal(module.directorRecentProjectStorageKey("node 7"), "recent:node 7");
    assert.equal(module.buildDirectorDeskRoute("node/7", "/canvas/project?tab=1#shot"), "/director?instanceId=node%2F7&returnTo=%2Fcanvas%2Fproject%3Ftab%3D1%23shot");
    assert.equal(module.buildDirectorDeskIframeSource("node/7", "dark"), "/director-runtime.html?embedded=1&instanceId=node%2F7");
    assert.equal(module.buildDirectorDeskIframeSource("node/7", "light"), "/director-runtime.html?embedded=1&instanceId=node%2F7");
    assert.deepEqual(definition.resource(canvasNode("director", definition.type, { content: "asset://localhost/capture.webp" })), {
        kind: "image",
        url: "asset://localhost/capture.webp",
    });
    assert.equal(definition.resource(canvasNode("director", definition.type)), null);
    assert.match(pluginSource, /const \[frameClosed, setFrameClosed\] = React\.useState\(false\)/u);
    assert.match(pluginSource, /const showFrame = !frameClosed && \(ctx\.isSelected \|\| !lastCapture\)/u);
    assert.match(pluginSource, /message\.type === "close"[\s\S]*?setFrameClosed\(true\)/u);
    assert.match(pluginSource, /"打开导演台"/u);
});

test("director desk selects only the first connected image as panorama input", async () => {
    const module = await loadDirectorPluginModule();
    const nodes = [
        canvasNode("copy", "text", { content: "not an image" }),
        canvasNode("panorama-a", "image", { content: "asset://localhost/panorama-a.jpg", mimeType: "image/jpeg" }, "主场景"),
        canvasNode("panorama-b", "image", { content: "asset://localhost/panorama-b.webp", mimeType: "image/webp" }, "备用场景"),
    ];
    const connections = [
        { id: "edge-copy", fromNodeId: "copy", toNodeId: "director" },
        { id: "edge-a", fromNodeId: "panorama-a", toNodeId: "director" },
        { id: "edge-b", fromNodeId: "panorama-b", toNodeId: "director" },
    ];

    assert.deepEqual(module.findDirectorPanoramaInput("director", nodes, connections), {
        edgeId: "edge-a",
        sourceNodeId: "panorama-a",
        imageUrl: "asset://localhost/panorama-a.jpg",
        fileName: "主场景.jpg",
    });
    assert.equal(module.findDirectorPanoramaInput("unconnected", nodes, connections), null);
});

test("bundled director desk stays available when the remote official registry is offline", async () => {
    const registry = await importBundle({ entryPoints: [path.join(webRoot, "src/lib/canvas/plugin-registry.ts")] });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("offline");
    };
    try {
        const entries = await registry.fetchOfficialPlugins("https://registry.invalid/official-plugins.json");
        assert.deepEqual(entries, registry.BUNDLED_OFFICIAL_PLUGINS);
        assert.equal(entries[0].id, "director-desk");
        assert.equal(entries[0].url, "builtin:director-desk");
        assert.equal(entries[0].bundled, true);
        assert.equal(typeof (await registry.loadBundledOfficialPluginExport(entries[0].url)), "function");
    } finally {
        globalThis.fetch = previousFetch;
    }
});

test("installing the bundled official entry records it disabled until the user enables it", async () => {
    const loaderEntry = path.join(webRoot, "tests/.director-desk-loader-entry.ts");
    const module = await importBundle({
        stdin: {
            contents: [
                `export { installPluginFromUrl, setPluginEnabled, uninstallPlugin } from ${JSON.stringify(path.join(webRoot, "src/lib/canvas/plugin-loader.ts"))};`,
                `export { getNodeDefinition } from ${JSON.stringify(path.join(webRoot, "src/lib/canvas/node-registry.ts"))};`,
                `export { usePluginStore } from ${JSON.stringify(path.join(webRoot, "src/stores/canvas/use-plugin-store.ts"))};`,
            ].join("\n"),
            resolveDir: webRoot,
            sourcefile: loaderEntry,
        },
    });
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const styles = new Map();
    const localStorage = new Map();
    globalThis.window = {
        localStorage: {
            getItem: (key) => localStorage.get(key) ?? null,
            setItem: (key, value) => localStorage.set(key, value),
            removeItem: (key) => localStorage.delete(key),
        },
    };
    globalThis.document = {
        getElementById: (id) => styles.get(id) ?? null,
        createElement: () => ({ id: "", dataset: {}, textContent: "", remove() {} }),
        head: { appendChild: (style) => style.id && styles.set(style.id, style) },
    };

    try {
        module.usePluginStore.persist.setOptions({
            storage: {
                getItem: () => null,
                setItem: () => undefined,
                removeItem: () => undefined,
            },
        });
        module.usePluginStore.setState({ plugins: [] });
        const plugin = await module.installPluginFromUrl("builtin:director-desk", { official: true });
        const installed = module.usePluginStore.getState().plugins[0];

        assert.equal(plugin.id, "director-desk");
        assert.equal(installed.url, "builtin:director-desk");
        assert.equal(installed.source, "");
        assert.equal(installed.official, true);
        assert.equal(installed.enabled, false);
        assert.equal(module.getNodeDefinition("director-desk:project"), undefined);

        await module.setPluginEnabled(installed, true);
        assert.equal(module.usePluginStore.getState().plugins[0].enabled, true);
        assert.equal(module.getNodeDefinition("director-desk:project").type, "director-desk:project");

        await module.setPluginEnabled(module.usePluginStore.getState().plugins[0], false);
        assert.equal(module.usePluginStore.getState().plugins[0].enabled, false);
        assert.equal(module.getNodeDefinition("director-desk:project"), undefined);
        module.uninstallPlugin("director-desk");
    } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
    }
});
