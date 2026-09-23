// Zodiac 原生工具目录与严格形状校验。
// 画布工具通过提案审批执行，技能按需读取。
//
// **参数 schema 一律平铺，不要用 oneOf / anyOf / const 做判别**。实测（MiniMax-M3 与 agnes 两条
// 线路、中立提示词、五个决策形状各跑一遍）：用判别式 schema 时模型无法从声明里判断「哪种 type 该带
// 哪些字段」，只能反复试错，5 种形状只有 1 种成功，单个形状最多烧掉 6 个回合后放弃并退回纯文本；
// 改成「所有字段平铺在顶层 + 用 description 说明每种类型要哪些」后同一提示词 5/5 通过。
// 因此 schema 只负责「模型能把字段表达出来」，形状自洽性由执行侧的 validateZodiacUi / validateZodiacOps
// 判定——它们会给出可纠正的中文原因，与前端 normalizeZodiacDecisionUi / normalizeZodiacCanvasOps 同口径。

// 与前端 DECISION_ID_PATTERN / NODE_ID_PATTERN 对齐：字母数字开头，允许 . _ : -
// 注意：这里**不能**用 Unicode 属性转义（\p{L}/\p{N}）。实测部分 provider 的 JSON Schema
// 校验器不接受这种写法（agnes 线路直接 400：pattern is not a 'regex'），会让整轮对话失败。
// 因此只保留 ASCII 范围；前端仍按自己的 Unicode 规则做归一化与校验，这里收紧不影响它。
const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$";
const NODE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const id = { type: "string", pattern: ID_PATTERN, description: "稳定 id，字母数字开头，最多 64 字符" };
const nodeId = { type: "string", pattern: NODE_ID_PATTERN, description: "画布节点 id，必须来自本轮快照" };
const text = (max, description) => ({ type: "string", maxLength: max, description });

/** 一句话说清每种 type 要带哪些字段，平铺 schema 靠它替代原来的 oneOf 判别。 */
const UI_TYPE_GUIDE = [
    "single_choice：必填 options（2–4 项 {id,label,description?}），allowCustom 可选",
    "multi_choice：必填 options（2–6 项 {id,label,description?}），allowCustom 可选",
    "short_text：不要 options；placeholder / submitLabel 可选",
    "asset_picker：必填 options（1–12 项 {nodeId,label,description?}，nodeId 来自本轮画布快照），multiple 可选",
    "confirm_summary：必填 summary（1–6 条文字）；confirmLabel / cancelLabel 可选",
].join("；");

/** zodiac-ui：一次只问一个决定；字段平铺，形状由 validateZodiacUi 判定。 */
export const ZODIAC_UI_PARAMETERS = {
    type: "object",
    required: ["id", "type", "question"],
    properties: {
        id,
        type: { type: "string", enum: ["single_choice", "multi_choice", "short_text", "asset_picker", "confirm_summary"], description: `交互类型。${UI_TYPE_GUIDE}` },
        question: text(240, "给创作者看的问题"),
        options: {
            type: "array",
            maxItems: 12,
            description: "single_choice / multi_choice 填 {id,label,description?}；asset_picker 填 {nodeId,label,description?}。其余类型不要填。",
            items: { type: "object", properties: { id, nodeId, label: text(80, "选项标题"), description: text(180, "一行补充说明") } },
        },
        allowCustom: { type: "boolean", description: "仅 single_choice / multi_choice：是否允许自己填写" },
        multiple: { type: "boolean", description: "仅 asset_picker：是否可多选" },
        placeholder: text(120, "仅 short_text：输入框提示"),
        submitLabel: text(32, "仅 short_text：提交按钮文案"),
        summary: { type: "array", maxItems: 6, items: text(180, "一条摘要"), description: "仅 confirm_summary：要确认的 1–6 条摘要" },
        confirmLabel: text(32, "仅 confirm_summary：确认按钮文案"),
        cancelLabel: text(32, "仅 confirm_summary：取消按钮文案"),
    },
};

