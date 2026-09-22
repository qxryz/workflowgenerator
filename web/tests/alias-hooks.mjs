/** `@/` 别名解析钩子本体，由 alias-loader.mjs 通过 module.register 装载。 */
import { pathToFileURL } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const srcUrl = pathToFileURL(path.join(projectRoot, "src") + path.sep).href;

export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
        const target = specifier.slice(2);
        // 源码里两种写法都有：带扩展名与不带的，逐个候选试。
        const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`];
        const tried = [];
        for (const candidate of candidates) {
            const url = new URL(candidate, srcUrl).href;
            try {
                return await nextResolve(url, context);
            } catch (error) {
                tried.push(`${candidate}（${error.code ?? "ERR"}）`);
            }
        }
        throw new Error(`无法解析别名导入：${specifier}；已尝试 ${tried.join("、")}`);
    }
    return nextResolve(specifier, context);
}
