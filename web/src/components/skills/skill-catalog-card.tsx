import { Button, Card, Switch, Tag } from "antd";
import { ArrowDown, ArrowUp, Download, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { AuthorNote } from "@/components/author-library/author-note";
import { useAppTranslation } from "@/hooks/use-app-translation";
import type { InstalledSkill } from "@/services/skills/skill-presets";
import type { SkillRegistryEntry } from "@/services/skills/skill-registry";

import { fileBadgeCount, skillAuthor, skillCategoryLabel, skillId, skillName, skillShowcase, skillSource, skillSourceLabel, skillSummary, skillVersion, type CatalogItem, type SkillSourceKind } from "./skill-catalog";

const SOURCE_COLORS: Record<SkillSourceKind, string> = {
    "official-featured": "blue",
    official: "cyan",
    community: "green",
    unknown: "default",
    author: "purple",
    personal: "default",
};

export function sourceTagColor(item: CatalogItem) {
    return SOURCE_COLORS[skillSource(item)];
}

export function SourceTag({ item }: { item: CatalogItem }) {
    const { t } = useAppTranslation();
    return (
        <Tag color={sourceTagColor(item)} className="!m-0 text-[11px]">
            {t(skillSourceLabel(item))}
        </Tag>
    );
}

/** L1 卡片：名称 / 署名 / 来源 / 一句话简介 / 多文件标记 + 一个主操作。 */
export function SkillCatalogCard({
    item,
    installingId,
    updateAvailable,
    onOpen,
    onInstall,
    onEnabledChange,
}: {
    item: CatalogItem;
    installingId: string;
    updateAvailable: boolean;
    onOpen: () => void;
    onInstall: (entry: SkillRegistryEntry) => Promise<void>;
    onEnabledChange: (id: string, enabled: boolean) => void;
}) {
    const { t, language } = useAppTranslation();
    const entry = item.entry;
    const installed = item.installed;
    const files = fileBadgeCount(item);
    const author = skillAuthor(item);
    const preview = skillShowcase(item)[0];
    return (
        <Card
            hoverable
            className="wg-library-card [content-visibility:auto] overflow-hidden [contain-intrinsic-size:420px]"
            styles={{ body: { padding: 0 } }}
            cover={
                <button type="button" className="block w-full text-left" onClick={onOpen} aria-label={t("查看 {name}", { name: skillName(item, language) })}>
                    <SkillCardPreview url={preview} title={skillName(item, language)} />
                </button>
            }
        >
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{skillName(item, language)}</h2>
                            <span className="mt-1 block truncate font-mono text-[11px] text-stone-400 dark:text-stone-500">
                                {skillId(item)} · v{skillVersion(item)}
                            </span>
                        </div>
                        {installed ? (
                            <Tag color={updateAvailable ? "blue" : "green"} className="!m-0 shrink-0">
                                {t(updateAvailable ? "可更新" : "已安装")}
                            </Tag>
                        ) : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-600 dark:text-stone-400">{skillSummary(item, language)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <SourceTag item={item} />
                        <Tag className="!m-0 text-[11px]">{t(skillCategoryLabel(item))}</Tag>
                        {files ? (
                            <Tag className="!m-0 text-[11px]" title={t("多文件技能")}>
                                {t("含 {count} 个文件", { count: files })}
                            </Tag>
                        ) : null}
                        {installed?.zodiacOnly ? (
                            <Tag color="geekblue" className="!m-0 text-[11px]">
                                {t("Zodiac 专属")}
                            </Tag>
                        ) : null}
                    </div>
                    {author ? <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">{t("作者：{author}", { author })}</div> : null}
                    {skillSource(item) === "author" ? <AuthorNote note={entry?.authorNote || installed?.authorNote} className="mt-2" /> : null}
                </div>
            </button>
            <div className="flex items-center gap-2 px-4 pb-4">
                {entry && (!installed || updateAvailable) ? (
                    <Button block type="primary" size="small" loading={installingId === entry.id} icon={<Download className="size-3.5" />} onClick={() => void onInstall(entry)}>
                        {t(updateAvailable ? "更新" : "安装")}
                    </Button>
                ) : installed ? (
                    <div className="flex w-full items-center justify-end gap-2 text-xs text-stone-500">
                        <span>{t(installed.enabled ? "已启用" : "未启用")}</span>
                        <Switch size="small" checked={installed.enabled} onChange={(enabled) => onEnabledChange(installed.id, enabled)} />
                    </div>
                ) : null}
            </div>
        </Card>
    );
}

/** 列表只加载每个 Skill 的第一张封面；视频跳过常见的黑色首帧并静音循环播放。 */
function SkillCardPreview({ url, title }: { url?: string; title: string }) {
    const { t } = useAppTranslation();
    const [failed, setFailed] = useState(false);
    const isVideo = Boolean(url && /\.(?:mp4|webm|mov)$/iu.test(new URL(url).pathname));

    if (!url || failed) {
        return (
            <span className="grid aspect-[4/3] w-full place-items-center bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-600">
                <Sparkles className="size-8" />
            </span>
        );
    }

    if (!isVideo) return <img src={url} alt={`${title} · ${t("封面")}`} className="aspect-[4/3] w-full object-cover" loading="lazy" onError={() => setFailed(true)} />;

    return (
        <span className="relative block aspect-[4/3] w-full overflow-hidden bg-stone-950">
            <video
                src={url}
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
                aria-label={`${title} · ${t("演示视频")}`}
                onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0.04) video.currentTime = Math.min(1 / 30, video.duration / 2);
                }}
                onError={() => setFailed(true)}
            />
        </span>
    );
}

