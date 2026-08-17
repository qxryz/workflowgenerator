import { memo, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Button, Input } from "antd";
import { CheckCircle2, Layers3 } from "lucide-react";

import type { ZodiacAssetDecisionOption, ZodiacDecisionOption, ZodiacDecisionUi } from "@/lib/agent/zodiac-decision-ui";
import type { CanvasTheme } from "@/lib/canvas-theme";

export type ZodiacDecisionCardProps = {
    decision: ZodiacDecisionUi;
    theme: CanvasTheme;
    answeredLabel?: string;
    disabled?: boolean;
    onSubmit: (answerText: string, answerLabel: string) => void | Promise<void>;
};

type SubmitAnswer = (answerText: string, answerLabel: string) => Promise<void>;

const CUSTOM_CHOICE_ID = "__custom__";

export const ZodiacDecisionCard = memo(function ZodiacDecisionCard(props: ZodiacDecisionCardProps) {
    const answeredLabel = props.answeredLabel?.trim();
    if (answeredLabel) {
        return (
            <div
                className="flex min-h-10 min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: props.theme.node.stroke, background: props.theme.node.panel, color: props.theme.node.text }}
                role="status"
                aria-label={`已选择：${answeredLabel}`}
            >
                <CheckCircle2 className="size-4 shrink-0" strokeWidth={1.8} style={{ color: props.theme.node.activeStroke }} aria-hidden />
                <span className="truncate">{answeredLabel}</span>
            </div>
        );
    }

    return <OpenDecisionCard key={props.decision.id} {...props} />;
});

function OpenDecisionCard({ decision, theme, disabled = false, onSubmit }: ZodiacDecisionCardProps) {
    const questionId = useId();
    const submittingRef = useRef(false);
    const [submitting, setSubmitting] = useState(false);
    const [submittingLabel, setSubmittingLabel] = useState("");
    const [error, setError] = useState("");
    const locked = disabled || submitting;

    const submit: SubmitAnswer = async (answerText, answerLabel) => {
        const safeAnswer = answerText.trim();
        const safeLabel = answerLabel.trim();
        if (disabled || submittingRef.current || !safeAnswer || !safeLabel) return;
        submittingRef.current = true;
        setError("");
        setSubmittingLabel(safeLabel);
        setSubmitting(true);
        try {
            await onSubmit(safeAnswer, safeLabel);
        } catch {
            setError("没有提交成功，请再试一次。");
        } finally {
            submittingRef.current = false;
            setSubmittingLabel("");
            setSubmitting(false);
        }
    };

    return (
        <section className="min-w-0 rounded-xl border p-3.5" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }} aria-labelledby={questionId} aria-busy={submitting}>
            <p id={questionId} className="text-sm font-semibold leading-5">
                {decision.question}
            </p>
            <div className="mt-3">
                <DecisionBody decision={decision} theme={theme} disabled={locked} submitting={submitting} submittingLabel={submittingLabel} submit={submit} />
            </div>
            {error ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
                    {error}
                </p>
            ) : null}
        </section>
    );
}

function DecisionBody({ decision, theme, disabled, submitting, submittingLabel, submit }: { decision: ZodiacDecisionUi; theme: CanvasTheme; disabled: boolean; submitting: boolean; submittingLabel: string; submit: SubmitAnswer }) {
    if (decision.type === "single_choice") {
        return <ChoiceDecision decision={decision} theme={theme} disabled={disabled} submitting={submitting} submit={submit} />;
    }
    if (decision.type === "multi_choice") {
        return <MultiChoiceDecision decision={decision} theme={theme} disabled={disabled} submitting={submitting} submit={submit} />;
    }
    if (decision.type === "short_text") {
        return <ShortTextDecision decision={decision} theme={theme} disabled={disabled} submitting={submitting} submit={submit} />;
    }
    if (decision.type === "asset_picker") {
        return <AssetPickerDecision decision={decision} theme={theme} disabled={disabled} submitting={submitting} submit={submit} />;
    }
    return <ConfirmSummaryDecision decision={decision} theme={theme} disabled={disabled} submitting={submitting} submittingLabel={submittingLabel} submit={submit} />;
}

