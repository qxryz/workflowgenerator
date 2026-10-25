import { App } from "antd";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { useStartRun } from "@/hooks/use-drama";
import type { StartRunOptions } from "@/lib/drama/authoring/run";
import type { DramaRun } from "@/lib/drama/types";
import { isAiConfigReady, useConfigStore } from "@/stores/use-config-store";

/** The one way a button starts an AI text task: checks the text model, reports failures, and says when it is busy. */
export function useStartTask() {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const startRun = useStartRun();
    const [pending, setPending] = useState(false);

    /** Resolves with the new run, or undefined when it could not start (the user has been told why). */
    const start = async (options: Omit<StartRunOptions, "onChange">): Promise<DramaRun | undefined> => {
        if (!isAiConfigReady(config, options.model || config.textModel || config.model)) {
            message.error(t("还没有可用的文本模型，请先在「模型与渠道」里配置"));
            useConfigStore.getState().openConfigDialog(true, "channels");
            return undefined;
        }
        setPending(true);
        try {
            return (await startRun(options)).run;
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("任务没能开始，请重试"));
            return undefined;
        } finally {
            setPending(false);
        }
    };
    return { start, pending };
}
