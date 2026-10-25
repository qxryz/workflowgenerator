/** The model's reply could not be turned into a proposal; the message goes back to the model as a correction. */
export class ParseError extends Error {}

/** First balanced `{…}` (or `[…]`) in `text` that parses, ignoring fences and surrounding prose. */
export function extractJson(text: string, open: "{" | "[" = "{"): unknown {
    const close = open === "{" ? "}" : "]";
    let failure = "";
    for (let start = text.indexOf(open); start >= 0; start = text.indexOf(open, start + 1)) {
        const end = balancedEnd(text, start, open, close);
        if (end < 0) {
            failure ||= "JSON 没有闭合，输出可能不完整";
            continue;
        }
        const block = text.slice(start, end + 1);
        try {
            return JSON.parse(block);
        } catch (error) {
            try {
                return JSON.parse(escapeControls(block));
            } catch {
                failure ||= `JSON 格式有误：${error instanceof Error ? error.message : "无法解析"}`;
                start = end;
            }
        }
    }
    throw new ParseError(failure || `输出中没有找到 JSON ${open === "{" ? "对象" : "数组"}`);
}

function balancedEnd(text: string, start: number, open: string, close: string) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            if (char === "\\") i += 1;
            else if (char === '"') inString = false;
        } else if (char === '"') inString = true;
        else if (char === open) depth += 1;
        else if (char === close && --depth === 0) return i;
    }
    return -1;
}

/** Models often put raw line breaks inside long string values. */
function escapeControls(json: string) {
    let inString = false;
    let out = "";
    for (let i = 0; i < json.length; i += 1) {
        const char = json[i];
        if (inString && char === "\\") out += char + json[++i];
        else if (char === '"') {
            inString = !inString;
            out += char;
        } else out += inString && char < " " ? JSON.stringify(char).slice(1, -1) : char;
    }
    return out;
}

export type Obj = Record<string, unknown>;

export function asObject(value: unknown, what: string): Obj {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ParseError(`${what}必须是对象`);
    return value as Obj;
}

/** Required array field of the reply root. */
export function asArray(root: Obj, key: string): Obj[] {
    const value = root[key];
    if (!Array.isArray(value)) throw new ParseError(`缺少 ${key} 数组`);
    return value.map((item, index) => asObject(item, `${key}[${index}]`));
}

export const str = (value: unknown) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
export const num = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) && value !== "" && value !== null ? Number(value) : fallback);
export const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : value === "true" ? true : value === "false" ? false : fallback);
export const strings = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : str(value) ? [str(value)] : []);
