import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { useAppTranslation } from "@/hooks/use-app-translation";

export default function ConfigPage() {
    const { t } = useAppTranslation();
    return (
        <main className="h-full overflow-y-auto bg-transparent">
            <div className="mx-auto max-w-6xl px-6 py-6">
                <div className="mb-5">
                    <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">{t("配置与用户偏好")}</h1>
                    <p className="mt-1 text-sm text-stone-500">{t("渠道聚合、默认模型和同步偏好")}</p>
                </div>
                <AppConfigPanel />
            </div>
        </main>
    );
}
