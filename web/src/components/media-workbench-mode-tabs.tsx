import type { ComponentType } from "react";

type MediaWorkbenchModeTab<Value extends string> = {
    value: Value;
    label: string;
    icon: ComponentType<{ className?: string }>;
};

type MediaWorkbenchModeTabsProps<Value extends string> = {
    ariaLabel: string;
    items: readonly MediaWorkbenchModeTab<Value>[];
    value: Value;
    onChange: (value: Value) => void;
};

export function MediaWorkbenchModeTabs<Value extends string>({ ariaLabel, items, value, onChange }: MediaWorkbenchModeTabsProps<Value>) {
    return (
        <div className="flex shrink-0 items-center border-b border-[color:var(--wg-studio-line)] px-4" role="tablist" aria-label={ariaLabel}>
            {items.map((item) => {
                const active = value === item.value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`relative flex h-14 flex-1 items-center justify-center gap-2 text-[13px] font-semibold outline-none transition focus-visible:bg-[color:var(--wg-studio-accent-soft)]/40 ${active ? "text-[color:var(--wg-studio-accent-strong)]" : "text-[color:var(--wg-studio-muted)] hover:text-[color:var(--wg-studio-text)]"}`}
                        onClick={() => onChange(item.value)}
                    >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                        {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-[color:var(--wg-studio-accent-strong)]" /> : null}
                    </button>
                );
            })}
        </div>
    );
}
