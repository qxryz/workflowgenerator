import { saveAs } from "file-saver";

import { normalizeAiConfig, useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function stripConfigCredentials(config: AiConfig): AiConfig {
    return {
        ...config,
        apiKey: "",
        channels: config.channels.map((channel) => ({ ...channel, apiKey: "" })),
    };
}

export function sanitizeImportedConfig(config: AiConfig) {
    let strippedScripts = 0;
    const channels = config.channels.map((channel) => ({
        ...channel,
        apiKey: "",
        models: channel.models.map((model) => {
            if (!("script" in model)) return { ...model };
            const { script: _script, ...safeModel } = model;
            strippedScripts += 1;
            return safeModel;
        }),
    }));
    return {
        config: { ...config, apiKey: "", channels },
        strippedScripts,
    };
}

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = {
        app: "infinite-canvas",
        version: 1,
        exportedAt: new Date().toISOString(),
        config: stripConfigCredentials(config),
        webdav: { ...webdav, password: "" },
        promptSources: { sources, schedule },
    };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "workflowgenerator-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error("配置文件格式不正确");
    }
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav || !data.promptSources) throw new Error("配置文件格式不正确");
    const sanitized = sanitizeImportedConfig(data.config);
    useConfigStore.setState({
        config: normalizeAiConfig(sanitized.config),
        webdav: { ...data.webdav, password: "" },
    });
    usePromptSourceStore.setState(data.promptSources);
    return { strippedScripts: sanitized.strippedScripts };
}
