/**
 * DramaPageHeader — the top row of the drama and episode pages.
 *
 * Props: `DramaPageHeader({ backTo, backLabel, children, actions })`
 *   backTo: string          route of the back button
 *   backLabel: string       Chinese source text for its tooltip / aria-label
 *   children                left content next to the back button (title, switcher, tags)
 *   actions                 right-aligned buttons
 */
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { useAppTranslation } from "@/hooks/use-app-translation";

type Props = { backTo: string; backLabel: string; children?: ReactNode; actions?: ReactNode };

export function DramaPageHeader({ backTo, backLabel, children, actions }: Props) {
    const { t } = useAppTranslation();
    return (
        <header className="flex h-14 shrink-0 items-center gap-3 px-5">
            <Link to={backTo} className="wg-icon-button" title={t(backLabel)} aria-label={t(backLabel)}>
                <ArrowLeft strokeWidth={1.6} />
            </Link>
            <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </header>
    );
}
