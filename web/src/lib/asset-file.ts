export type AssetFileCategory = "document" | "data" | "text" | "archive" | "model" | "design" | "code" | "other";
export type ImportedFileKind = "image" | "video" | "audio" | "file";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac"]);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "ogg", "flac"]);

const MIME_BY_EXTENSION: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    rtf: "application/rtf",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
    epub: "application/epub+zip",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    json: "application/json",
    jsonl: "application/x-ndjson",
    yaml: "application/yaml",
    yml: "application/yaml",
    xml: "application/xml",
    toml: "application/toml",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    ts: "text/plain",
    tsx: "text/plain",
    jsx: "text/plain",
    py: "text/x-python",
    rs: "text/plain",
    go: "text/plain",
    java: "text/plain",
    c: "text/plain",
    h: "text/plain",
    cpp: "text/plain",
    zip: "application/zip",
    gz: "application/gzip",
    tar: "application/x-tar",
    "7z": "application/x-7z-compressed",
    rar: "application/vnd.rar",
    obj: "model/obj",
    stl: "model/stl",
    gltf: "model/gltf+json",
    glb: "model/gltf-binary",
    fbx: "application/octet-stream",
    blend: "application/octet-stream",
    psd: "image/vnd.adobe.photoshop",
    ai: "application/postscript",
    fig: "application/octet-stream",
    sketch: "application/zip",
};

const CATEGORY_EXTENSIONS: Record<Exclude<AssetFileCategory, "other">, Set<string>> = {
    document: new Set(["pdf", "doc", "docx", "rtf", "odt", "epub", "ppt", "pptx", "odp"]),
    data: new Set(["csv", "tsv", "xls", "xlsx", "ods", "json", "jsonl", "yaml", "yml", "xml", "toml", "parquet", "sqlite", "db"]),
    text: new Set(["txt", "md", "markdown", "log"]),
    archive: new Set(["zip", "7z", "rar", "tar", "gz", "bz2", "xz"]),
    model: new Set(["obj", "fbx", "stl", "gltf", "glb", "blend", "dae", "usd", "usdz"]),
    design: new Set(["psd", "ai", "fig", "sketch", "xd"]),
    code: new Set(["js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "h", "cpp", "hpp", "swift", "kt", "rb", "php", "sh", "sql", "css", "html", "htm", "vue", "svelte"]),
};

export function classifyImportedFile(file: Pick<File, "name" | "type">): ImportedFileKind {
    const mimeType = normalizeMimeType(file.type);
    const extension = fileExtension(file.name);
    const canUseExtension = !mimeType || mimeType === "application/octet-stream";
    if (IMAGE_MIME_TYPES.has(mimeType) || (canUseExtension && IMAGE_EXTENSIONS.has(extension))) return "image";
    if (VIDEO_MIME_TYPES.has(mimeType) || (canUseExtension && VIDEO_EXTENSIONS.has(extension))) return "video";
    if (AUDIO_MIME_TYPES.has(mimeType) || (canUseExtension && AUDIO_EXTENSIONS.has(extension))) return "audio";
    return "file";
}

export function fileExtension(fileName: string) {
    const leaf = fileName.replace(/\\/gu, "/").split("/").at(-1) || "";
    const index = leaf.lastIndexOf(".");
    return index > 0 && index < leaf.length - 1 ? leaf.slice(index + 1).toLocaleLowerCase() : "";
}

export function inferAssetFileMimeType(file: Pick<File, "name" | "type">) {
    const mimeType = normalizeMimeType(file.type);
    if (isWellFormedMimeType(mimeType)) return mimeType;
    return MIME_BY_EXTENSION[fileExtension(file.name)] || "application/octet-stream";
}

export function assetFileCategory(fileName: string, mimeType = ""): AssetFileCategory {
    const extension = fileExtension(fileName);
    for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS) as Array<[Exclude<AssetFileCategory, "other">, Set<string>]>) {
        if (extensions.has(extension)) return category;
    }
    const type = normalizeMimeType(mimeType);
    if (type === "application/pdf" || type.startsWith("application/vnd.openxmlformats-officedocument") || type.startsWith("application/vnd.oasis.opendocument")) return "document";
    if (type.startsWith("text/")) return "text";
    if (type.startsWith("model/")) return "model";
    return "other";
}

export function assetFileCategoryLabel(category: AssetFileCategory) {
    const labels: Record<AssetFileCategory, string> = { document: "文档", data: "数据", text: "文本文件", archive: "压缩包", model: "3D 模型", design: "设计文件", code: "代码", other: "文件" };
    return labels[category];
}

export function safeOriginalFileName(value: string, fallback = "文件") {
    const leaf = value.replace(/\\/gu, "/").split("/").at(-1)?.trim() || fallback;
    const safe = Array.from(leaf)
        .filter((character) => !/[\u0000-\u001f\u007f]/u.test(character))
        .join("")
        .replace(/[/:]/gu, "-")
        .slice(0, 180)
        .trim();
    return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

function normalizeMimeType(value: string) {
    const normalized = value.split(";", 1)[0].trim().toLocaleLowerCase();
    if (normalized === "image/jpg") return "image/jpeg";
    if (normalized === "audio/mp3") return "audio/mpeg";
    if (normalized === "audio/x-flac") return "audio/flac";
    return normalized;
}

function isWellFormedMimeType(value: string) {
    return value.length > 2 && value.length <= 120 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value);
}
