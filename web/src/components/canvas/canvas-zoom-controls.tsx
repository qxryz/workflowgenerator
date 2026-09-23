import { Compass, Focus } from "lucide-react";
import { Tooltip } from "antd";
import { useAppTranslation } from "@/hooks/use-app-translation";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap }: CanvasZoomControlsProps) {
    const { t } = useAppTranslation();
    return (
        <div className="wg-canvas-zoom" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="wg-control-surface">
                <Tooltip title={t(isMiniMapOpen ? "关闭小地图" : "打开小地图")}>
                    <button type="button" className="wg-icon-button" data-active={isMiniMapOpen || undefined} aria-pressed={isMiniMapOpen} onClick={onToggleMiniMap} aria-label={t(isMiniMapOpen ? "关闭小地图" : "打开小地图")}>
                        <Compass />
                    </button>
                </Tooltip>
                <Tooltip title={t("重置视图")}>
                    <button type="button" className="wg-icon-button" onClick={onReset} aria-label={t("重置视图")}>
                        <Focus />
                    </button>
                </Tooltip>
                <Tooltip title={t("放大/缩小画布")}>
                    <input type="range" min="5" max="500" step="1" value={Math.round(scale * 100)} className="w-24" onChange={(event) => onScaleChange(Number(event.target.value) / 100)} aria-label={t("放大/缩小画布")} />
                </Tooltip>
                <span className="w-10 pr-1 text-right text-[11px] tabular-nums opacity-60">{Math.round(scale * 100)}%</span>
            </div>
        </div>
    );
}
