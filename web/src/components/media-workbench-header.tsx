import { Clapperboard, History, Image, Music2, SlidersHorizontal, Video } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

type MediaWorkbenchHeaderProps = {
    kind: "image" | "video" | "audio" | "sd25";
    title: string;
    onOpenHistory?: () => void;
    onOpenSettings?: () => void;
};

const workbenches = [
    { kind: "image" as const, label: "图片", path: "/workbench/image", icon: Image },
    { kind: "video" as const, label: "视频", path: "/workbench/video", icon: Video },
    { kind: "audio" as const, label: "音频", path: "/workbench/audio", icon: Music2 },
    { kind: "sd25" as const, label: "SD2.5", path: "/workbench/sd25", icon: Clapperboard },
];

export function MediaWorkbenchHeader({ kind, title, onOpenHistory, onOpenSettings }: MediaWorkbenchHeaderProps) {
    return (
        <header className="wg-media-workbench-topbar">
            <div className="min-w-0">
                <h1 className="wg-sketch-title truncate text-[21px] font-semibold">{title}</h1>
            </div>

            <nav className="wg-media-workbench-switch" aria-label="切换创作工作台">
                {workbenches.map((item) => {
                    const Icon = item.icon;
                    return (
                        <NavLink key={item.kind} to={item.path} className={cn("wg-media-workbench-switch-item", kind === item.kind && "is-active")} aria-current={kind === item.kind ? "page" : undefined}>
                            <Icon className="size-3.5" strokeWidth={1.8} />
                            <span>{item.label}</span>
                        </NavLink>
                    );
                })}
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-2">
                {onOpenHistory ? (
                    <button type="button" className="wg-media-history-trigger wg-media-workbench-icon-button" onClick={onOpenHistory} aria-label="打开生成记录">
                        <History className="size-4" />
                        <span>记录</span>
                    </button>
                ) : null}
                {onOpenSettings ? (
                    <button type="button" className="wg-media-settings-trigger wg-media-workbench-icon-button" onClick={onOpenSettings} aria-label="打开模型与参数">
                        <SlidersHorizontal className="size-4" />
                        <span>参数</span>
                    </button>
                ) : null}
            </div>
        </header>
    );
}
