import { App, Button, Switch } from "antd";
import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useConfigStore } from "@/stores/use-config-store";
import { getZodiacRuntimeMonitor, revealAppData, revealWorkspace, type ZodiacRuntimeMonitor } from "@/services/server-storage";

const labels: Record<string, string> = { busy: "运行中", retry: "重试中", idle: "待命", stopped: "已停止", unavailable: "暂时无法连接" };
export function ConfigRunConnections() {
    const { message } = App.useApp();
    const config = useConfigStore(s => s.config);
    const updateConfig = useConfigStore(s => s.updateConfig);
    const [monitor, setMonitor] = useState<ZodiacRuntimeMonitor | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout>;
        const refresh = async () => {
            try { const next = await getZodiacRuntimeMonitor(); if (alive) { setMonitor(next); setError(""); } }
            catch { if (alive) setError("运行状态暂时不可用"); }
            finally { if (alive) timer = setTimeout(refresh, 3000); }
        };
        void refresh();
        return () => { alive = false; clearTimeout(timer); };
    }, []);
    const reveal = async (kind: "data" | "workspace") => {
        try { await (kind === "data" ? revealAppData() : revealWorkspace()); }
        catch (error) { message.error(error instanceof Error ? error.message : "无法打开访达"); }
    };
    return <div className="space-y-8">
        <section aria-labelledby="local-storage-heading">
            <h3 id="local-storage-heading" className="text-sm font-semibold">数据与文件</h3>
            <div className="mt-3 divide-y divide-stone-200 rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                {[{ kind: "data" as const, title: "应用数据", text: "Zodiac 数据根目录，统一保存配置、会话、媒体和运行文件。", path: monitor?.dataDirectory },
                    { kind: "workspace" as const, title: "Zodiac 工作空间", text: "Runtime 实际使用的目录，保存技能、脚本、中间文件和产物。", path: monitor?.workspace }].map(row =>
                    <div key={row.kind} className="flex flex-wrap items-start justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1"><h4 className="text-sm font-medium">{row.title}</h4><p className="mt-1 text-xs leading-5 opacity-60">{row.text}</p><p className="mt-2 break-all font-mono text-xs opacity-60">{row.path || (error ? "位置暂时不可用" : "正在读取位置…")}</p></div>
                        <Button icon={<FolderOpen className="size-4" />} onClick={() => void reveal(row.kind)}>在访达中打开</Button>
                    </div>)}
            </div>
        </section>
        <section aria-labelledby="runtime-heading">
            <div className="flex items-center justify-between"><h3 id="runtime-heading" className="text-sm font-semibold">Zodiac Runtime</h3><span role="status" className="text-xs opacity-60">{error || (monitor ? `${monitor.sessions.length} / ${monitor.capacity} 个会话进程` : "正在读取…")}</span></div>
            <p className="mt-2 text-xs leading-5 opacity-60">发送消息时启动，空闲时可释放进程。收起聊天或切换页面不影响运行；退出应用会停止执行，文件与会话记录保留。</p>
            {monitor?.sessions.length ? <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800"><table className="w-full text-left text-xs"><thead className="bg-stone-500/5"><tr>{["会话目录", "进程", "状态", "待审批", "应用工具"].map(title => <th key={title} className="px-3 py-2 font-medium">{title}</th>)}</tr></thead><tbody>{monitor.sessions.map(session => <tr key={session.sessionId} className="border-t border-stone-200 dark:border-stone-800"><td className="max-w-96 break-all px-3 py-3 font-mono">{session.directory}</td><td className="px-3">{session.pid || "—"}</td><td className="whitespace-nowrap px-3">{session.waitingUser ? "等待回复" : labels[session.status] || session.status}</td><td className="px-3">{session.approvals}</td><td className="px-3">{session.pendingTools}</td></tr>)}</tbody></table></div> : <p className="mt-3 rounded-xl bg-stone-500/5 p-4 text-sm opacity-60">{error ? "无法读取会话进程" : monitor ? "暂无会话进程" : "正在读取会话进程…"}</p>}
            <details className="mt-4 rounded-xl border border-stone-200 p-4 dark:border-stone-800"><summary className="cursor-pointer text-sm font-medium">工作空间结构</summary><dl className="mt-3 space-y-3 text-xs leading-5"><div><dt className="font-mono">config /</dt><dd className="opacity-60">应用数据库，保存模型渠道、设置、画布与会话。通过应用修改渠道，无需手工编辑配置文件。</dd></div><div><dt className="font-mono">media /</dt><dd className="opacity-60">应用管理的原始媒体与资产。</dd></div>
                <div><dt className="font-mono">workspace / workflows / 工作流 / sessions / 会话</dt><dd className="opacity-60">每段会话独立的工作目录。新会话使用新目录；归档不会删除文件，恢复会话继续使用原目录。</dd></div>
                <div><dt className="font-mono">skills /</dt><dd className="opacity-60">位于会话目录中，保存可用技能的完整文件包。</dd></div>
                <div><dt className="font-mono">.hilo /</dt><dd className="opacity-60">位于会话目录中，保存画布素材副本与媒体索引，供脚本读取。</dd></div>
                <div><dt className="font-mono">~/.zodiac/runtimes /</dt><dd className="opacity-60">保存运行配置、日志和原生会话记录，与 workspace 中的工作文件分开保存。</dd></div>
            </dl></details>
        </section>
        <section className="border-t border-stone-200 pt-6 dark:border-stone-800" aria-labelledby="private-network-media-heading">
            <div className="flex items-start justify-between gap-6"><div><h3 id="private-network-media-heading" className="text-sm font-semibold">允许私有网络媒体下载</h3><p className="mt-2 text-xs leading-5 opacity-60">使用本机、局域网媒体服务或 Fake-IP / TUN 代理时开启。默认关闭。</p></div><Switch checked={config.allowPrivateNetworkMedia} onChange={value => updateConfig("allowPrivateNetworkMedia", value)} aria-label="允许私有网络媒体下载" /></div>
            {config.allowPrivateNetworkMedia ? <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-700 dark:text-amber-300">开启后，媒体下载可访问本机、局域网及代理映射地址。请只使用可信的模型渠道和插件。</p> : null}
        </section>
    </div>;
}
