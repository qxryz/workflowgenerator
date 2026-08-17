import type { DirectorProject } from "../schema/directorProject";

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNumberTuple(value: unknown): value is [number, number, number] {
    return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function hasTransform(value: unknown) {
    return isRecord(value) && isNumberTuple(value.position) && isNumberTuple(value.rotation) && isNumberTuple(value.scale);
}

export function isDirectorProject(value: unknown): value is DirectorProject {
    if (!isRecord(value) || value.version !== 1) return false;
    if (!isRecord(value.scene) || !Array.isArray(value.assets) || !Array.isArray(value.objects) || !Array.isArray(value.cameras)) {
        return false;
    }

    const scene = value.scene;
    const hasSceneSettings =
        typeof scene.scale === "number" &&
        isNumberTuple(scene.position) &&
        isNumberTuple(scene.rotation) &&
        typeof scene.backgroundColor === "string" &&
        typeof scene.panoramaYaw === "number" &&
        typeof scene.panoramaRadius === "number" &&
        typeof scene.showLabels === "boolean" &&
        typeof scene.snapToGrid === "boolean" &&
        typeof scene.showGround === "boolean" &&
        typeof scene.groundOpacity === "number" &&
        typeof scene.groundHeight === "number";
    if (!hasSceneSettings) return false;

    const hasAssets = value.assets.every(
        (asset) => isRecord(asset) && typeof asset.id === "string" && typeof asset.kind === "string" && (asset.sourceType === "model" || asset.sourceType === "image") && typeof asset.fileName === "string" && typeof asset.url === "string",
    );
    const hasObjects = value.objects.every(
        (object) => isRecord(object) && typeof object.id === "string" && typeof object.name === "string" && typeof object.kind === "string" && typeof object.visible === "boolean" && typeof object.locked === "boolean" && hasTransform(object.transform),
    );
    const hasCameras = value.cameras.every(
        (camera) =>
            isRecord(camera) &&
            typeof camera.id === "string" &&
            typeof camera.name === "string" &&
            typeof camera.fov === "number" &&
            hasTransform(camera.transform) &&
            (camera.targetMode === "manual" || camera.targetMode === "object") &&
            isNumberTuple(camera.target),
    );

    return hasAssets && hasObjects && hasCameras && (value.activeCameraId === null || typeof value.activeCameraId === "string") && (value.panoramaAssetId === null || typeof value.panoramaAssetId === "string");
}

export function parseProjectValue(value: unknown): DirectorProject {
    if (!isDirectorProject(value)) {
        throw new Error("无效的导演台工程文件");
    }

    return value;
}

export function parseProject(json: string): DirectorProject {
    return parseProjectValue(JSON.parse(json) as unknown);
}
