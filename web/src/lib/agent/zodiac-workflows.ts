/** Compact workflow registry: load the selected contract instead of injecting every recipe. */
const workflows = [
    { id: "ad-tvc", name: "广告视频", description: "产品创意、文案、视觉素材与镜头制作", stages: ["创意与文案", "产品与视觉参考", "镜头制作", "成果检查"], contract: "先确认广告目标、产品事实、时长与受众。文案阶段写入完整文案和镜头说明；视觉阶段使用用户已有产品资料，禁止猜测产品外形。每个镜头引用真实产品与视觉节点。已经确认的文案、画幅、品牌约束沿用到后续阶段。镜头数量与生成次数明确列出。" },
    { id: "drama-series", name: "剧情短片", description: "剧本、角色场景、分镜与连续镜头", stages: ["剧本与制作范围", "角色与场景资料", "分镜", "镜头制作", "成果检查"], contract: "多集来源先确认本次集数或范围，不能默认制作全部。剧本与分镜以完整正文保存。角色与场景资料先由用户审核，连续镜头直接引用同一角色与场景资料；不能只引用前一镜头就声称继承角色设定。按镜头依赖安排生成，对失败镜头单独重试。" },
    { id: "mv", name: "音乐视频", description: "根据已有音乐规划视觉与镜头", stages: ["音乐与视觉方案", "风格及人物参考", "镜头制作", "成果检查"], contract: "先明确已有音乐、歌词或节奏资料；只读文字不能声称听过音频。根据真实时长和段落安排视觉变化，保留人物及风格参考。当前音乐生成与自动剪辑能力未适配时，不得把语音合成当作音乐或声称已经交付成片。可交付镜头与剪辑说明，并明确尚缺的后期步骤。" },
    { id: "custom", name: "自定义创作", description: "按任务依赖组织文档、图片、视频或语音", stages: ["内容方案", "素材制作", "成果检查"], contract: "根据目标选取最少阶段，独立单次生成不必创建阶段计划。将文档正文、已有参考、生成动作和验收标准分开；每阶段只编写当前可确定的工作项，未来阶段保留大纲即可。" },
] as const;

const shared = "计划只组织本应用实际支持的动作：完整文本写入、图片生成、视频生成、语音合成。纯文档阶段同样以真实画布节点作为完成回执。不能写 runtime 或假造结果。先编写当前阶段、等待用户审核、执行器领取工作项、保存真实结果、用户审核结果，之后才能编写下一阶段。模型、语言、数量、尺寸和参考等已确认条件必须写进工作项；重试只处理失败项。若所需后期或外部能力不存在，说明缺口，不能将准备素材当成最终成片。";

export const ZODIAC_WORKFLOW_TOOL = {
    name: "workflow",
    description: "读取创作工作流目录或一个工作流的阶段规则。复杂任务按需读取；不执行，不创建计划。",
    parameters: { type: "object", properties: { id: { type: "string", description: "省略返回目录；传 ad-tvc / drama-series / mv / custom 读取具体规则" } } },
};

export function readZodiacWorkflow(args: unknown) {
    const id = args && typeof args === "object" && "id" in args ? (args as { id?: unknown }).id : undefined;
    if (id === undefined || id === "") return { workflows: workflows.map(({ id, name, description }) => ({ id, name, description })) };
    if (typeof id !== "string") throw new Error("workflow.id 必须是工作流 ID");
    const selected = workflows.find((workflow) => workflow.id === id);
    if (!selected) throw new Error("工作流不存在，请先读取工作流目录");
    return { ...selected, sharedContract: shared };
}
