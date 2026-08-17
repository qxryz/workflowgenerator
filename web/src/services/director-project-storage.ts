import { createDesktopJsonStore } from "@/services/desktop-storage";

const storage = createDesktopJsonStore({
    namespace: "plugin-data-v1:director-desk",
    legacy: { name: "infinite-canvas-plugins", storeName: "director-desk" },
});

export function directorProjectKey(instanceId: string) {
    return `project:${instanceId}`;
}

export function directorRecentProjectKey(instanceId: string) {
    return `recent:${instanceId}`;
}

export function readDirectorProject(instanceId: string) {
    return storage.getItem(directorProjectKey(instanceId));
}

export async function writeDirectorProject(instanceId: string, project: unknown) {
    return writeAndConfirm(directorProjectKey(instanceId), project);
}

export function readDirectorRecentProject(instanceId: string) {
    return storage.getItem(directorRecentProjectKey(instanceId));
}

export async function writeDirectorRecentProject(instanceId: string, project: unknown) {
    return writeAndConfirm(directorRecentProjectKey(instanceId), project);
}

export async function readAllDirectorStoredProjects() {
    const projects: unknown[] = [];
    await storage.iterate<unknown, void>((value, key) => {
        if (key.startsWith("project:") || key.startsWith("recent:")) projects.push(value);
    });
    return projects;
}

async function writeAndConfirm(key: string, project: unknown) {
    await storage.setItem(key, project);
    const confirmed = await storage.getItem(key);
    if (confirmed == null) throw new Error("导演项目尚未写入本地存储");
    return confirmed;
}
