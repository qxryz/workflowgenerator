import { Input, Select } from "antd";
import { Plus, X } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { DialogueLine, DramaEntity } from "@/lib/drama/types";
import { entityOptions } from "./shot-field";

type Props = {
    lines: DialogueLine[];
    characters: readonly DramaEntity[];
    onChange: (lines: DialogueLine[]) => void;
    /** A speaker joins the shot's cast the moment they are picked. */
    onSpeaker: (entityId: string) => void;
};

/** One row per spoken line: who (or 旁白) and what. */
export function DialogueEditor({ lines, characters, onChange, onSpeaker }: Props) {
    const { t } = useAppTranslation();
    const options = [{ value: "", label: t("旁白 / 画外音") }, ...entityOptions(characters, ["character"])];
    const set = (index: number, patch: Partial<DialogueLine>) => onChange(lines.map((line, at) => (at === index ? { ...line, ...patch } : line)));
    return (
        <div className="flex flex-col gap-2">
            {lines.map((line, index) => (
                <div key={index} className="flex items-start gap-2">
                    <Select
                        className="w-32 shrink-0"
                        size="small"
                        value={line.speaker}
                        options={options}
                        onChange={(speaker) => {
                            set(index, { speaker });
                            if (speaker) onSpeaker(speaker);
                        }}
                        aria-label={t("说话人")}
                    />
                    <Input.TextArea className="min-w-0 flex-1" size="small" autoSize={{ minRows: 1, maxRows: 4 }} maxLength={500} value={line.text} onChange={(event) => set(index, { text: event.target.value })} placeholder={t("台词")} aria-label={t("台词")} />
                    <button type="button" className="wg-icon-button !size-7 shrink-0" title={t("删除这句")} aria-label={t("删除这句")} onClick={() => onChange(lines.filter((_, at) => at !== index))}>
                        <X strokeWidth={1.6} />
                    </button>
                </div>
            ))}
            <button type="button" className="wg-text-button !h-7 self-start" disabled={lines.length >= 30} onClick={() => onChange([...lines, { speaker: "", text: "" }])}>
                <Plus className="size-3.5" strokeWidth={1.6} />
                {t("添加一句")}
            </button>
        </div>
    );
}
