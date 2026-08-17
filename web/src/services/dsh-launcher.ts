import { invoke } from "@tauri-apps/api/core";

import { isDesktopApp } from "@/services/desktop-storage";

export type DshDesktopState = {
    installed: boolean;
    running: boolean;
    version: string | null;
};

export type DshMarketplaceState = {
    installed: boolean;
    version: string | null;
};

export async function getDshDesktopVersion() {
    if (!isDesktopApp()) return null;
    return invoke<string | null>("get_dsh_desktop_version");
}

export async function getDshDesktopState(): Promise<DshDesktopState> {
    if (!isDesktopApp()) return { installed: false, running: false, version: null };
    return invoke<DshDesktopState>("get_dsh_desktop_state");
}

export async function getDshMarketplaceState(): Promise<DshMarketplaceState> {
    if (!isDesktopApp()) return { installed: false, version: null };
    return invoke<DshMarketplaceState>("get_dsh_marketplace_state");
}

export async function installDshMarketplace() {
    if (!isDesktopApp()) throw new Error("DSH 插件市场只能从 Workflow Generator 桌面版安装");
    return invoke<DshMarketplaceState>("install_dsh_marketplace");
}

export async function openDshDesktop() {
    if (!isDesktopApp()) throw new Error("DSH 桌面端只能从 Workflow Generator 桌面版打开");
    return invoke<void>("open_dsh_desktop");
}