const UI_KEYS = ["id", "type", "question", "options", "allowCustom", "multiple", "placeholder", "submitLabel", "summary", "confirmLabel", "cancelLabel"];
const CHOICE_TYPES = ["single_choice", "multi_choice"];
const UI_TYPES = [...CHOICE_TYPES, "short_text", "asset_picker", "confirm_summary"];

function boundedText(value, max) {
    return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
}

/** 每种 type 允许出现的字段；出现别的字段就是模型理解错了形状。 */
function allowedUiKeys(type) {
    if (CHOICE_TYPES.includes(type)) return ["id", "type", "question", "options", "allowCustom"];
    if (type === "short_text") return ["id", "type", "question", "placeholder", "submitLabel"];
    if (type === "asset_picker") return ["id", "type", "question", "options", "multiple"];
    return ["id", "type", "question", "summary", "confirmLabel", "cancelLabel"];
}

function normalizeUiOptions(value, kind) {
    if (!Array.isArray(value)) return undefined;
    const options = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
        const label = boundedText(item.label, 80);
        if (!label) return undefined;
        const description = item.description === undefined ? undefined : boundedText(item.description, 180);
        if (item.description !== undefined && !description) return undefined;
        if (kind === "asset") {
            const node = typeof item.nodeId === "string" ? item.nodeId.trim() : "";
            // 资产选项必须用 nodeId（写成 id 就是形状错了），且必须来自本轮快照。
            if (!NODE_ID_RE.test(node) || item.id !== undefined) return undefined;
            options.push({ nodeId: node, label, ...(description ? { description } : {}) });
        } else {
            // 选择项必须用 id；写成 nodeId 同样算形状错。
            const key = typeof item.id === "string" ? item.id.trim() : "";
            if (!ID_RE.test(key) || item.nodeId !== undefined) return undefined;
            options.push({ id: key, label, ...(description ? { description } : {}) });
        }
    }
    return options;
}

/**
 * zodiac-ui 的形状校验。schema 平铺后这里就是唯一的判别关卡，口径与前端
 * normalizeZodiacDecisionUi 一致；抛出的中文原因会作为工具错误回到模型，让它自己纠正。
 */