function ChoiceDecision({ decision, theme, disabled, submitting, submit }: { decision: Extract<ZodiacDecisionUi, { type: "single_choice" }>; theme: CanvasTheme; disabled: boolean; submitting: boolean; submit: SubmitAnswer }) {
    const groupName = useId();
    const [selectedId, setSelectedId] = useState("");
    const [customValue, setCustomValue] = useState("");
    const selected = decision.options.find((option) => option.id === selectedId);
    const customSelected = selectedId === CUSTOM_CHOICE_ID;
    const answerLabel = customSelected ? customValue.trim() : selected?.label || "";

    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (!answerLabel) return;
        void submit(`我选择「${answerLabel}」。`, answerLabel);
    };

    return (
        <form onSubmit={handleSubmit}>
            <fieldset className="grid gap-2" disabled={disabled}>
                <legend className="sr-only">{decision.question}</legend>
                {decision.options.map((option) => (
                    <DecisionOptionRow key={option.id} inputType="radio" name={groupName} option={option} checked={selectedId === option.id} disabled={disabled} theme={theme} onChange={() => setSelectedId(option.id)} />
                ))}
                {decision.allowCustom ? (
                    <CustomChoiceRow
                        inputType="radio"
                        name={groupName}
                        checked={customSelected}
                        value={customValue}
                        disabled={disabled}
                        theme={theme}
                        onChecked={() => setSelectedId(CUSTOM_CHOICE_ID)}
                        onValueChange={(value) => {
                            setCustomValue(value);
                            setSelectedId(CUSTOM_CHOICE_ID);
                        }}
                    />
                ) : null}
            </fieldset>
            <SubmitButton disabled={disabled || !answerLabel} submitting={submitting} />
        </form>
    );
}

function MultiChoiceDecision({ decision, theme, disabled, submitting, submit }: { decision: Extract<ZodiacDecisionUi, { type: "multi_choice" }>; theme: CanvasTheme; disabled: boolean; submitting: boolean; submit: SubmitAnswer }) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [customSelected, setCustomSelected] = useState(false);
    const [customValue, setCustomValue] = useState("");
    const labels = decision.options.filter((option) => selectedIds.has(option.id)).map((option) => option.label);
    if (customSelected && customValue.trim()) labels.push(customValue.trim());

    const toggle = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (!labels.length) return;
        const answerLabel = labels.join("、");
        void submit(`我选择：${answerLabel}。`, answerLabel);
    };

    return (
        <form onSubmit={handleSubmit}>
            <fieldset className="grid gap-2" disabled={disabled}>
                <legend className="sr-only">{decision.question}</legend>
                {decision.options.map((option) => (
                    <DecisionOptionRow key={option.id} inputType="checkbox" option={option} checked={selectedIds.has(option.id)} disabled={disabled} theme={theme} onChange={() => toggle(option.id)} />
                ))}
                {decision.allowCustom ? (
                    <CustomChoiceRow
                        inputType="checkbox"
                        checked={customSelected}
                        value={customValue}
                        disabled={disabled}
                        theme={theme}
                        onChecked={() => setCustomSelected((current) => !current)}
                        onValueChange={(value) => {
                            setCustomValue(value);
                            setCustomSelected(true);
                        }}
                    />
                ) : null}
            </fieldset>
            <SubmitButton disabled={disabled || !labels.length} submitting={submitting} />
        </form>
    );
}

function ShortTextDecision({ decision, theme, disabled, submitting, submit }: { decision: Extract<ZodiacDecisionUi, { type: "short_text" }>; theme: CanvasTheme; disabled: boolean; submitting: boolean; submit: SubmitAnswer }) {
    const inputId = useId();
    const [value, setValue] = useState("");
    const answer = value.trim();
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (answer) void submit(answer, answer);
    };
    return (
        <form className="grid gap-2" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor={inputId}>
                {decision.question}
            </label>
            <Input
                id={inputId}
                value={value}
                maxLength={240}
                placeholder={decision.placeholder || "输入你的想法"}
                disabled={disabled}
                autoComplete="off"
                style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                onChange={(event) => setValue(event.target.value)}
            />
            <Button className="!h-9 !font-medium" type="primary" htmlType="submit" loading={submitting} disabled={disabled || !answer}>
                {decision.submitLabel || "继续"}
            </Button>
        </form>
    );
}

