import { Copy, Download, File as FileIcon, PencilLine, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Card, Drawer, Dropdown, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Spin, Tag, Typography } from "antd";
import { saveAs } from "file-saver";

import { AuthorNote } from "@/components/author-library/author-note";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, formatDuration, readFileAsDataUrl } from "@/lib/image-utils";
import { assetFileCategoryLabel } from "@/lib/asset-file";
import { getAssetFileBlob } from "@/services/asset-file-storage";
import { stageAssetImport } from "@/services/asset-import";
import { uploadImage } from "@/services/image-storage";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import { exportDesktopMedia, isDesktopApp } from "@/services/desktop-storage";
import { cn } from "@/lib/utils";
import { useAssetStore, type Asset, type AssetKind, type ImageAsset } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
    { label: "文件", value: "file" },
];

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const assetPackageInputRef = useRef<HTMLInputElement>(null);
    const hydrated = useAssetStore((state) => state.hydrated);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "file"), [assets]);
    const hasActiveFilters = Boolean(keyword.trim()) || kindFilter !== "all";

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, keyword, kindFilter]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], source: "手动添加", note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error(t("请选择图片文件"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(t(editingAsset ? "资产已更新" : "资产已保存"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("文本已复制"));
    };

    const downloadAsset = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "file") return;
        const mimeExtension = asset.data.mimeType.split("/")[1]?.split("+")[0] || (asset.kind === "image" ? "png" : asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "bin");
        const extension = mimeExtension === "mpeg" ? "mp3" : mimeExtension === "jpeg" ? "jpg" : mimeExtension;
        const filename = asset.kind === "file" ? asset.data.fileName : `${asset.title || "asset"}.${extension}`;
        try {
            if (isDesktopApp() && asset.data.storageKey) {
                const exportedName = await exportDesktopMedia(asset.kind === "image" ? "images" : asset.kind === "file" ? "files" : "media", asset.data.storageKey, filename);
                message.success(t("已下载：{name}", { name: exportedName || filename }));
                return;
            }
            const blob = asset.data.storageKey ? (asset.kind === "image" ? await getImageBlob(asset.data.storageKey) : asset.kind === "file" ? await getAssetFileBlob(asset.data.storageKey) : await getMediaBlob(asset.data.storageKey)) : null;
            if (blob) {
                saveAs(blob, filename);
                return;
            }
            if (asset.kind === "file") throw new Error("本地文件不存在");
            const source = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
            const fetched = await (await fetch(source)).blob();
            saveAs(fetched, filename);
        } catch (error) {
            message.error(error instanceof Error ? t("下载失败：{message}", { message: error.message }) : t("下载失败，请重试"));
        }
    };

    const importFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        let imported = 0;
        let failed = 0;
        const hide = message.loading(t("正在导入文件…"), 0);
        try {
            for (const file of files) {
                let staged: Awaited<ReturnType<typeof stageAssetImport>> | undefined;
                try {
                    staged = await stageAssetImport(file);
                    await addAssetPersisted(staged.asset);
                    staged.publish();
                    imported += 1;
                } catch (error) {
                    failed += 1;
                    if (staged) await staged.discard().catch(() => undefined);
                    console.error("文件导入失败", error);
                }
            }
            if (imported) message.success(`${t("已导入 {count} 个文件", { count: imported })}${failed ? `, ${t("{count} 个失败", { count: failed })}` : ""}`);
            else message.error(t("文件导入失败，请重试"));
        } finally {
            hide();
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("暂无资产可导出"));
            return;
        }
        await exportAssets(validAssets);
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            for (const asset of importedAssets) {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                await addAssetPersisted(payload as Parameters<typeof addAssetPersisted>[0]);
            }
            message.success(t("已导入 {count} 个资产", { count: importedAssets.length }));
        } catch {
            message.error(t("导入失败，请选择有效的资产压缩包"));
        } finally {
            if (assetPackageInputRef.current) assetPackageInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success(t("资产已删除"));
        setDeletingAsset(null);
    };

    const clearAssetFilters = () => {
        setKeyword("");
        setKindFilter("all");
        setPage(1);
    };

    return (
        <div className="wg-library-page wg-paper-surface flex h-full flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <header className="wg-library-header">
                <div className="wg-library-header-inner">
                    <div className="min-w-0">
                        <h1 className="wg-sketch-title shrink-0 text-[21px] font-semibold">{t("我的资产")}</h1>
                        <p className="wg-library-meta mt-0.5">ASSETS / {hydrated ? String(validAssets.length).padStart(2, "0") : "--"}</p>
                    </div>
                    <div className="wg-library-actions flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:ml-auto">
                        <label className="wg-library-search min-w-[220px] flex-1 md:max-w-sm">
                            <Search className="size-4 shrink-0" />
                            <input
                                value={keyword}
                                placeholder={t("搜索资产")}
                                aria-label={t("搜索资产")}
                                onChange={(event) => {
                                    setPage(1);
                                    setKeyword(event.target.value);
                                }}
                            />
                        </label>
                        <Button type="primary" size="small" icon={<Plus className="size-3.5" />} disabled={!hydrated} onClick={openCreate}>
                            {t("新增资产")}
                        </Button>
                        <Dropdown
                            menu={{
                                items: [
                                    { key: "files", label: t("导入文件") },
                                    { key: "package", label: t("导入资产包") },
                                ],
                                onClick: ({ key }) => (key === "files" ? fileInputRef.current?.click() : assetPackageInputRef.current?.click()),
                            }}
                        >
                            <Button size="small" icon={<Upload className="size-3.5" />} disabled={!hydrated}>{t("导入")}</Button>
                        </Dropdown>
                        <Button size="small" icon={<Download className="size-3.5" />} disabled={!hydrated} onClick={() => void exportAllAssets()}>
                            {t("导出")}
                        </Button>
                    </div>
                </div>
            </header>

            <main className="wg-library-content min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-7xl">
                    <div className="wg-library-filter flex items-center gap-3 border-b border-dashed pb-3">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            <span className="mr-1 shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">{t("类型")}</span>
                            {kindOptions.map((option) => (
                                <Tag.CheckableTag
                                    key={option.value}
                                    checked={kindFilter === option.value}
                                    className={cn("prompt-filter-tag", kindFilter === option.value && "is-active")}
                                    onChange={() => {
                                        setPage(1);
                                        setKindFilter(option.value as AssetKind | "all");
                                    }}
                                >
                                    {t(option.label)}
                                </Tag.CheckableTag>
                            ))}
                            {hasActiveFilters ? (
                                <Button type="link" size="small" className="!h-auto !px-1 text-xs" onClick={clearAssetFilters}>
                                    {t("清除筛选")}
                                </Button>
                            ) : null}
                        </div>
                    </div>

                    {!hydrated ? (
                        <div className="flex h-64 items-center justify-center" role="status" aria-label={t("正在加载资产")}>
                            <Spin />
                        </div>
                    ) : null}

                    {hydrated && validAssets.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                                <div>
                                    <div className="text-sm text-stone-700 dark:text-stone-300">{t("还没有资产")}</div>
                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("可以新增文本，也可以导入图片、影音或其他文件。")}</div>
                                </div>
                            }
                            className="py-20"
                        >
                            <Button type="primary" size="small" icon={<Plus className="size-3.5" />} onClick={openCreate}>
                                {t("新增第一个资产")}
                            </Button>
                        </Empty>
                    ) : null}

                    {hydrated && validAssets.length > 0 && filteredAssets.length === 0 ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={
                                <div>
                                    <div className="text-sm text-stone-700 dark:text-stone-300">{t("没有符合当前条件的资产")}</div>
                                    <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("试试其他关键词或类型。")}</div>
                                </div>
                            }
                            className="py-20"
                        >
                            <Button size="small" onClick={clearAssetFilters}>
                                {t("清除搜索和筛选")}
                            </Button>
                        </Empty>
                    ) : null}

                    {hydrated && filteredAssets.length > 0 ? (
                        <div className="mt-4 flex flex-col gap-5">
                            <div className="wg-library-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {visibleAssets.map((asset) => (
                                    <AssetCard key={asset.id} asset={asset} onOpen={() => setPreviewAsset(asset)} onEdit={() => openEdit(asset)} onCopy={copyAssetText} onDownload={downloadAsset} onDelete={() => setDeletingAsset(asset)} />
                                ))}
                            </div>

                            <div className="flex justify-center border-t border-stone-200 pt-4 dark:border-stone-800">
                                <Pagination
                                    current={page}
                                    pageSize={pageSize}
                                    total={filteredAssets.length}
                                    showSizeChanger
                                    pageSizeOptions={[10, 20, 50, 100]}
                                    responsive
                                    onChange={(nextPage, nextPageSize) => {
                                        setPage(nextPage);
                                        setPageSize(nextPageSize);
                                    }}
                                />
                            </div>
                        </div>
                    ) : null}
                </div>
            </main>

            <Modal title={t(editingAsset ? "编辑资产" : "新增资产")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("保存")} cancelText={t("取消")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Form.Item name="kind" label={t("类型")}>
                            <Select
                                options={[
                                    { label: t("文本"), value: "text" },
                                    { label: t("图片"), value: "image" },
                                ]}
                                onChange={(value) => setFormKind(value)}
                            />
                        </Form.Item>
                        <Form.Item name="title" label={t("标题")} rules={[{ required: true, message: t("请输入标题") }]}>
                            <Input size="large" placeholder={t("给资产起一个容易检索的名字")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("封面 URL")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("可粘贴图片 URL，也可以上传本地封面")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("上传")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("标签")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("输入标签后回车")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("来源")}>
                                <Input placeholder={t("手动添加 / 画布 / 提示词库")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("备注")}>
                                <Input placeholder={t("可选")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("文本内容")} rules={[{ required: true, message: t("请输入文本内容") }]}>
                                <Input.TextArea rows={8} placeholder={t("保存提示词、说明文案、参考描述等文本资产")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("图片内容")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("选择图片文件")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("未选择图片")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("预览")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("暂无封面")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("未命名资产")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("未打标签")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadAsset} />

            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => void importFiles(event.target.files)} />
            <input ref={assetPackageInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("删除资产")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("删除")} okButtonProps={{ danger: true }} cancelText={t("取消")}>
                {t("确定删除「{title}」吗？删除后会从我的资产中移除。", { title: deletingAsset?.title || "" })}
            </Modal>
        </div>
    );
}

