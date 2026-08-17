export const APP_VERSION = __APP_VERSION__ || "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://github.com/qxryz/workflowgenerator";

// WG 官方插件从本仓库分发；私有部署仍可通过环境变量覆盖。
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://raw.githubusercontent.com/qxryz/workflowgenerator/plugins-dist/official-plugins.json";
