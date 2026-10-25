import { Segmented } from "antd";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { DramaSnapshot } from "@/lib/drama/types";
import { PalettePanel } from "./palette-panel";
import { StylePanel } from "./style-panel";

type Area = "style" | "palette";

/** 画风与色彩: two tools that each end in "采用" for the whole drama. */
export function StyleSection({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const [area, setArea] = useState<Area>("style");
    const { style, palette } = snapshot.project;
    const mark = (on: boolean) => (on ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-[color:var(--wg-home-accent)] align-middle" title={t("已采用")} /> : null);
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-4 border-b border-[color:var(--wg-home-line)] px-5">
                <span className="flex shrink-0">
                    <Segmented
                        size="small"
                        value={area}
                        onChange={setArea}
                        options={[
                            {
                                value: "style",
                                label: (
                                    <span>
                                        {t("画风")}
                                        {mark(Boolean(style))}
                                    </span>
                                ),
                            },
                            {
                                value: "palette",
                                label: (
                                    <span>
                                        {t("色彩")}
                                        {mark(Boolean(palette))}
                                    </span>
                                ),
                            },
                        ]}
                    />
                </span>
                <p className="!mb-0 min-w-0 truncate text-[12px] text-[color:var(--wg-home-muted)]" title={t("生成设定图、画面和视频时默认使用已采用的画风与色彩，可在生成时取消。")}>
                    {t("生成设定图、画面和视频时默认使用已采用的画风与色彩，可在生成时取消。")}
                </p>
            </div>
            <div className="min-h-0 flex-1">{area === "style" ? <StylePanel project={snapshot.project} /> : <PalettePanel project={snapshot.project} />}</div>
        </div>
    );
}
