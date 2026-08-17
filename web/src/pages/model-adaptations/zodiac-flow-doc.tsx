const FLOW_STEPS = [
    { name: "描述", detail: "用户在对话中输入目标，可附加图片和 Zodiac 专属技能；当前画布作为只读快照一并读取。" },
    { name: "组装", detail: "Zodiac 把画布快照、会话摘要、已启用的专属技能、本轮附加技能合并成 system prompt 交给文本模型。" },
    { name: "回复", detail: "模型流式回复，思考过程、用户可见文案与结构化协议分离解析。" },
    { name: "提案", detail: "需要改动画布时，回复末尾输出 zodic-ops JSON，应用把它解析成结构化操作并生成工作单。" },
    { name: "确认", detail: "guided 模式在对话卡片中等待用户确认；只有用户明确要求全自动时才使用 automatic 直接执行。" },
    { name: "执行", detail: "操作通过合法性、类型与循环校验后应用到画布；run_generation 启动真实生成任务。" },
    { name: "交付", detail: "结果写入动作绑定的结果槽并保留版本；下游沿连线自动取最后一个有效版本继续。" },
];

const TOOL_CONTRACT = [
    { type: "add_node", detail: "创建 text / config / image / video / audio / terminal / group 节点。生成动作使用 config 节点，并通过 metadata.generationMode 声明输出类型。" },
    { type: "update_node", detail: "修改节点标题、位置、尺寸或生成参数；节点类型变化会重新派生输出槽并迁移下游引用。" },
    { type: "delete_node", detail: "移除节点及其关联连线；已绑定生成结果的节点受恢复与安全检查约束。" },
    { type: "connect_nodes", detail: "把上游结果槽连接到下游动作；连线必须类型兼容，禁止 config → config。" },
    { type: "delete_connections", detail: "断开一条或全部连线；后续执行根据剩余拓扑重新推导依赖。" },
    { type: "run_generation", detail: "在动作节点上执行一次真实生成，text / image / video / audio 均可，必须绑定同类型空结果槽。" },
    { type: "set_viewport", detail: "调整画布缩放与平移位置，不产生数据。" },
    { type: "select_nodes", detail: "聚焦或选中一组节点，为下一轮操作提供选中上下文。" },
];

const RUN_STATES = [
    { state: "queued", label: "即将开始", detail: "已进入运行队列，等待依赖就绪。" },
    { state: "waiting_inputs", label: "等待", detail: "等待上游结果槽写入第一个有效版本。" },
    { state: "running", label: "进行中", detail: "真实生成或终端任务执行中。" },
    { state: "persisting", label: "保存中", detail: "结果正在写入资产与版本记录。" },
    { state: "waiting_review", label: "待检查", detail: "结果已就绪，等待确认后继续。" },
    { state: "completed", label: "已完成", detail: "结果已保存，可继续下游。" },
    { state: "error", label: "失败", detail: "本步骤未完成，可重试。" },
    { state: "stopped", label: "已停止", detail: "运行被暂停，可稍后继续。" },
    { state: "blocked", label: "等待处理", detail: "上游失败或未完成，本步骤被阻塞。" },
];

