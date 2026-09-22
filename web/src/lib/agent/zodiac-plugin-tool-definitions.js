const nodeId = { type: "string", minLength: 1, maxLength: 128, description: "当前画布上已存在的插件节点 id" };
export const PLUGIN_AGENT_TOOL_DEFINITIONS = {
    hub_plugin_agent_describe: {
        description: "读取当前插件节点已声明的 Agent 方法、参数和读写能力。没有声明方法的插件会明确报错，不要猜测方法。",
        parameters: { type: "object", properties: { nodeId }, required: ["nodeId"], additionalProperties: false },
    },
    hub_plugin_agent_invoke: {
        description: "调用当前插件节点目录中声明的方法。先 describe，再读取文档；写入必须携带读取回执的 expectedRevision。仅修改目标节点声明的字段，返回已持久化并核验的回执。冲突时先重新读取，勿盲目重试。",
        parameters: {
            type: "object", required: ["nodeId", "method"], additionalProperties: false,
            properties: {
                nodeId,
                method: { type: "string", minLength: 1, maxLength: 80, description: "describe 返回的方法名" },
                args: { type: "object", description: "严格符合对应方法 inputSchema 的参数" },
                expectedRevision: { type: "string", minLength: 1, maxLength: 160, description: "写入时必须原样使用最近一次读取回执的 revision" },
            },
        },
    },
};
