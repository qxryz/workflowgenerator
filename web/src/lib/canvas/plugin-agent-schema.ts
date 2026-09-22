import { Validator } from "jsonschema";
import type { CanvasPluginAgentSurface } from "../../types/canvas-plugin";

const validator = new Validator();
const keyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

export function assertPluginAgentSurface(surface: CanvasPluginAgentSurface) {
    if (!surface || typeof surface.instructions !== "string" || !Array.isArray(surface.methods) || !surface.methods.length || surface.methods.length > 32) throw new Error("插件 Agent 方法目录无效");
    const names = new Set<string>();
    for (const method of surface.methods) {
        if (!keyPattern.test(method.name) || names.has(method.name) || typeof method.description !== "string" || typeof method.invoke !== "function" || !["read", "write"].includes(method.effect)) throw new Error("插件 Agent 方法声明无效");
        names.add(method.name);
        const schema = method.inputSchema;
        if (!schema || schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties) || schema.additionalProperties !== false) throw new Error(`插件方法 ${method.name} 必须声明严格对象参数 schema`);
        // The mature interpreter performs JSON Schema validation, without generated functions or eval.
        validator.validate({}, schema, { allowUnknownAttributes: false });
        if (method.effect === "read" && method.metadataKeys?.length) throw new Error("只读插件方法不得声明写入字段");
        if (method.effect === "write" && (!method.metadataKeys?.length || method.metadataKeys.some(key => !keyPattern.test(key) || ["constructor", "prototype", "__proto__"].includes(key)))) throw new Error("写入插件方法必须声明自身 metadata 字段");
    }
}

export function validatePluginMethodArgs(schema: Record<string, unknown>, args: unknown) {
    const validation = validator.validate(args, schema, { allowUnknownAttributes: false });
    if (!validation.valid) throw new Error(`参数校验失败：${validation.errors.map(error => `${error.property} ${error.message}`).join("；")}`);
}
