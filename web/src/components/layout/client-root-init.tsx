import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createPresetChannel, useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { readLinkedConfig } from "@/lib/link-config";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const linked = readLinkedConfig(window.location.search);
        if (!linked.hadParams) return;
        handledConfigParams.current = true;
        window.history.replaceState(null, "", `${window.location.pathname}${linked.cleanedSearch ? `?${linked.cleanedSearch}` : ""}${window.location.hash}`);
        if (linked.invalidBaseUrl) {
            message.warning("链接中的接口地址不安全，未导入");
            return;
        }
        if (!linked.baseUrl) {
            message.warning("链接中的 API Key 不会被导入，请在设置中填写");
            openConfigDialog(false);
            return;
        }
        const linkedBaseUrl = linked.baseUrl;
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                baseUrl: linkedBaseUrl,
                                apiKey: "",
                            }
                          : channel,
                  )
                : [{ ...createPresetChannel("free"), baseUrl: linkedBaseUrl, apiKey: "" }],
        );
        updateConfig("baseUrl", linkedBaseUrl);
        updateConfig("apiKey", "");
        openConfigDialog(false);
        message.success(linked.hadApiKey ? "已导入接口地址；API Key 请在设置中填写" : "已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}
