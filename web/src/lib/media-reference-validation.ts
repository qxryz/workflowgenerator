/** A missing or non-image read must never become a text-only generation request. */
export function requireReferenceImageDataUrl(value: string, name?: string) {
    const content = value.match(/^data:image\/[^;,]+;base64,([\s\S]+)$/i)?.[1];
    if (!content?.trim()) throw new Error(`参考图${name ? `「${name}」` : ""}读取失败或内容无效，请重新添加该图片`);
    return value;
}