function AssetPickerDecision({ decision, theme, disabled, submitting, submit }: { decision: Extract<ZodiacDecisionUi, { type: "asset_picker" }>; theme: CanvasTheme; disabled: boolean; submitting: boolean; submit: SubmitAnswer }) {
    const groupName = useId();
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const toggle = (nodeId: string) => {
        setSelectedIds((current) => {
            if (!decision.multiple) return new Set([nodeId]);
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    };
    const selected = decision.options.filter((option) => selectedIds.has(option.nodeId));
    const handleSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (!selected.length) return;
        const answerLabel = selected.map((option) => option.label).join("、");
        const references = selected.map((option) => `@[node:${option.nodeId}]`).join(" ");
        void submit(`使用画布资产：${references}`, answerLabel);
    };

    return (
        <form onSubmit={handleSubmit}>
            <fieldset className="grid gap-2" disabled={disabled}>
                <legend className="sr-only">{decision.question}</legend>
                {decision.options.map((option) => (
                    <DecisionOptionRow
                        key={option.nodeId}
                        inputType={decision.multiple ? "checkbox" : "radio"}
                        name={decision.multiple ? undefined : groupName}
                        option={option}
                        checked={selectedIds.has(option.nodeId)}
                        disabled={disabled}
                        theme={theme}
                        icon={<Layers3 className="size-4" strokeWidth={1.8} aria-hidden />}
                        onChange={() => toggle(option.nodeId)}
                    />
                ))}
            </fieldset>
            <SubmitButton disabled={disabled || !selected.length} submitting={submitting} />
        </form>
    );
}

function ConfirmSummaryDecision({
    decision,
    theme,
    disabled,
    submitting,
    submittingLabel,
    submit,
}: {
    decision: Extract<ZodiacDecisionUi, { type: "confirm_summary" }>;
    theme: CanvasTheme;
    disabled: boolean;
    submitting: boolean;
    submittingLabel: string;
    submit: SubmitAnswer;
}) {
    const confirmLabel = decision.confirmLabel || "继续";
    const cancelLabel = decision.cancelLabel || "调整";
    return (
        <div>
            <ul className="grid gap-1.5 text-sm leading-5" aria-label="即将继续的内容">
                {decision.summary.map((item, index) => (
                    <li key={`${index}:${item}`} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} style={{ color: theme.node.activeStroke }} aria-hidden />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2">
                <Button className="!h-9 !font-medium" loading={submitting && submittingLabel === cancelLabel} disabled={disabled} onClick={() => void submit("需要调整。", cancelLabel)}>
                    {cancelLabel}
                </Button>
                <Button className="!h-9 !font-medium" type="primary" loading={submitting && submittingLabel === confirmLabel} disabled={disabled} onClick={() => void submit("确认，继续。", confirmLabel)}>
                    {confirmLabel}
                </Button>
            </div>
        </div>
    );
}

function DecisionOptionRow({
    inputType,
    name,
    option,
    checked,
    disabled,
    theme,
    icon,
    onChange,
}: {
    inputType: "radio" | "checkbox";
    name?: string;
    option: ZodiacDecisionOption | ZodiacAssetDecisionOption;
    checked: boolean;
    disabled: boolean;
    theme: CanvasTheme;
    icon?: ReactNode;
    onChange: () => void;
}) {
    return (
        <label
            className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none"
            style={optionRowStyle(theme, checked, disabled)}
        >
            <input className="mt-0.5 size-4 shrink-0" type={inputType} name={name} checked={checked} disabled={disabled} style={{ accentColor: theme.node.activeStroke }} onChange={onChange} />
            {icon ? (
                <span className="mt-0.5 shrink-0" style={{ color: theme.node.muted }}>
                    {icon}
                </span>
            ) : null}
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-5">{option.label}</span>
                {option.description ? (
                    <span className="mt-0.5 block text-xs leading-4" style={{ color: theme.node.muted }}>
                        {option.description}
                    </span>
                ) : null}
            </span>
        </label>
    );
}

function CustomChoiceRow({
    inputType,
    name,
    checked,
    value,
    disabled,
    theme,
    onChecked,
    onValueChange,
}: {
    inputType: "radio" | "checkbox";
    name?: string;
    checked: boolean;
    value: string;
    disabled: boolean;
    theme: CanvasTheme;
    onChecked: () => void;
    onValueChange: (value: string) => void;
}) {
    const inputId = useId();
    return (
        <div className="grid gap-2 rounded-lg border px-3 py-2.5" style={optionRowStyle(theme, checked, disabled)}>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium" htmlFor={inputId}>
                <input id={inputId} className="size-4 shrink-0" type={inputType} name={name} checked={checked} disabled={disabled} style={{ accentColor: theme.node.activeStroke }} onChange={onChecked} />
                其他
            </label>
            <Input
                value={value}
                maxLength={120}
                placeholder="补充你的选择"
                disabled={disabled}
                aria-label="其他选择"
                style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                onFocus={() => {
                    if (!checked) onChecked();
                }}
                onChange={(event) => onValueChange(event.target.value)}
            />
        </div>
    );
}

function SubmitButton({ disabled, submitting }: { disabled: boolean; submitting: boolean }) {
    return (
        <Button className="mt-3 !h-9 w-full !font-medium" type="primary" htmlType="submit" loading={submitting} disabled={disabled}>
            继续
        </Button>
    );
}

function optionRowStyle(theme: CanvasTheme, checked: boolean, disabled: boolean): CSSProperties {
    return {
        borderColor: checked ? theme.node.activeStroke : theme.node.stroke,
        background: checked ? `color-mix(in srgb, ${theme.node.activeStroke} 9%, ${theme.node.panel})` : theme.node.panel,
        color: theme.node.text,
        opacity: disabled ? 0.58 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
    };
}
