const string = (description) => ({ type: "string", description });
const outline = {
    type: "array", minItems: 1, maxItems: 30,
    items: { type: "object", required: ["id", "title"], properties: { id: string("稳定阶段 ID"), title: string("阶段名称"), omitted: { type: "boolean", description: "仅重规划时可略过未执行的未来阶段" } } },
};
const stage = {
    type: "object", required: ["id", "contract"],
    properties: {
        id: string("大纲中当前第一个未完成阶段的 ID"),
        contract: {
            type: "object", required: ["goal", "workItems"],
            properties: {
                goal: string("当前阶段的具体交付目标"),
                workItems: {
                    type: "array", minItems: 1, maxItems: 50,
                    items: {
                        type: "object", required: ["id", "title", "tool", "args"],
                        properties: {
                            id: string("稳定交付物 ID；不要因为重试而换 ID"),
                            title: string("交付物名称"),
                            tool: { type: "string", enum: ["hub_canvas_write_node", "hub_generate_image", "hub_generate_video", "hub_generate_audio"] },
                            args: { type: "object", description: "工具实际参数。文档用 kind:text,name,content（完整正文）；生成用完整 prompt/text、实际模型与参数。不得用占位文字或伪造节点引用。", properties: {
                                kind: { type: "string", enum: ["text"], description: "文档类型固定为 text" }, name: string("文档名称"), content: string("已写好的完整文档正文"),
                                prompt: string("图片或视频生成提示词"), text: string("语音合成正文"), model: string("实际渠道模型 ID；省略使用默认模型"),
                                size: string("已确认尺寸"), seconds: { type: "number" }, voice: string("已确认音色"),
                                references: { type: "array", items: { type: "object", required: ["nodeId"], properties: { nodeId: string("已读取的真实画布节点 ID"), role: string("用途：source_edit / identity / style / layout / scene / first_frame / last_frame / audio / reference"), label: string("素材名"), resultVersionId: string("读取到的媒体版本"), contentHash: string("读取到的文档哈希") } } },
                            } },
                            dependsOn: { type: "array", items: string("同一阶段中必须先完成的工作项 ID") },
                            inputItemIds: { type: "array", items: string("将这些已完成工作项的真实产物作为引用；执行器解析实际 nodeId，不能猜 ID") },
                        },
                    },
                },
                review: { type: "object", properties: {
                    beforeExecution: { type: "array", items: string("执行前需要确认的约束，如文案、模型、数量") },
                    afterExecution: { type: "array", items: string("成果验收标准，如正文完整、人物一致") },
                } },
            },
        },
    },
};
const revision = { type: "integer", minimum: 1, description: "刚从 hub_plan_get 读取的 revision；冲突时重新读取，禁止盲目覆盖" };

/** Planner inputs deliberately cannot contain approvals, runtime statuses or execution receipts. */
export const ZODIAC_PLAN_TOOLS = [
    { name: "hub_plan_list", description: "列出当前画布的持久化阶段计划及进度。继续任务前先读取已有计划，避免重复创建。", parameters: { type: "object", properties: {} } },
    { name: "hub_plan_get", description: "默认读取计划摘要、Planner 会话和实际回执；items 分页读工作项，text 分页读完整正文。partial 结果不能作为完整合同覆盖阶段。只能推进第一个未完成阶段。", parameters: { type: "object", required: ["planId"], properties: { planId: string("已有计划 ID"), view: { type: "string", enum: ["summary", "items", "text"] }, stageId: string("省略读取当前阶段"), itemId: string("text 视图的工作项 ID"), field: string("text 视图正文字段：content / prompt / text"), offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, description: "items 最多 10 项，text 最多 12000 字符" } } } },
    { name: "hub_plan_write", description: "创建阶段计划：给出完整大纲，只具体编写第一阶段。显示原生计划卡并等待用户审核；成功不是已执行，不能随后自行生成。", parameters: { type: "object", required: ["title", "workflowId", "outline", "firstStage"], properties: {
        id: string("可选的稳定计划 ID"), title: string("计划名称"), workflowId: string("workflow 工具提供的 ID，或 custom"), outline, firstStage: stage,
    } } },
    { name: "hub_plan_patch_stage", description: "编写或修订当前未执行阶段。保留已完成前缀和稳定工作项 ID；不能修改正在执行阶段。显示审核卡后停止。", parameters: { type: "object", required: ["planId", "expectedRevision", "stage"], properties: { planId: string("计划 ID"), expectedRevision: revision, stage } } },
    { name: "hub_plan_replan", description: "用户改变目标时，修订当前阶段及未来大纲，保留已完成阶段与产物。不能跳过当前执行或伪造成功。显示审核卡后停止。", parameters: { type: "object", required: ["planId", "expectedRevision", "outline", "stage", "reason"], properties: { planId: string("计划 ID"), expectedRevision: revision, outline, stage, reason: string("根据用户要求说明本次调整") } } },
];
