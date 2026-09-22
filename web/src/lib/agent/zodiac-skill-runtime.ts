type SkillRuntimeInput = { body: string; files?: Array<{ path: string; content: string }> };
type RequirementKind = "script_execution" | "local_dependency" | "minimax_gateway" | "minimax_storage" | "unadapted_tool" | "missing_file";
type Requirement = {
    kind: RequirementKind;
    capability: string;
    status: "unsupported" | "available" | "check_required";
    files: string[];
    detail: string;
};

const executable = /\.(?:py|mjs|js|ts|sh|ps1|jsx)$/i;
const safeRelativePath = (path: string) => path && !path.includes("\\") && !path.includes(":") && !path.split("/").some((part) => !part || part === "." || part === "..") && !/[\x00-\x1f]/.test(path);

/** Reports concrete runtime dependencies without treating readable guidance as a completed integration. */
export function buildZodiacSkillRuntimeReport(skill: SkillRuntimeInput) {
    const files = new Map<string, string>([["SKILL.md", skill.body]]);
    for (const file of skill.files ?? []) if (safeRelativePath(file.path) && typeof file.content === "string" && file.path !== "SKILL.md") files.set(file.path, file.content);
    const scriptFiles = [...files.keys()].filter((path) => path.split("/").includes("scripts") && executable.test(path));
    const requirements: Requirement[] = [];
    const matchingFiles = (pattern: RegExp) => [...files].filter(([, content]) => pattern.test(content)).map(([path]) => path);
    const add = (kind: RequirementKind, capability: string, paths: string[], detail: string) => {
        if (!paths.length) return;
        requirements.push({ kind, capability, files: [...new Set(paths)], detail, status: "unsupported" });
    };
    if (scriptFiles.length) requirements.push({ kind: "script_execution", capability: "技能脚本执行", files: scriptFiles, status: "available", detail: "脚本已同步到会话工作区，可通过原生文件与命令工具执行；需用户批准写入或运行，并核实脚本所需依赖。" });
    add(
        "minimax_gateway",
        "MiniMax 应用连接器协议",
        matchingFiles(/\/api\/connectors\/prepare|HILO_WORKSPACE_(?:CLAIM|INSTANCE_ID|GENERATION)/),
        "这些步骤依赖 MiniMax Gateway 与工作区绑定，本应用未提供该协议；桌面应用不会自动补齐它。请使用宿主真实可用的应用连接器，不能伪造 Gateway。",
    );
    add("minimax_storage", "MiniMax 媒体索引", matchingFiles(/\.hilo[\s\S]{0,120}(?:assets\.json|\.blobs)/), "这些步骤读取 MiniMax 的媒体索引或 blobs。当前画布媒体保存在本应用数据目录，不能假设存在旧目录；需要真实媒体导出与索引适配后才能执行这些步骤。");

    const mediaIndex = requirements.find(requirement => requirement.kind === "minimax_storage");
    if (mediaIndex) { mediaIndex.status = "check_required"; mediaIndex.detail = "当前画布已保存素材会导出为会话 .hilo/assets.json 与 .hilo/.blobs；基础索引可读取，但须核对旧脚本需要的字段、产物命名和实际媒体，不能推断所有旧脚本兼容。"; }
    const missingTools: Array<[RegExp, string, string]> = [
        [/\bhub_generate_music\b|\bmusic_generation_[a-z_]+\b/, "音乐生成", "当前没有已接入的音乐生成工具，不得用语音合成替代。"],
        [/\bhub_video_edit\b/, "视频编辑或延长", "当前 Hub 工具没有接入此任务，不能将编辑请求改成重新生成。"],
        [/\bread_media\b/, "read_media 输入契约", "旧工具使用 file_path/file_paths，不能原样调用。已在画布上的单张图片可映射到 hub_analyse_media(asset.nodeId)；视频、音频和 PDF 分析尚未由该工具支持。"],
        [/\baudios_generation\b/, "旧批量语音生成接口", "旧接口的 texts/voice_id/filenames 与音频索引回执未适配。单段语音可映射到 hub_generate_audio(text,voice)，不能据此承诺旧脚本或批量流程兼容。"],
        [/\bget_voice_id\b/, "语义音色搜索", "当前没有 get_voice_id 工具；只能使用已配置供应商的真实音色，不能把旧音色 ID 自动套用到另一供应商。"],
        [/\baudio_meta\b/, "旧音频元数据工具", "当前没有 audio_meta 工具；需要对实际媒体执行受权限的元数据读取。"],
        [/\bmv_final_assembly\b/, "媒体时间线合成", "当前没有 mv_final_assembly 工具；宿主 FFmpeg 能力需要另外核实，并保证输入和产物已真实落盘。"],
        [/\bhub_browser\b|\bwebfetch\b/, "旧网页或内置浏览器工具", "当前工具目录不提供这些旧工具；仅能使用宿主明确提供的浏览或网页读取能力。"],
        [/subagent_type\s*[:=]\s*["']editing["']/, "旧编辑子 Agent", "task 支持 router/planner/executor；旧 editing 角色需要明确映射到有实际工具支持的 executor 任务。"],
    ];
    for (const [pattern, name, detail] of missingTools) add("unadapted_tool", name, matchingFiles(pattern), detail);

    const codeFiles = [...files].filter(([path]) => executable.test(path));
    for (const [pattern, capability] of [
        [/\b(?:from|import)\s+PIL\b/, "Python Pillow"],
        [/\b(?:from|import)\s+numpy\b/, "Python NumPy"],
        [/\b(?:from|import)\s+pyJianYingDraft\b/, "Python pyJianYingDraft"],
        [/\b(?:from|import)\s+bpy\b/, "Blender Python"],
        [/\b(?:from|import)\s+hou\b/, "Houdini Python"],
        [/["']ffmpeg["']|\bffmpeg\s+-/, "FFmpeg"],
        [/["']ffprobe["']|\bffprobe\s+-/, "FFprobe"],
    ] as Array<[RegExp, string]>)
        add(
            "local_dependency",
            capability,
            codeFiles.filter(([, content]) => pattern.test(content)).map(([path]) => path),
            "先通过命令工具核实依赖是否安装；缺少依赖时明确报告，不能声称脚本已完成。",
        );

    for (const requirement of requirements) if (requirement.kind === "local_dependency") requirement.status = "check_required";
    for (const [path, content] of files) {
        if (!path.endsWith(".md")) continue;
        for (const match of content.matchAll(/\b(?:python3?|node|bash)\s+([^\s`]+\.(?:py|mjs|js|sh))(?=[\s`]|$)/g)) {
            const commandPath = match[1];
            const index = commandPath.indexOf("scripts/");
            if (index < 0) continue;
            const relative = commandPath.slice(index);
            if (!safeRelativePath(relative)) continue;
            if (![...files.keys()].some((file) => file === relative || file.endsWith(`/${relative}`))) add("missing_file", relative, [path], "正文命令引用了技能包中未提供的脚本；不能报告校验成功，也不能凭空执行该文件。");
        }
    }
    const toolMappings: Array<{ from: string; to: string; note: string }> = [];
    if (matchingFiles(/\bquestion\b|\bAskUserQuestion\b/).length) toolMappings.push({ from: "question / AskUserQuestion", to: "zodiac-ui", note: "按当前决策卡 schema 收集答案；技能中的问答不自动授予生成、命令或发布权限。" });
    toolMappings.push({ from: "技能文件、references、scripts", to: "skill(name,path)", note: "使用文件清单中的相对 path 按需读取，保留完整目录结构；此工具只读，不提供旧安装路径。" });
    if (matchingFiles(/\bhub_read\b/).length) toolMappings.push({ from: "hub_read", to: "hub_canvas_get_node / skill", note: "画布读取必须提供真实 nodeId；技能中的模板文件路径交给 skill(name,path)，不能将路径当 nodeId。" });
    return {
        guidanceReadable: true,
        scriptFiles,
        requirements,
        toolMappings,
        summary: "技能正文和已列出的资源可作为指导。下面只报告已发现的具体依赖，不代表全流程已经验证；未命中的外部能力仍以当前工具目录、用户授权和真实执行回执为准。",
    };
}
