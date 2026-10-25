import { Check } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";
import type { StylePreset } from "@/lib/drama/style/style-presets";
import { getStylePresetPreview } from "@/lib/drama/style/style-preset-previews";

type Props = { preset: StylePreset; selected: boolean; onSelect: () => void };

export function StylePresetCard({ preset, selected, onSelect }: Props) {
    const { language } = useAppTranslation();
    const preview = getStylePresetPreview(preset.id);
    const name = language === "en-US" ? preset.nameEn : preset.name;
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={cn(
                "group relative flex flex-col overflow-hidden rounded-lg border bg-[color:var(--wg-panel)] text-left transition-colors",
                selected ? "border-[color:var(--wg-home-accent)] ring-1 ring-[color:var(--wg-home-accent)]" : "border-[color:var(--wg-home-line)] hover:border-[color:var(--wg-home-line-strong)]",
            )}
        >
            <div className="aspect-[4/3] w-full overflow-hidden bg-[color:var(--wg-soft)]">
                {preview && <img src={preview.src} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" style={{ objectPosition: preview.position }} />}
            </div>
            <span className="truncate px-2.5 py-2 text-xs text-[color:var(--wg-home-text)]">{name}</span>
            {selected && (
                <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-[color:var(--wg-home-accent)] text-[color:var(--wg-home-accent-text)]">
                    <Check className="size-3" />
                </span>
            )}
        </button>
    );
}
