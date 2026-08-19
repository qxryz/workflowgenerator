import { useCallback } from "react";

import { translate, type TranslationValues } from "@/lib/i18n";
import { useConfigStore } from "@/stores/use-config-store";

export function useAppTranslation() {
    const language = useConfigStore((state) => state.config.language);
    const t = useCallback((message: string, values?: TranslationValues) => translate(language, message, values), [language]);
    return { language, t };
}
