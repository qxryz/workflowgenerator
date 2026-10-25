import { Segmented, Slider, Switch } from "antd";
import { Music, X } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { ExportOptions } from "@/lib/drama/types";

export type Music = { key: string; name: string; url: string };

type Props = { options: ExportOptions; onChange: (options: ExportOptions) => void; voices: number; music?: Music; uploading: boolean; onMusic: (file: File | null) => void };

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    const { t } = useAppTranslation();
    return (
        <div className="flex items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="shrink-0 text-[13px]">{t(label)}</span>
                {hint ? <span className="truncate text-[11px] text-[color:var(--wg-home-muted)]">{hint}</span> : null}
            </div>
            {children}
        </div>
    );
}

export function ExportOptionsForm({ options, onChange, voices, music, uploading, onMusic }: Props) {
    const { t } = useAppTranslation();
    const input = useRef<HTMLInputElement>(null);
    const set = (patch: Partial<ExportOptions>) => onChange({ ...options, ...patch });
    return (
        <div className="divide-y divide-[color:var(--wg-home-line)] px-4">
            <Row label="分辨率">
                <Segmented size="small" value={options.resolution} onChange={(resolution) => set({ resolution: resolution as ExportOptions["resolution"] })} options={["720p", "1080p"]} />
            </Row>
            <Row label="保留原声" hint={t("视频自带的声音")}>
                <Switch size="small" checked={options.keepOriginalAudio} onChange={(keepOriginalAudio) => set({ keepOriginalAudio })} />
            </Row>
            <Row label="加入配音" hint={voices ? t("{count} 镜已采用配音", { count: voices }) : t("还没有采用的配音")}>
                <Switch size="small" checked={options.includeVoice} onChange={(includeVoice) => set({ includeVoice })} />
            </Row>
            <div className="py-2">
                <Row label="背景音乐">
                    {music ? (
                        <button type="button" className="wg-icon-button !size-7" title={t("移除")} aria-label={t("移除背景音乐")} onClick={() => onMusic(null)}>
                            <X strokeWidth={1.6} />
                        </button>
                    ) : (
                        <button type="button" className="wg-text-button !h-8 !border !border-[color:var(--wg-home-line)]" disabled={uploading} onClick={() => input.current?.click()}>
                            <Music className="size-3.5" strokeWidth={1.6} />
                            {t(uploading ? "上传中…" : "上传音乐")}
                        </button>
                    )}
                    <input
                        ref={input}
                        type="file"
                        hidden
                        accept="audio/*"
                        onChange={(event) => {
                            onMusic(event.target.files?.[0] ?? null);
                            event.target.value = "";
                        }}
                    />
                </Row>
                {music ? (
                    <div className="space-y-2 pb-1">
                        <p className="truncate text-[12px] text-[color:var(--wg-home-muted)]" title={music.name}>{music.name}</p>
                        <audio src={music.url} controls preload="metadata" className="h-8 w-full" />
                        <div className="flex items-center gap-3 text-[12px] text-[color:var(--wg-home-muted)]">
                            <span className="shrink-0">{t("音量")}</span>
                            <Slider className="!m-0 flex-1" min={0} max={100} value={Math.round((options.musicVolume ?? 0.3) * 100)} onChange={(value) => set({ musicVolume: value / 100 })} tooltip={{ formatter: (value) => `${value}%` }} />
                            <span className="w-9 text-right tabular-nums">{Math.round((options.musicVolume ?? 0.3) * 100)}%</span>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
