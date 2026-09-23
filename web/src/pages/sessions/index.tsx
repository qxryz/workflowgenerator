import { useAppTranslation } from "@/hooks/use-app-translation";
import { useState } from "react";
import { Drawer } from "antd";
import { Streamdown } from "streamdown";
import { ZodiacSessionList } from "@/components/agent/zodiac-session-list";
import type { ZodiacListedSession } from "@/services/zodiac-session-storage";

export default function ZodiacSessionsPage() {
    const { t } = useAppTranslation();
    const [preview, setPreview] = useState<ZodiacListedSession | null>(null);
    return (
        <main className="flex h-full min-w-0 flex-col bg-[color:var(--wg-home-bg)] text-[color:var(--wg-home-text)]">
            <ZodiacSessionList variant="page" archivedOnly onPreview={setPreview} />
            <Drawer rootClassName="wg-session-surface" title={preview?.title || t("对话记录")} open={!!preview} onClose={() => setPreview(null)} width={640}>
                <p className="mb-6 text-xs opacity-50">
                    {preview?.workspaceTitle} · {t("已归档")}
                </p>
                {preview?.items
                    .filter((item) => item.text && ["user", "assistant", "error"].includes(item.role || ""))
                    .map((item) => (
                        <div key={item.id} className={`mb-5 ${item.role === "user" ? "ml-12 rounded-xl bg-black/5 p-4 dark:bg-white/5" : "mr-4"}`}>
                            <p className="mb-1 text-xs opacity-45">{item.role === "user" ? t("你") : "Zodiac"}</p>
                            <Streamdown>{item.text || ""}</Streamdown>
                        </div>
                    ))}
            </Drawer>
        </main>
    );
}
