import { useState } from "react";
import { Drawer } from "antd";
import { Streamdown } from "streamdown";
import { ZodiacSessionList } from "@/components/agent/zodiac-session-list";
import type { ZodiacListedSession } from "@/services/zodiac-session-storage";

export default function ZodiacSessionsPage() {
    const [preview, setPreview] = useState<ZodiacListedSession | null>(null);
    return (
        <main className="flex h-full min-w-0 flex-col bg-[color:var(--wg-home-bg)] text-[color:var(--wg-home-text)]">
            <header className="border-b border-[color:var(--wg-home-line)] px-7 py-5">
                <h1 className="text-xl font-semibold">对话</h1>
                <p className="mt-1 text-sm opacity-50">所有已归档的对话</p>
            </header>
            <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col p-6">
                <ZodiacSessionList archivedOnly onPreview={setPreview} />
            </div>
            <Drawer title={preview?.title || "对话记录"} open={!!preview} onClose={() => setPreview(null)} width={640}>
                <p className="mb-6 text-xs opacity-50">{preview?.workspaceTitle} · 已保存</p>
                {preview?.items
                    .filter((item) => item.text && ["user", "assistant", "error"].includes(item.role || ""))
                    .map((item) => (
                        <div key={item.id} className={`mb-5 ${item.role === "user" ? "ml-12 rounded-xl bg-black/5 p-4 dark:bg-white/5" : "mr-4"}`}>
                            <p className="mb-1 text-xs opacity-45">{item.role === "user" ? "你" : "Zodiac"}</p>
                            <Streamdown>{item.text || ""}</Streamdown>
                        </div>
                    ))}
            </Drawer>
        </main>
    );
}
