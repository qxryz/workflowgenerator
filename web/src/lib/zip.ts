import { unzipSync, zipSync } from "fflate";

type ZipFile = {
    name: string;
    data: BlobPart;
};

const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4096;
const MAX_COMPRESSION_RATIO = 200;

function assertSafeArchivePath(name: string) {
    if (!name || name.length > 512 || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/u.test(name) || /[\0-\x1f\x7f]/u.test(name)) {
        throw new Error("压缩包包含无效文件名");
    }
    const parts = name.replace(/\/$/u, "").split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("压缩包包含越界文件路径");
}

export async function createZip(files: ZipFile[]) {
    if (files.length > MAX_ZIP_ENTRIES) throw new Error("导出文件数量过多");
    const names = new Set<string>();
    files.forEach((file) => {
        assertSafeArchivePath(file.name);
        if (names.has(file.name)) throw new Error("导出文件名重复");
        names.add(file.name);
    });
    const entries = await Promise.all(
        files.map(async (file) => {
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [file.name, data] as const;
        }),
    );
    return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

export async function readZip(file: Blob) {
    if (file.size > MAX_ZIP_BYTES) throw new Error("压缩包过大，无法导入");
    let entryCount = 0;
    let declaredExpandedBytes = 0;
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter(info) {
            entryCount += 1;
            if (entryCount > MAX_ZIP_ENTRIES) throw new Error("压缩包文件数量过多");
            assertSafeArchivePath(info.name);
            if (info.originalSize > MAX_ZIP_ENTRY_BYTES) throw new Error("压缩包中的单个文件过大");
            declaredExpandedBytes += info.originalSize;
            if (declaredExpandedBytes > MAX_ZIP_EXPANDED_BYTES) throw new Error("压缩包解压后体积过大");
            if (info.originalSize > 0 && (info.size === 0 || info.originalSize / info.size > MAX_COMPRESSION_RATIO)) throw new Error("压缩包压缩比例异常");
            return !info.name.endsWith("/");
        },
    });
    const actualExpandedBytes = Object.values(entries).reduce((total, data) => total + data.byteLength, 0);
    if (actualExpandedBytes > MAX_ZIP_EXPANDED_BYTES || actualExpandedBytes > declaredExpandedBytes) throw new Error("压缩包解压后体积异常");
    return new Map(Object.entries(entries).map(([name, data]) => [name, new Blob([data])]));
}
