/**
 * AutoTextarea — a borderless-friendly textarea that grows with its content, so the surrounding column is the only scroller.
 *
 * Props: all native textarea props; `minRows` (default 2) sets the empty height.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & { minRows?: number };

export function AutoTextarea({ minRows = 2, value, ...props }: Props) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const fit = useCallback(() => {
        const element = ref.current;
        if (!element) return;
        element.style.height = "auto";
        element.style.height = `${element.scrollHeight}px`;
    }, []);
    useLayoutEffect(fit, [fit, value]);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        let width = element.clientWidth;
        const observer = new ResizeObserver(() => {
            if (element.clientWidth !== width) {
                width = element.clientWidth;
                fit();
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [fit]);
    return <textarea ref={ref} rows={minRows} value={value} {...props} style={{ resize: "none", overflow: "hidden", ...props.style }} />;
}
