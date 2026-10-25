import { Select } from "antd";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { DramaPageHeader } from "@/components/drama/page-header";
import { RunPanelButton } from "@/components/drama/run-panel";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useDrama } from "@/hooks/use-drama";

/** Frame only: header, episode switcher, title. Wave 2 replaces the body with the six-step workspace. */
export default function EpisodePage() {
    const { t } = useAppTranslation();
    const { id, eid } = useParams();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const { data: snapshot, isPending } = useDrama(id);
    if (isPending) return <div className="h-full bg-[color:var(--wg-home-bg)]" aria-busy="true" />;
    const episode = snapshot?.episodes.find((item) => item.id === eid);
    if (!snapshot || !episode) {
        return (
            <main className="flex h-full flex-col items-center justify-center gap-4 text-sm text-[color:var(--wg-home-muted)]">
                <p>{t("没有找到这一集")}</p>
                <Link to={`/dramas/${id}?tab=episodes`} className="wg-primary-button">
                    {t("回到分集列表")}
                </Link>
            </main>
        );
    }
    const episodes = [...snapshot.episodes].sort((a, b) => a.ord - b.ord);
    const step = params.get("step");
    return (
        <main className="flex h-full min-h-0 flex-col bg-[color:var(--wg-home-bg)] text-[color:var(--wg-home-text)]">
            <DramaPageHeader backTo={`/dramas/${id}?tab=episodes`} backLabel="返回剧目" actions={<RunPanelButton snapshot={snapshot} />}>
                <Select
                    className="w-64"
                    value={episode.id}
                    onChange={(next) => navigate(`/dramas/${id}/episodes/${next}${step ? `?step=${step}` : ""}`)}
                    options={episodes.map((item) => ({ value: item.id, label: t("第 {count} 集 · {title}", { count: item.ord, title: item.title }) }))}
                    aria-label={t("切换分集")}
                />
            </DramaPageHeader>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
                <h1 className="text-xl font-semibold tracking-tight">{t("分集")}</h1>
            </div>
        </main>
    );
}
