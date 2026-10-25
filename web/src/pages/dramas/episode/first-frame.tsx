import { Segmented } from "antd";
import { useEffect, useMemo, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { adoptedByShot, canUseTail, defaultFirstFrame, type FirstFrameSource } from "@/lib/drama/episode-steps";
import { pickFirstFrame, type RefImage } from "@/lib/drama/media/references";
import { captureTailFrame } from "@/lib/drama/media/runner";
import type { DramaArtifact, DramaShot } from "@/lib/drama/types";

type Tail = { videoId: string; frame?: RefImage; failed?: boolean };

/** Which picture a shot's video starts from: this shot's storyboard picture, or the last frame of the previous shot's video. */
export function useFirstFrame(shots: readonly DramaShot[], artifacts: readonly DramaArtifact[], shot: DramaShot, storyboard: DramaArtifact | undefined) {
    const prev = shots[shots.findIndex((item) => item.id === shot.id) - 1];
    const videos = useMemo(() => adoptedByShot(artifacts, "video"), [artifacts]);
    const tailAllowed = canUseTail(shot, prev, videos);
    const [picked, setPicked] = useState<FirstFrameSource>();
    const source: FirstFrameSource = picked === "storyboard" ? "storyboard" : picked === "tail" && tailAllowed ? "tail" : defaultFirstFrame(shot, prev, videos);

    const prevVideo = prev ? videos.get(prev.id) : undefined;
    const [tail, setTail] = useState<Tail>();
    useEffect(() => {
        if (source !== "tail" || !prevVideo) return;
        let live = true;
        captureTailFrame(prevVideo).then(
            (frame) => live && setTail({ videoId: prevVideo.id, frame }),
            () => live && setTail({ videoId: prevVideo.id, failed: true }),
        );
        return () => {
            live = false;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query hands out new objects on every refetch; the video is identified by id and url
    }, [source, prevVideo?.id, prevVideo?.mediaUrl]);
    const current = tail && tail.videoId === prevVideo?.id ? tail : undefined;

    const firstFrame = pickFirstFrame(source, storyboard, current?.frame);
    const reason = firstFrame ? "" : source === "tail" ? (current?.failed ? "读不到上一镜的尾帧，请改用本镜画面" : "正在读取上一镜的尾帧…") : "先采用本镜画面";
    return { source, setSource: setPicked, tailAllowed, firstFrame, reason };
}

type Props = { source: FirstFrameSource; tailAllowed: boolean; onChange: (source: FirstFrameSource) => void };

export function FirstFrameOption({ source, tailAllowed, onChange }: Props) {
    const { t } = useAppTranslation();
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs text-[color:var(--wg-home-muted)]">
                <span>{t("首帧来源")}</span>
                <Segmented
                    size="small"
                    value={source}
                    onChange={(value) => onChange(value as FirstFrameSource)}
                    options={[
                        { value: "storyboard", label: t("本镜画面") },
                        { value: "tail", label: t("上一镜尾帧"), disabled: !tailAllowed },
                    ]}
                />
            </div>
            <p className="text-[11px] leading-4 text-[color:var(--wg-home-muted)]">{tailAllowed ? t("连续镜头默认接着上一镜的结尾，也可以改用本镜画面") : t("上一镜尾帧只用于连续镜头，且上一镜要先采用视频")}</p>
        </div>
    );
}