function AssetCard({ asset, onOpen, onEdit, onCopy, onDownload, onDelete }: { asset: Asset; onOpen: () => void; onEdit: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void; onDelete: () => void }) {
    const { t } = useAppTranslation();
    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
    const summary = assetSummary(asset);
    return (
        <Card
            hoverable
            className="flex h-full flex-col overflow-hidden"
            styles={{ body: { padding: 0, display: "flex", flex: 1, flexDirection: "column" } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen}>
                    {cover ? (
                        <img src={cover} alt={asset.title} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-stone-100 p-4 text-center text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                            {asset.kind === "text" ? (
                                asset.data.content
                            ) : asset.kind === "file" ? (
                                <div className="flex flex-col items-center gap-2">
                                    <FileIcon className="size-8 opacity-45" />
                                    <span className="line-clamp-2 break-all">{asset.data.fileName}</span>
                                </div>
                            ) : (
                                t("暂无封面")
                            )}
                        </div>
                    )}
                </button>
            }
        >
            <button type="button" className="block w-full flex-1 text-left" onClick={onOpen}>
                <div className="p-3.5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                            <Typography.Text type="secondary" className="mt-1 block text-xs">
                                {asset.source || t("未标注来源")}
                            </Typography.Text>
                        </div>
                        <Tag className="m-0 shrink-0 text-[11px]">{t(assetKindLabel(asset.kind))}</Tag>
                    </div>
                    <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} className="!mb-0 !mt-2 !text-xs !leading-5">
                        {summary}
                    </Typography.Paragraph>
                    {isAuthorLibraryAsset(asset) ? <AuthorNote note={authorLibraryNote(asset)} className="mt-2.5" /> : null}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {(asset.tags || []).slice(0, 3).map((tag) => (
                            <Tag key={tag} className="m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {!asset.tags?.length ? <Tag className="m-0 text-[11px]">{t("无标签")}</Tag> : null}
                    </div>
                </div>
            </button>
            <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-3.5">
                <Button size="small" onClick={onOpen}>
                    {t("查看")}
                </Button>
                {asset.kind === "text" || asset.kind === "image" ? (
                    <Button size="small" icon={<PencilLine className="size-3.5" />} onClick={onEdit}>
                        {t("编辑")}
                    </Button>
                ) : null}
                {asset.kind === "text" ? (
                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void onCopy(asset)}>
                        {t("复制")}
                    </Button>
                ) : null}
                {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "file" ? (
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(asset)}>
                        {t("下载")}
                    </Button>
                ) : null}
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("删除")}
                </Button>
            </div>
        </Card>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useAppTranslation();
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("资产详情")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={cover} alt={asset.title} className="rounded-lg" />
                    ) : (
                        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
                            {asset.kind === "text" ? asset.data.content : asset.kind === "file" ? <div className="flex items-center gap-3"><FileIcon className="size-7 opacity-45" /><span className="break-all">{asset.data.fileName}</span></div> : t("暂无封面")}
                        </div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(assetKindLabel(asset.kind))}</Tag>
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("内容")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : asset.kind === "audio" ? (
                            <audio src={asset.data.url} controls className="mt-3 w-full" />
                        ) : asset.kind === "file" ? (
                            <div className="mt-2 space-y-1 text-sm">
                                <div className="break-all font-medium">{asset.data.fileName}</div>
                                <div className="text-stone-500 dark:text-stone-400">{assetFileCategoryLabel(asset.data.category)} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}</div>
                            </div>
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {isAuthorLibraryAsset(asset) ? <AuthorNote note={authorLibraryNote(asset)} expanded /> : null}
                    {asset.note && !isAuthorLibraryAsset(asset) ? (
                        <div>
                            <Typography.Text type="secondary">{t("备注")}</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("复制文本")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "file" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {t(asset.kind === "video" ? "下载视频" : asset.kind === "audio" ? "下载音频" : asset.kind === "file" ? "下载文件" : "下载图片")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

function assetSummary(asset: Asset) {
    if (asset.kind === "text") return asset.data.content;
    if (asset.kind === "audio") return `${formatDuration(asset.data.durationMs || 0)} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    if (asset.kind === "file") return `${assetFileCategoryLabel(asset.data.category)} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    return `${asset.data.width}x${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", authorLibraryNote(asset) || "", (asset.tags || []).join(" "), asset.kind === "text" ? asset.data.content : asset.kind === "file" ? `${asset.data.fileName} ${asset.data.extension} ${asset.data.category} ${asset.data.mimeType}` : asset.data.mimeType].join(" ").toLowerCase();
}

function isAuthorLibraryAsset(asset: Asset) {
    return typeof asset.metadata?.authorLibraryId === "string";
}

function authorLibraryNote(asset: Asset) {
    if (!isAuthorLibraryAsset(asset)) return undefined;
    if (Object.prototype.hasOwnProperty.call(asset.metadata, "authorNote")) {
        return typeof asset.metadata?.authorNote === "string" ? asset.metadata.authorNote : undefined;
    }
    return asset.note;
}

function assetKindLabel(kind: AssetKind) {
    if (kind === "image") return "图片";
    if (kind === "video") return "视频";
    if (kind === "audio") return "音频";
    if (kind === "file") return "文件";
    return "文本";
}
