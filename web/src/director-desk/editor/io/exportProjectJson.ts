import type { DirectorProject } from "../schema/directorProject";

export function serializeProject(project: DirectorProject) {
    return JSON.stringify(
        {
            ...project,
            cameras: project.cameras.map((camera) => {
                const captures = (camera.captures ?? []).map(
                    ({ storageKey: _storageKey, width: _width, height: _height, bytes: _bytes, mimeType: _mimeType, contentHash: _contentHash, ...capture }) => capture,
                );
                return { ...camera, captures, lastCaptureUrl: captures.at(-1)?.dataUrl ?? null };
            }),
        },
        null,
        2,
    );
}
