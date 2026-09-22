import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeAppLanguage, translate } from "../src/lib/i18n.ts";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("app language normalization keeps existing users on Chinese and accepts English", () => {
    assert.equal(normalizeAppLanguage(undefined), "zh-CN");
    assert.equal(normalizeAppLanguage("zh-CN"), "zh-CN");
    assert.equal(normalizeAppLanguage("en-US"), "en-US");
    assert.equal(normalizeAppLanguage("fr-FR"), "zh-CN");
});

test("English messages interpolate values and unknown copy falls back safely", () => {
    assert.equal(translate("en-US", "工作流"), "Workflows");
    assert.equal(translate("en-US", "已导入 {count} 个文件", { count: 3 }), "Imported 3 files");
    assert.equal(translate("en-US", "用户自己的标题"), "用户自己的标题");
    assert.equal(translate("zh-CN", "已导入 {count} 个文件", { count: 3 }), "已导入 3 个文件");
});

test("English catalog does not silently overwrite duplicate message keys", () => {
    const source = readSource("../src/lib/i18n.ts");
    const keys = [...source.matchAll(/^\s*"([^"]+)":/gmu)].map((match) => match[1]);
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual([...new Set(duplicates)], []);
});

test("language preference is persisted and drives both app and Ant Design locales", () => {
    const configStore = readSource("../src/stores/use-config-store.ts");
    const configPanel = readSource("../src/components/layout/app-config-modal.tsx");
    const providers = readSource("../src/components/layout/app-providers.tsx");

    assert.match(configStore, /language: AppLanguage/u);
    assert.match(configStore, /language: "zh-CN"/u);
    assert.match(configStore, /language: normalizeAppLanguage\(config\.language\)/u);
    assert.match(configPanel, /updateConfig\("language", language\)/u);
    assert.match(configPanel, /value: "en-US", label: "English"/u);
    assert.match(providers, /language === "en-US" \? enUS : zhCN/u);
    assert.match(providers, /document\.documentElement\.lang = language/u);
});
