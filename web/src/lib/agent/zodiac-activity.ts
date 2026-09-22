export type ZodiacActivityEvent = {
    id: string;
    kind: "model" | "tool" | "task" | "approval";
    status: "running" | "waiting" | "done" | "error";
    label: string;
    detail?: string;
    at: number;
};
export type ZodiacActivity = ZodiacActivityEvent & { startedAt: number };
export function updateZodiacActivity(items: ZodiacActivity[], event: ZodiacActivityEvent): ZodiacActivity[] {
    const old = items.find((item) => item.id === event.id);
    const next = { ...old, ...event, startedAt: old?.startedAt ?? event.at };
    return (old ? items.map((item) => (item.id === event.id ? next : item)) : [...items, next]).slice(-80);
}
const labels: Record<string, string> = {
    read: "读取文件", write: "写入文件", edit: "修改文件", bash: "执行命令", glob: "查找文件", grep: "搜索文件", task: "执行子任务", webfetch: "读取网页",
    "执行命令": "执行命令", "写入文件": "写入文件", "访问文件": "访问文件",
    hub_import_file: "导入产物",
    skill: "读取技能",
    workflow: "选择制作流程",
    hub_plan_list: "读取创作计划",
    hub_plan_get: "核对阶段进度",
    hub_plan_write: "编写创作计划",
    hub_plan_patch_stage: "编写当前阶段",
    hub_plan_replan: "调整创作计划",
    hub_canvas_list_nodes: "查看画布",
    hub_canvas_get_node: "读取素材",
    hub_read: "读取素材",
    hub_canvas_read_text: "阅读文档",
    hub_canvas_grep_text: "搜索文档",
    hub_canvas_write_node: "写入文档",
    hub_canvas_apply_text_edits: "修改文档",
    hub_generate_image: "生成图片",
    hub_generate_video: "生成视频",
    hub_generate_audio: "生成语音",
    hub_analyse_media: "分析图片",
    hub_plugin_agent_describe: "读取插件能力",
    hub_plugin_agent_invoke: "操作插件",
    hub_canvas_group_nodes: "整理画布",
    hub_canvas_group_recent_outputs: "整理生成结果",
    hub_canvas_ungroup_node: "取消分组",
    "zodiac-ui": "等待选择",
    "zodiac-ops": "准备画布方案",
};
export const zodiacToolLabel = (name: string) => labels[name] || "处理工具请求";
export const zodiacToolNeedsApproval = (name: string) =>
    [
        "hub_generate_image",
        "hub_generate_video",
        "hub_generate_audio",
        "hub_canvas_write_node",
        "hub_canvas_apply_text_edits",
        "hub_canvas_group_nodes",
        "hub_canvas_group_recent_outputs",
        "hub_canvas_ungroup_node",
        "hub_plugin_agent_invoke",
        "hub_save_file_to_session",
        "hub_import_file",
    ].includes(name);
