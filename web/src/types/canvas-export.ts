import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { ZodiacStagePlan } from "@/lib/agent/zodiac-stage-plan";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    files: CanvasExportAsset[];
    /** Optional for backwards compatibility with existing version 3 archives. */
    plans?: ZodiacStagePlan[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
