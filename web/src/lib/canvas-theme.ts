export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#eeede7",
            dot: "rgba(44,47,43,.20)",
            line: "rgba(44,47,43,.095)",
            selectionStroke: "#315fbd",
            selectionFill: "rgba(49,95,189,.09)",
        },
        node: {
            label: "#5e625b",
            fill: "#f0efe9",
            panel: "#f7f6f0",
            stroke: "#b8b9b2",
            activeStroke: "#315fbd",
            placeholder: "#7e827a",
            text: "#242724",
            muted: "#666a63",
            faint: "#969990",
        },
        toolbar: {
            panel: "rgba(247,246,240,.94)",
            border: "#b8b9b2",
            item: "#5e625b",
            itemHover: "#e6e4dc",
            activeBg: "#dce4f4",
            activeText: "#284f9f",
        },
    },
    dark: {
        canvas: {
            background: "#151716",
            dot: "rgba(225,224,216,.20)",
            line: "rgba(225,224,216,.095)",
            selectionStroke: "#8caaea",
            selectionFill: "rgba(140,170,234,.13)",
        },
        node: {
            label: "#b9bbb4",
            fill: "#202320",
            panel: "#1c1f1d",
            stroke: "#4e514c",
            activeStroke: "#8caaea",
            placeholder: "#989b94",
            text: "#ebe9e1",
            muted: "#b5b7b0",
            faint: "#777b74",
        },
        toolbar: {
            panel: "rgba(28,31,29,.95)",
            border: "#4e514c",
            item: "#b9bbb4",
            itemHover: "#2b2e2b",
            activeBg: "#293650",
            activeText: "#abc1ef",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