export function validateZodiacUi(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("zodiac-ui 的参数必须是一个对象。");
    const type = boundedText(value.type, 32);
    if (!type || !UI_TYPES.includes(type)) throw new Error(`zodiac-ui 的 type 必须是 ${UI_TYPES.join(" / ")} 之一。`);
    if (!ID_RE.test(typeof value.id === "string" ? value.id.trim() : "")) throw new Error("zodiac-ui 的 id 必须是字母数字开头、最多 64 字符的稳定 id。");
    const question = boundedText(value.question, 240);
    if (!question) throw new Error("zodiac-ui 的 question 必填，最多 240 字符。");
    const extra = Object.keys(value).filter((key) => !UI_KEYS.includes(key));
    if (extra.length) throw new Error(`zodiac-ui 不接受这些字段：${extra.join("、")}。只能用 ${UI_KEYS.join("、")}。`);
    const wrongShape = Object.keys(value).filter((key) => UI_KEYS.includes(key) && !allowedUiKeys(type).includes(key));
    if (wrongShape.length) throw new Error(`${type} 不需要这些字段：${wrongShape.join("、")}。${UI_TYPE_GUIDE}`);

    if (CHOICE_TYPES.includes(type)) {
        const options = normalizeUiOptions(value.options, "choice");
        const maximum = type === "single_choice" ? 4 : 6;
        if (!options) throw new Error(`${type} 的 options 必须是 {id,label,description?} 数组，id 用字母数字开头、最多 64 字符。`);
        if (options.length < 2 || options.length > maximum) throw new Error(`${type} 需要 2–${maximum} 个选项，当前 ${options.length} 个。`);
        if (value.allowCustom !== undefined && typeof value.allowCustom !== "boolean") throw new Error("allowCustom 只能是 true 或 false。");
        return { id: value.id.trim(), type, question, options, ...(value.allowCustom === true ? { allowCustom: true } : {}) };
    }
    if (type === "short_text") {
        const placeholder = value.placeholder === undefined ? undefined : boundedText(value.placeholder, 120);
        const submitLabel = value.submitLabel === undefined ? undefined : boundedText(value.submitLabel, 32);
        if (value.placeholder !== undefined && !placeholder) throw new Error("short_text 的 placeholder 最多 120 字符。");
        if (value.submitLabel !== undefined && !submitLabel) throw new Error("short_text 的 submitLabel 最多 32 字符。");
        return { id: value.id.trim(), type, question, ...(placeholder ? { placeholder } : {}), ...(submitLabel ? { submitLabel } : {}) };
    }
    if (type === "asset_picker") {
        const options = normalizeUiOptions(value.options, "asset");
        if (!options || !options.length || options.length > 12) throw new Error("asset_picker 的 options 必须是 1–12 个 {nodeId,label}，nodeId 必须来自本轮画布快照（不要用 id）。");
        if (value.multiple !== undefined && typeof value.multiple !== "boolean") throw new Error("multiple 只能是 true 或 false。");
        return { id: value.id.trim(), type, question, options, ...(value.multiple === true ? { multiple: true } : {}) };
    }
    const summary = Array.isArray(value.summary) ? value.summary.map((entry) => boundedText(entry, 180)) : undefined;
    if (!summary || !summary.length || summary.length > 6 || summary.some((entry) => !entry)) throw new Error("confirm_summary 需要 1–6 条非空 summary。");
    const confirmLabel = value.confirmLabel === undefined ? undefined : boundedText(value.confirmLabel, 32);
    const cancelLabel = value.cancelLabel === undefined ? undefined : boundedText(value.cancelLabel, 32);
    return { id: value.id.trim(), type, question, summary, ...(confirmLabel ? { confirmLabel } : {}), ...(cancelLabel ? { cancelLabel } : {}) };
}

// 节点写法：内置节点用 6 个固定 type，插件节点用本轮目录里的 type，支持 nodeType:xxx
const NODE_TYPE_PATTERN = "^(text|config|image|video|audio|group|nodeType:.+)$";
const position = {
    type: "object",
    additionalProperties: false,
    required: ["x", "y"],
    properties: { x: { type: "number" }, y: { type: "number" } },
};
const size = (description) => ({ type: "number", description });
// update_node / add_node 的 metadata：只约束已知生成参数，其余字段放行交给前端归一化
const metadata = {
    type: "object",
    description: "节点 metadata；已知生成参数见 properties，未知字段由应用归一化",
    properties: {
        generationMode: { type: "string", enum: ["text", "image", "video", "audio"] },
        prompt: text(20000, "生成动作的提示词"),
        model: text(200, "模型 id"),
        reasoningEffort: { type: "string", enum: ["minimal", "low", "medium", "high"] },
        size: text(40, "尺寸"),
        quality: text(40, "质量"),
        background: text(40, "背景"),
        count: { type: "integer", minimum: 1 },
        seconds: { type: "number", minimum: 1 },
        audioVoice: text(120, "音色 id"),
        audioFormat: text(40, "音频格式"),
        audioSpeed: { type: "number" },
        audioInstructions: text(4000, "音频指令"),
        groupPrompt: text(4000, "组引用提示词，只能用 @[node:成员id] 引用组内成员"),
        content: text(20000, "text 节点的正文资料"),
    },
};