export function ZodiacFlowDoc() {
    return (
        <article className="mb-10 max-w-[820px]" aria-label="Zodiac 工作流技术说明">
            <div className="mb-7 border-b border-[#e7eaed] pb-6 dark:border-slate-700">
                <div className="mb-3 text-[12px] text-[#7d8790] dark:text-slate-400">其他 / Zodiac 工作流技术说明</div>
                <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-[#182027] dark:text-white">Zodiac 工作流技术说明</h2>
                <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[#65717a] dark:text-slate-300">
                    一条目标从描述到最终结果交付，Zodiac 会经过上下文组装、结构提案、校验执行与版本交付四层。本文说明每一层的技术约定。
                </p>
            </div>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">一、从描述到交付的完整链路</h3>
                <ol className="mt-4 space-y-3">
                    {FLOW_STEPS.map((step, index) => (
                        <li key={step.name} className="flex items-start gap-3">
                            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#117c8e] text-[11px] font-bold text-white">{index + 1}</span>
                            <div className="min-w-0">
                                <span className="text-[14px] font-semibold text-[#24313a] dark:text-slate-100">{step.name}</span>
                                <p className="mt-0.5 text-[14px] leading-7 text-[#52616a] dark:text-slate-300">{step.detail}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            </section>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">二、画布工具协议</h3>
                <p className="mt-2 text-[14px] leading-7 text-[#65717a] dark:text-slate-300">
                    Zodiac 对画布的每一次改动都来自下方八种操作。所有操作要求稳定且唯一的节点 id；结果槽必须直接使用产物类型（text / image / video / audio），动作节点（config / terminal）本身不能作为下游输入。
                </p>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[620px] border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-[#e0e5e8] text-left dark:border-slate-700">
                                <th className="py-2.5 pr-4 font-semibold text-[#45525b] dark:text-slate-300">操作</th>
                                <th className="py-2.5 font-semibold text-[#45525b] dark:text-slate-300">说明</th>
                            </tr>
                        </thead>
                        <tbody>
                            {TOOL_CONTRACT.map((tool) => (
                                <tr key={tool.type} className="border-b border-[#edf0f2] align-top dark:border-slate-800">
                                    <td className="w-44 py-2.5 pr-4">
                                        <code className="rounded bg-[#f1f4f6] px-1.5 py-0.5 font-mono text-[12px] text-[#0d6b7a] dark:bg-slate-800 dark:text-teal-300">{tool.type}</code>
                                    </td>
                                    <td className="py-2.5 text-[13px] leading-6 text-[#52616a] dark:text-slate-300">{tool.detail}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">三、执行模式与执行前校验</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-[#e0e5e8] bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <code className="font-mono text-[12px] text-[#0d6b7a] dark:text-teal-300">executionMode: guided</code>
                        <p className="mt-2 text-[13px] leading-6 text-[#52616a] dark:text-slate-300">默认模式。提案先以原生卡片展示，用户确认后才会改动画布；每一步结果都可由用户检查。</p>
                    </div>
                    <div className="rounded-lg border border-[#e0e5e8] bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <code className="font-mono text-[12px] text-[#0d6b7a] dark:text-teal-300">executionMode: automatic</code>
                        <p className="mt-2 text-[13px] leading-6 text-[#52616a] dark:text-slate-300">只有用户明确要求“全自动 / 直接跑完 / 无需确认”时才使用，整条工作流连续执行。</p>
                    </div>
                </div>
                <ul className="mt-4 space-y-2 text-[14px] leading-7 text-[#52616a] dark:text-slate-300">
                    <li>每个动作必须绑定类型兼容的结果槽，等待中的槽位可以预先绑定，完成后沿同一身份自动生效。</li>
                    <li>上游必须就绪：只有已选中且有效的版本才能作为输入；多版本来源自动取最后一个有效版本。</li>
                    <li>执行前校验连线合法性、类型匹配与循环依赖，任何一项不通过都不会改动画布。</li>
                    <li>工作单（work order）记录每个动作的提示词、直接上游输入与归属输出槽；自动执行与结果槽自身的继续设置相互独立。</li>
                </ul>
            </section>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">四、技能如何进入上下文</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-[#e0e5e8] bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="text-[14px] font-semibold text-[#24313a] dark:text-slate-100">Zodiac 专属技能</div>
                        <p className="mt-2 text-[13px] leading-6 text-[#52616a] dark:text-slate-300">
                            在 Skills 面板标记为“Zodiac 专属”。只出现在 Zodiac 对话框中，点击即附加到当前对话；技能正文随该轮消息注入 system prompt，不会进入终端节点环境。
                        </p>
                    </div>
                    <div className="rounded-lg border border-[#e0e5e8] bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <div className="text-[14px] font-semibold text-[#24313a] dark:text-slate-100">终端可用技能</div>
                        <p className="mt-2 text-[13px] leading-6 text-[#52616a] dark:text-slate-300">
                            在画布终端节点的设置中启用，通过 $WG_SKILLS_INDEX 提供给终端会话；Zodiac 上下文不会注入终端技能。
                        </p>
                    </div>
                </div>
                <p className="mt-3 text-[14px] leading-7 text-[#65717a] dark:text-slate-300">
                    已启用的 Zodiac 专属技能始终在上下文中；对话框中附加的技能只对当前对话生效，两者按 id 去重。
                </p>
            </section>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">五、运行状态与结果交付</h3>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[620px] border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-[#e0e5e8] text-left dark:border-slate-700">
                                <th className="py-2.5 pr-4 font-semibold text-[#45525b] dark:text-slate-300">状态</th>
                                <th className="py-2.5 pr-4 font-semibold text-[#45525b] dark:text-slate-300">含义</th>
                                <th className="py-2.5 font-semibold text-[#45525b] dark:text-slate-300">说明</th>
                            </tr>
                        </thead>
                        <tbody>
                            {RUN_STATES.map((item) => (
                                <tr key={item.state} className="border-b border-[#edf0f2] align-top dark:border-slate-800">
                                    <td className="w-44 py-2.5 pr-4">
                                        <code className="rounded bg-[#f1f4f6] px-1.5 py-0.5 font-mono text-[12px] text-[#0d6b7a] dark:bg-slate-800 dark:text-teal-300">{item.state}</code>
                                    </td>
                                    <td className="w-32 py-2.5 pr-4 font-medium text-[#34414a] dark:text-slate-200">{item.label}</td>
                                    <td className="py-2.5 text-[13px] leading-6 text-[#52616a] dark:text-slate-300">{item.detail}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <ul className="mt-4 space-y-2 text-[14px] leading-7 text-[#52616a] dark:text-slate-300">
                    <li>每次生成写入结果槽时保留版本记录；失败或中断的版本不会覆盖最后一个可用结果。</li>
                    <li>运行快照全局共享：画布、对话与运行控制台看到同一份进度与产物。</li>
                    <li>文本结果可发布为输出槽内容传给下游；图片 / 视频 / 音频写入 $WG_OUTPUT_DIR 或执行 wg-output 后自动进入画布。</li>
                </ul>
            </section>

            <section>
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">六、上下文、安全与恢复</h3>
                <ul className="mt-4 space-y-2 text-[14px] leading-7 text-[#52616a] dark:text-slate-300">
                    <li>画布快照只读：节点、连线、结果槽状态、选中项与终端配置都来自真实画布，模型不得臆造 id。</li>
                    <li>长会话自动摘要压缩：超出窗口的历史被压缩为摘要，保留目标、决策、结构与未完成事项。</li>
                    <li>决策界面 zodiac-ui 与画布操作 zodic-ops 在同一轮回复中互斥，先收齐选择再输出提案。</li>
                    <li>所有操作使用稳定 id，重复执行不会复制节点或连线；类型不匹配或被迁移的引用会自动修正。</li>
                    <li>旧提案无法按当前画布安全恢复时会被标记为拒绝，不会执行；中断的运行保留最后可用版本并允许重试。</li>
                </ul>
            </section>
        </article>
    );
}
