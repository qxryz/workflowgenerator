// Loaded from the application bundle. The model never supplies its own role.
export const ZodiacContext = async () => {
    const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}");
    const bridge = config.mcp?.wg;
    if (!bridge?.url || !bridge.headers?.Authorization) throw new Error("Zodiac context bridge is unavailable");
    return {
        "tool.execute.before": async (input, output) => {
            const native = ["bash", "write", "edit", "task"].includes(input.tool);
            if (!native && !input.tool.startsWith("wg_")) return;
            // Always replace any model-provided ticket; only this hook can attest a call.
            delete output.args._wg_ticket;
            const response = await fetch(new URL("/context", bridge.url), {
                method: "POST",
                headers: { ...bridge.headers, "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: input.sessionID, callId: input.callID, name: native ? input.tool : input.tool.slice(3), native, args: output.args }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "无法确认子任务身份");
            if (!native) output.args._wg_ticket = result.ticket;
        },
    };
};
