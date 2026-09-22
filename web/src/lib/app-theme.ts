import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#145ed9",
        primaryHover: "#0e4dbb",
        primaryText: "#ffffff",
        menuBg: "#e9eef6",
        menuText: "#111827",
        selectActiveBg: "#edf1f6",
        selectSelectedBg: "#e1eaff",
        selectText: "#111827",
        tableSelectedBg: "rgba(20, 94, 217, 0.07)",
        tableSelectedHoverBg: "rgba(20, 94, 217, 0.11)",
    },
    dark: {
        primary: "#78a6ff",
        primaryHover: "#91b7ff",
        primaryText: "#08101e",
        menuBg: "#1b2230",
        menuText: "#f4f7fb",
        selectActiveBg: "#1b2230",
        selectSelectedBg: "#243656",
        selectText: "#f4f7fb",
        tableSelectedBg: "rgba(120, 166, 255, 0.1)",
        tableSelectedHoverBg: "rgba(120, 166, 255, 0.15)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: neutral.dark.menuBg,
                darkItemSelectedBg: neutral.dark.menuBg,
                darkItemSelectedColor: neutral.dark.menuText,
            },
            Select: {
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