// ops 的每项同样平铺：所有字段放一个对象，required 只留 type，判别交给 validateZodiacOps。
// 理由与 zodiac-ui 相同（见文件顶部注释）：oneOf + const 会让模型猜不到形状而反复试错。
const OPS_TYPE_GUIDE = [
    "add_node：必填 id、nodeType；title / position{x,y} 或 x,y / width / height / metadata 可选",
    "update_node：必填 id（或 nodeId）；title / position / width / height / patch / metadata 任选其一以上",
    "delete_node：id 或 nodeId 或 ids（批量）或 nodeType（按类型删全部）至少给一个",
    "delete_connections：id 或 connectionId 或 ids（批量）或 all:true 至少给一个",
    "connect_nodes：必填 fromNodeId 与 toNodeId（也可写 sourceNodeId / targetNodeId）",
    "set_viewport：必填 viewport:{x,y,k}",
    "select_nodes：必填 ids（数组）",
    "run_generation：必填 nodeId；mode / prompt 可选",
].join("；");

const OP_KEYS = ["type", "id", "nodeId", "ids", "connectionId", "nodeType", "title", "position", "x", "y", "width", "height", "patch", "metadata", "fromNodeId", "toNodeId", "sourceNodeId", "targetNodeId", "viewport", "all", "mode", "prompt"];
const OP_TYPES = ["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "set_viewport", "select_nodes", "run_generation"];

/** 所有操作字段的并集；平铺 schema 用它，具体哪种操作允许哪些字段由 validateZodiacOps 判定。 */
const opProperties = {
    type: { type: "string", enum: OP_TYPES, description: `操作名。${OPS_TYPE_GUIDE}` },
    id: { ...id, description: "节点 / 连线 id；新增节点时必须是稳定且唯一的 id，后续操作都用它引用" },
    nodeId: { ...nodeId, description: "节点 id（id 的别名；run_generation 的目标节点写这里）" },
    ids: { type: "array", maxItems: 200, items: nodeId, description: "批量操作的 id 数组（select_nodes 必填）" },
    connectionId: id,
    nodeType: { type: "string", pattern: NODE_TYPE_PATTERN, description: "节点类型：内置 6 种或目录里的插件 type" },
    title: text(200, "节点标题"),
    position,
    x: { type: "number", description: "节点 x 坐标（position 的展开写法）" },
    y: { type: "number", description: "节点 y 坐标（position 的展开写法）" },
    width: size("节点宽度"),
    height: size("节点高度"),
    patch: { type: "object", description: "节点字段补丁，如 {title, position, width, height, metadata, type}" },
    metadata,
    fromNodeId: nodeId,
    toNodeId: nodeId,
    sourceNodeId: nodeId,
    targetNodeId: nodeId,
    viewport: { type: "object", required: ["x", "y", "k"], properties: { x: { type: "number" }, y: { type: "number" }, k: { type: "number", minimum: 0.05, maximum: 5 } } },
    all: { type: "boolean", description: "delete_connections：删除全部连线" },
    mode: { type: "string", enum: ["text", "image", "video", "audio"], description: "run_generation：生成类型" },
    prompt: text(20000, "run_generation：本次运行的提示词"),
};

/** zodiac-ops：一条消息只提交一个提案，ops 每项用 type 作为操作名。 */
export const ZODIAC_OPS_PARAMETERS = {
    type: "object",
    required: ["summary", "ops"],
    properties: {
        summary: text(500, "给用户看的简短说明"),
        executionMode: { type: "string", enum: ["guided", "automatic"], description: "缺省 guided；只有用户明确要求全自动时才用 automatic" },
        ops: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", required: ["type"], properties: opProperties }, description: `画布操作列表。${OPS_TYPE_GUIDE}` },
    },
};

const OPS_KEYS = ["summary", "executionMode", "ops"];

function hasAnyId(op) {
    return Boolean(op.id || op.nodeId || (Array.isArray(op.ids) && op.ids.length));
}

function assertNodeType(value, label) {
    if (value === undefined) return;
    if (typeof value !== "string" || !new RegExp(NODE_TYPE_PATTERN).test(value)) throw new Error(`${label} 必须是内置类型 text/config/image/video/audio/group 或本轮目录里的插件 type。`);
}

/**
 * zodiac-ops 的形状校验：与前端 normalizeZodiacCanvasOps 同口径。
 * 平铺 schema 之后这里是唯一的判别关卡，抛出的中文原因会作为工具错误回到模型。
 */
export function validateZodiacOps(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("zodiac-ops 的参数必须是一个对象。");
    const extra = Object.keys(value).filter((key) => !OPS_KEYS.includes(key));
    if (extra.length) throw new Error(`zodiac-ops 不接受这些字段：${extra.join("、")}。只能用 ${OPS_KEYS.join("、")}。`);
    if (!boundedText(value.summary, 500)) throw new Error("zodiac-ops 的 summary 必填，最多 500 字符。");
    if (value.executionMode !== undefined && !["guided", "automatic"].includes(value.executionMode)) throw new Error("executionMode 只能是 guided 或 automatic。");
    if (!Array.isArray(value.ops) || !value.ops.length) throw new Error(`zodiac-ops 的 ops 至少要有 1 个操作。${OPS_TYPE_GUIDE}`);

    for (const [index, op] of value.ops.entries()) {
        const at = `ops[${index}]`;
        if (!op || typeof op !== "object" || Array.isArray(op)) throw new Error(`${at} 必须是一个对象。`);
        const unknown = Object.keys(op).filter((key) => !OP_KEYS.includes(key));
        if (unknown.length) throw new Error(`${at} 不接受这些字段：${unknown.join("、")}。只能用 ${OP_KEYS.join("、")}。`);
        if (typeof op.type !== "string" || !OP_TYPES.includes(op.type)) throw new Error(`${at} 的 type 必须是 ${OP_TYPES.join(" / ")} 之一。${OPS_TYPE_GUIDE}`);
        if (op.id !== undefined && !ID_RE.test(op.id)) throw new Error(`${at} 的 id 必须是字母数字开头、最多 64 字符。`);
        if (op.nodeId !== undefined && !NODE_ID_RE.test(op.nodeId)) throw new Error(`${at} 的 nodeId 必须是字母数字开头、最多 128 字符。`);
        if (op.nodeType !== undefined && (op.type === "add_node" || op.type === "delete_node")) assertNodeType(op.nodeType, `${at} 的 nodeType`);

        switch (op.type) {
            case "add_node":
                if (!ID_RE.test(op.id || "")) throw new Error(`${at}（add_node）必须有稳定唯一的 id（字母数字开头、最多 64 字符）。`);
                if (typeof op.nodeType !== "string") throw new Error(`${at}（add_node）必须写 nodeType。`);
                break;
            case "update_node":
                if (!hasAnyId(op)) throw new Error(`${at}（update_node）必须给出要修改的节点 id（id 或 nodeId）。`);
                break;
            case "delete_node":
                if (!hasAnyId(op) && typeof op.nodeType !== "string") throw new Error(`${at}（delete_node）至少要给 id、nodeId、ids 或 nodeType 之一。`);
                break;
            case "delete_connections":
                if (!hasAnyId(op) && !op.connectionId && op.all !== true) throw new Error(`${at}（delete_connections）至少要给 id、connectionId、ids 或 all:true 之一。`);
                break;
            case "connect_nodes":
                if (!(op.fromNodeId || op.sourceNodeId) || !(op.toNodeId || op.targetNodeId)) throw new Error(`${at}（connect_nodes）必须同时给出 fromNodeId 与 toNodeId（也可写 sourceNodeId / targetNodeId）。`);
                break;
            case "set_viewport":
                if (!op.viewport || typeof op.viewport !== "object" || [op.viewport.x, op.viewport.y, op.viewport.k].some((n) => typeof n !== "number")) throw new Error(`${at}（set_viewport）必须给出 viewport:{x,y,k}。`);
                if (op.viewport.k < 0.05 || op.viewport.k > 5) throw new Error(`${at} 的 viewport.k 必须在 0.05–5 之间。`);
                break;
            case "select_nodes":
                if (!Array.isArray(op.ids) || !op.ids.length) throw new Error(`${at}（select_nodes）必须给出非空的 ids 数组。`);
                break;
            case "run_generation":
                if (!op.nodeId) throw new Error(`${at}（run_generation）必须给出要运行的 config 动作节点 nodeId。`);
                break;
            default:
                break;
        }
    }
    return value;
}

const UI_DESCRIPTION = [
    "向用户展示一个分层决策界面（原生单选/多选/短输入/资产选择/摘要确认卡片），等用户选择后再继续。",
    "一次只问一个最关键的问题；同一轮回答里不要同时提交 zodiac-ops。",
    "参数结构就是前端现有的 zodiac-ui 协议：{id,type,question,...}。",
    "Hub 技能里写的 question 工具就是本工具，按同样的形状调用。",
].join("");
const OPS_DESCRIPTION = [
    "向画布提交一个操作提案（新增/修改/删除节点、连线、视口、选中、运行生成），由应用展示并等待用户确认。",
    "每项操作必须用 type 作为操作名，只用本工具 schema 列出的字段。",
    "参数结构就是前端现有的 zodic-ops 协议：{summary,executionMode,ops:[...]}。",
].join("");

// ---------------------------------------------------------------------------
// Hub 工具复用画布的生成、读取与确认流程；供应商请求经服务端代理。
// 当前工具只操作应用内画布与会话，不提供任意本机文件写入。
// ---------------------------------------------------------------------------

const HUB_DESCRIPTION_PREFIX = "Hub 技能约定的工具：";

/** 供模型引用的输入素材：画布节点 id，或会话产物 / 媒体地址。 */
const hubReference = {
    type: "object",
    required: ["nodeId"],
    properties: { nodeId: nodeId, role: text(40, "用途：source_edit / identity / style / layout / scene / first_frame / last_frame / audio / reference；按真实用途和顺序传递"), label: text(80, "素材名"), resultVersionId: text(160, "读取到的媒体版本，可省略"), contentHash: text(64, "读取到的文档哈希，可省略") },
    description: "输入素材。nodeId 必须来自本轮画布快照，模型不要自己编造 id。",
};

/** 生成类工具的公共字段。 */
const hubReferenceList = { type: "array", maxItems: 20, items: hubReference, description: "参考素材列表，可为空" };

export const HUB_TOOL_DEFINITIONS = {
    hub_generate_image: {
        parameters: {
            type: "object",
            required: ["prompt"],
            properties: {
                prompt: text(20000, "生图提示词，直接用技能里写好的成稿"),
                model: text(200, "由用户在画布选择，助手不应指定"),
                size: text(40, "画幅比例，如 1:1 / 16:9；实际像素需符合用户所选模型"),
                count: { type: "integer", minimum: 1, maximum: 10, description: "生成张数；不填按模型的默认数量" },
                references: hubReferenceList,
            },
        },
        description: `${HUB_DESCRIPTION_PREFIX}准备图片生成节点、提示词与参考连线，由用户检查模型后在画布点击运行。返回 prepared / waiting_user 及空结果槽；不可称图片已生成。`,
    },
    hub_generate_video: {
        parameters: {
            type: "object",
            required: ["prompt"],
            properties: {
                prompt: text(20000, "视频提示词，直接用技能里写好的成稿（含时间码分镜、动效术语与 SFX）"),
                model: text(200, "由用户在画布选择，助手不应指定"),
                seconds: { type: "number", minimum: 1, description: "时长（秒）；不填按模型默认" },
                size: text(40, "分辨率或画幅，如 1280x720 / 9:16"),
                references: hubReferenceList,
                videoReferences: { type: "array", maxItems: 10, items: hubReference, description: "参考视频（部分模型不支持）" },
                audioReferences: { type: "array", maxItems: 10, items: hubReference, description: "参考音频（部分模型不支持）" },
            },
        },
        description: `${HUB_DESCRIPTION_PREFIX}准备视频生成节点、提示词与参考连线，由用户检查模型后点击运行。返回 prepared / waiting_user，不发起生成。`,
    },
    hub_generate_audio: {
        parameters: {
            type: "object",
            required: ["text"],
            properties: {
                text: text(20000, "要合成的文本"),
                voice: text(120, "音色 id；不填用默认音色"),
                model: text(200, "由用户在画布选择，助手不应指定"),
                speed: { type: "number", description: "语速" },
                instructions: text(4000, "风格 / 情绪指令"),
            },
        },
        description: `${HUB_DESCRIPTION_PREFIX}准备语音合成节点，由用户选择模型和音色后点击运行。返回 prepared / waiting_user，不发起合成。`,
    },
    hub_generate_music: {
        parameters: {
            type: "object",
            required: ["prompt"],
            properties: { prompt: text(4000, "音乐描述"), lyrics: text(4000, "歌词（可选，纯音乐不要填）"), model: text(200, "模型名") },
        },
        description: `${HUB_DESCRIPTION_PREFIX}音乐生成。在浏览器执行，产物存到服务端媒体并作为音频节点落到当前画布。`,
    },
    hub_video_edit: {
        parameters: {
            type: "object",
            required: ["prompt", "video"],
            properties: { prompt: text(20000, "编辑指令"), video: hubReference, references: hubReferenceList },
        },
        description: `${HUB_DESCRIPTION_PREFIX}按指令编辑或延长一段已有视频。当前渠道不支持该能力时返回明确失败，不要假装成功。`,
    },
    hub_analyse_media: {
        parameters: {
            type: "object",
            required: ["asset"],
            properties: {
                asset: hubReference,
                question: text(500, "想让模型回答的具体问题；不填就做通用描述"),
            },
        },
        description: `${HUB_DESCRIPTION_PREFIX}读取一张图片的内容并返回文字描述（比例、主体、版式、文字层级、色调等）。未随本轮消息附加的图片，需先调用本工具才能描述其画面。`,
    },
    hub_read: {
        parameters: {
            type: "object",
            required: ["nodeId"],
            properties: { nodeId: nodeId, path: text(200, "nodeId 之外的补充说明，如要读的字段名") },
        },
        description: `${HUB_DESCRIPTION_PREFIX}读取当前画布上某个节点已写好的内容（正文、提示词、生成状态），不发起生成。`,
    },
    hub_canvas_get_node: {
        parameters: {
            type: "object",
            required: ["nodeId"],
            properties: { nodeId: nodeId },
        },
        description: `${HUB_DESCRIPTION_PREFIX}按 id 取一个画布节点的完整信息（类型、标题、元数据、连线、媒体地址）。`,
    },
    hub_canvas_list_nodes: {
        parameters: { type: "object", properties: { cursor: text(200, "上一页返回的 nextCursor"), limit: { type: "integer", minimum: 1, maximum: 50 }, type: text(80, "可选节点类型"), groupId: nodeId } },
        description: "分页读取画布节点摘要。定位节点后用 get_node、grep_text 或 read_text 按需读取内容。",
    },
    hub_canvas_grep_text: {
        parameters: { type: "object", required: ["nodeId", "query"], properties: { nodeId, query: text(2000, "要查找的原文，按字面量匹配"), maxMatches: { type: "integer", minimum: 1, maximum: 100 } } },
        description: "在文本节点内搜索原文，返回 contentHash、精确 matchedText 和从 0 开始的 occurrence，供局部编辑使用。",
    },
    hub_canvas_read_text: {
        parameters: { type: "object", required: ["nodeId"], properties: { nodeId, offsetLine: { type: "integer", minimum: 1 }, limitLines: { type: "integer", minimum: 1, maximum: 200 } } },
        description: "按行读取文本窗口，返回 contentHash、标题大纲和截断状态，默认 100 行，最多 200 行及 12000 字符。",
    },
    hub_canvas_write_node: {
        parameters: {
            type: "object",
            required: ["content"],
            properties: {
                kind: { type: "string", enum: ["text"] },
                nodeId,
                name: text(200, "文档名称"),
                content: text(200000, "完整的文本正文，不得仅填写标题或计划"),
                mode: { type: "string", enum: ["replace", "append", "prepend"] },
                expectedContentHash: text(64, "更新已有文本必须传最近读取返回的 hash"),
                sourceNodeIds: { type: "array", items: nodeId, maxItems: 100 },
            },
        },
        description: "将完整正文保存为画布文本节点；可更新已有文档。新增返回真实 nodeId 和 contentHash，更新必须使用最近读取的版本 hash。",
    },
    hub_canvas_apply_text_edits: {
        parameters: {
            type: "object",
            required: ["nodeId", "expectedContentHash", "edits"],
            properties: {
                nodeId,
                expectedContentHash: text(64, "最近读取的 contentHash"),
                edits: {
                    type: "array",
                    minItems: 1,
                    maxItems: 100,
                    items: {
                        type: "object",
                        required: ["exact", "replacement"],
                        properties: { exact: text(200000, "需要替换的精确原文"), replacement: text(200000, "替换后的文本，可为空"), occurrence: { type: "integer", minimum: 0, description: "重复锚点的序号，从 0 开始" } },
                    },
                },
            },
        },
        description: "原子应用一批精确锚点编辑。旧 hash、歧义锚点、重叠范围或不存在的原文会拒绝整批修改；冲突后重新搜索，不得用整篇覆盖绕过。",
    },
    hub_canvas_group_nodes: {
        parameters: { type: "object", required: ["nodeIds"], properties: { nodeIds: { type: "array", minItems: 1, maxItems: 100, items: nodeId }, label: text(40, "分组名称") } },
        description: "将明确指定的节点组成真实画布分组。选择多个顶层分组时合并其成员；返回 groupId 和 groupedCount，已有外部分组成员须先解组。",
    },
    hub_canvas_ungroup_node: {
        parameters: { type: "object", required: ["nodeId"], properties: { nodeId } },
        description: "移除分组容器，保留所有子节点、位置和成员间连线。",
    },
    hub_canvas_group_recent_outputs: {
        parameters: { type: "object", properties: { label: text(40, "分组名称") } },
        description: "将当前会话本轮新产物组成真实画布分组；不包含历史或其他会话节点。少于两项或缺少会话范围时返回无操作原因。",
    },
    hub_save_file_to_session: {
        parameters: {
            type: "object",
            required: ["path"],
            properties: {
                path: text(400, "会话内的相对文件名，如 storyboard/shot-01.md；或用 `素材` 指定要落盘的画布产物"),
                content: text(200000, "文件正文；写文本文件时必填"),
                asset: hubReference,
                description: text(300, "这份文件是什么，给创作者看的说明"),
            },
        },
        description: `${HUB_DESCRIPTION_PREFIX}把文本或已保存的画布素材写入本会话工作空间，返回相对路径。写入需要用户确认，不能编造文件。`,
    },
};

for (const [name, fields] of Object.entries({
    hub_generate_image: ["quality", "background", "imageWatermark", "imageOptimizePrompt", "imagePromptPrefix"],
    hub_generate_video: ["vquality", "generateAudio", "watermark"],
    hub_generate_audio: ["format"],
})) {
    for (const field of fields) HUB_TOOL_DEFINITIONS[name].parameters.properties[field] = text(4000, `可选的 ${field} 参数，按所选模型支持范围填写`);
}

for (const name of ["hub_generate_image", "hub_generate_video", "hub_generate_audio", "hub_canvas_write_node", "hub_canvas_apply_text_edits", "hub_canvas_group_nodes", "hub_canvas_group_recent_outputs", "hub_canvas_ungroup_node"]) {
    HUB_TOOL_DEFINITIONS[name].parameters.properties.operationId = text(200, "本次操作的稳定 ID；重试保持相同，新的操作必须使用新 ID");
}

/** 可提供给 Zodiac 的 Hub 工具目录。 */
export const HUB_TOOL_NAMES = Object.keys(HUB_TOOL_DEFINITIONS);
