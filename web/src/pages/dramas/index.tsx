import { Film, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { CreateDramaModal } from "@/components/drama/create-drama-modal";
import { ProjectCard } from "@/components/drama/project-card";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useDramaList } from "@/hooks/use-drama";

export default function DramasPage() {
    const { t } = useAppTranslation();
    const navigate = useNavigate();
    const { data, isPending, isError, refetch } = useDramaList();
    const [creating, setCreating] = useState(false);
    const items = [...(data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

    return (
        <main className="h-full overflow-auto bg-[color:var(--wg-home-bg)] px-6 pb-10 pt-10 text-[color:var(--wg-home-text)]">
            <div className="mx-auto max-w-5xl">
                <div className="mb-10 flex items-center justify-between gap-6">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">{t("剧目")}</h1>
                        <p className="mt-1 text-sm text-[color:var(--wg-home-muted)]">{t("从一个故事到一部短剧")}</p>
                    </div>
                    <button type="button" className="wg-primary-button" onClick={() => setCreating(true)}>
                        <Plus className="size-4" />
                        {t("新建剧目")}
                    </button>
                </div>
                {isPending ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                        {[0, 1, 2].map((key) => (
                            <div key={key} className="aspect-[16/10] animate-pulse rounded-xl bg-[color:var(--wg-home-ghost)]" />
                        ))}
                    </div>
                ) : isError ? (
                    <div className="rounded-xl border border-dashed border-[color:var(--wg-home-line)] py-14 text-center text-sm text-[color:var(--wg-home-muted)]">
                        <p>{t("剧目列表没能加载")}</p>
                        <button type="button" className="wg-text-button mx-auto mt-4 !border !border-[color:var(--wg-home-line)]" onClick={() => void refetch()}>{t("重试")}</button>
                    </div>
                ) : items.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {items.map((item) => (
                            <ProjectCard key={item.id} item={item} />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-[color:var(--wg-home-line)] py-16 text-center">
                        <Film className="mb-4 size-8 text-[color:var(--wg-home-muted-strong)]" strokeWidth={1.4} />
                        <p className="text-sm text-[color:var(--wg-home-muted)]">{t("还没有剧目。新建一部，从故事开始。")}</p>
                        <button type="button" className="wg-primary-button mt-6" onClick={() => setCreating(true)}>
                            <Plus className="size-4" />
                            {t("新建剧目")}
                        </button>
                    </div>
                )}
            </div>
            <CreateDramaModal open={creating} onClose={() => setCreating(false)} onCreated={(project) => navigate(`/dramas/${project.id}`)} />
        </main>
    );
}