/** 个人技能卡片：保留启用、排序、编辑、删除。 */
export function PersonalSkillCard({
    skill,
    index,
    count,
    onEnabledChange,
    onMove,
    onEdit,
    onRemove,
}: {
    skill: InstalledSkill;
    index: number;
    count: number;
    onEnabledChange: (id: string, enabled: boolean) => void;
    onMove: (id: string, direction: -1 | 1) => void;
    onEdit: (skill: InstalledSkill) => void;
    onRemove: (id: string) => void;
}) {
    const { t } = useAppTranslation();
    return (
        <Card className="[content-visibility:auto] overflow-hidden [contain-intrinsic-size:220px]" styles={{ body: { padding: 0 } }}>
            <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(skill)}>
                        <div className="min-w-0">
                            <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{skill.name}</h2>
                            <span className="mt-1 block text-xs text-stone-400 dark:text-stone-500">{t("个人 Skill")}</span>
                        </div>
                    </button>
                    <Switch size="small" checked={skill.enabled} onChange={(enabled) => onEnabledChange(skill.id, enabled)} />
                </div>
                <button type="button" className="block w-full text-left" onClick={() => onEdit(skill)}>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-stone-600 dark:text-stone-400">{skill.description || t("还没有简介")}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Tag className="!m-0 text-[11px]">{t("我的")}</Tag>
                        {skill.tags.slice(0, 2).map((tag) => (
                            <Tag key={tag} className="!m-0 text-[11px]">
                                {tag}
                            </Tag>
                        ))}
                        {skill.zodiacOnly ? (
                            <Tag color="geekblue" className="!m-0 text-[11px]">
                                {t("Zodiac 专属")}
                            </Tag>
                        ) : null}
                    </div>
                </button>
            </div>
            <div className="flex items-center justify-between gap-2 px-4 pb-4">
                <div className="flex shrink-0 items-center gap-1">
                    <Button type="text" size="small" aria-label={t("上移")} disabled={index === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(skill.id, -1)} />
                    <Button type="text" size="small" aria-label={t("下移")} disabled={index === count - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(skill.id, 1)} />
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button type="text" size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEdit(skill)}>
                        {t("编辑")}
                    </Button>
                    <Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} onClick={() => onRemove(skill.id)}>
                        {t("删除")}
                    </Button>
                </div>
            </div>
        </Card>
    );
}
