import type { CanvasNodeData, CanvasResultSlotArtifact, CanvasResultSlotSuccessVersion } from "../../types/canvas";

export type CanvasResultSlotLayout = {
    artifactCount: number;
    columns: number;
    rows: number;
    width: number;
    height: number;
};

const GRID_GAP = 8;
const GRID_PADDING = 16;
const HEADER_HEIGHT = 36;
const ACTIONS_HEIGHT = 44;
const VERSION_RAIL_HEIGHT = 56;

export function resolveCanvasResultSlotLayout(node: CanvasNodeData): CanvasResultSlotLayout | undefined {
    if (node.metadata?.role !== "result-slot") return undefined;
    const current = selectedSuccessVersion(node);
    if (!current?.artifacts.length) return undefined;
    const artifactCount = current.artifacts.length;
    const requestedColumns = boundedColumns(node.metadata.resultSlotLayoutColumns, artifactCount);
    const columns = requestedColumns ?? Math.min(4, Math.ceil(Math.sqrt(artifactCount)));
    const rows = Math.ceil(artifactCount / columns);
    const versionRail = (node.metadata.resultVersions?.length || 0) > 1 || node.metadata.resultVersions?.some((version) => version.status === "error")
        ? VERSION_RAIL_HEIGHT
        : 0;

    if (node.metadata.resultSlotMode === "audio") {
        return { artifactCount, columns, rows, width: clamp(320 + (columns - 1) * 120, 320, 720), height: HEADER_HEIGHT + ACTIONS_HEIGHT + versionRail + rows * 110 + GRID_PADDING + (rows - 1) * GRID_GAP };
    }
    if (node.metadata.resultSlotMode === "text") {
        const longest = Math.max(...current.artifacts.map((artifact) => artifact.content.length));
        const previewHeight = clamp(150 + Math.ceil(longest / 480) * 44, 194, 520);
        return { artifactCount, columns, rows, width: clamp(columns * 340 + GRID_PADDING + (columns - 1) * GRID_GAP, 340, 1040), height: HEADER_HEIGHT + ACTIONS_HEIGHT + versionRail + rows * previewHeight + GRID_PADDING + (rows - 1) * GRID_GAP };
    }

    const ratio = representativeRatio(current.artifacts, node.metadata.resultSlotMode === "video" ? 16 / 9 : 1);
    const cell = mediaCellSize(ratio, artifactCount === 1);
    return {
        artifactCount,
        columns,
        rows,
        width: clamp(columns * cell.width + GRID_PADDING + (columns - 1) * GRID_GAP, 260, 1120),
        height: clamp(HEADER_HEIGHT + ACTIONS_HEIGHT + versionRail + rows * cell.height + GRID_PADDING + (rows - 1) * GRID_GAP, 220, 920),
    };
}

export function fitCanvasResultSlotToContent(node: CanvasNodeData) {
    if (node.metadata?.resultSlotAutoSize === false) return node;
    const layout = resolveCanvasResultSlotLayout(node);
    if (!layout || (Math.abs(node.width - layout.width) < 1 && Math.abs(node.height - layout.height) < 1)) return node;
    return { ...node, width: Math.round(layout.width), height: Math.round(layout.height) };
}

function selectedSuccessVersion(node: CanvasNodeData): CanvasResultSlotSuccessVersion | undefined {
    const selectedId = node.metadata?.currentResultVersionId;
    return node.metadata?.resultVersions?.find((version): version is CanvasResultSlotSuccessVersion => version.status === "success" && version.id === selectedId);
}

function boundedColumns(value: unknown, artifactCount: number) {
    return typeof value === "number" && Number.isInteger(value) && value >= 1
        ? Math.min(4, artifactCount, value)
        : undefined;
}

function representativeRatio(artifacts: CanvasResultSlotArtifact[], fallback: number) {
    const ratios = artifacts
        .map((artifact) => artifact.naturalWidth && artifact.naturalHeight ? artifact.naturalWidth / artifact.naturalHeight : undefined)
        .filter((value): value is number => Boolean(value && Number.isFinite(value) && value > 0.1 && value < 10))
        .sort((left, right) => left - right);
    return clamp(ratios.length ? ratios[Math.floor(ratios.length / 2)] : fallback, 0.35, 3.2);
}

function mediaCellSize(ratio: number, single: boolean) {
    if (single) {
        if (ratio >= 1) {
            const width = 420;
            return { width, height: clamp(width / ratio, 220, 440) };
        }
        const height = 380;
        return { width: clamp(height * ratio, 220, 380), height };
    }
    if (ratio >= 1) {
        const width = 280;
        return { width, height: clamp(width / ratio, 160, 280) };
    }
    const height = 260;
    return { width: clamp(height * ratio, 160, 260), height };
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}
