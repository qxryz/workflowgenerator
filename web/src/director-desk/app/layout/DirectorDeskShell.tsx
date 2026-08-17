import { useEffect, useState, type ReactNode } from "react";
import { ObjectTreePanel } from "../../editor/panels/ObjectTreePanel";
import { RightPanel } from "../../editor/panels/RightPanel";
import { useDirectorStore } from "../../editor/store/directorStore";

type CompactPanel = "scene" | "properties" | null;

export function DirectorDeskShell({ children }: { children: ReactNode }) {
  const viewportPanelsCollapsed = useDirectorStore((state) => state.viewportPanelsCollapsed);
  const [isCompact, setIsCompact] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 920px)").matches,
  );
  const [compactPanel, setCompactPanel] = useState<CompactPanel>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 920px)");
    const syncLayout = () => {
      setIsCompact(mediaQuery.matches);
      if (!mediaQuery.matches) setCompactPanel(null);
    };

    syncLayout();
    mediaQuery.addEventListener("change", syncLayout);
    return () => mediaQuery.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (!isCompact || compactPanel === null) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCompactPanel(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [compactPanel, isCompact]);

  useEffect(() => {
    if (viewportPanelsCollapsed) setCompactPanel(null);
  }, [viewportPanelsCollapsed]);

  const scenePanelHidden = viewportPanelsCollapsed || (isCompact && compactPanel !== "scene");
  const propertiesPanelHidden = viewportPanelsCollapsed || (isCompact && compactPanel !== "properties");
  const compactPanelClass = !viewportPanelsCollapsed && compactPanel ? ` is-compact-${compactPanel}-open` : "";

  return (
    <div
      className={`director-shell director-shell-fullbleed${viewportPanelsCollapsed ? " is-sidebars-collapsed" : ""}${compactPanelClass}`}
    >
      <section className="viewport-column" aria-label="3D视口">
        {children}
      </section>
      {isCompact && !viewportPanelsCollapsed ? (
        <nav className="director-compact-panel-switch" aria-label="导演台面板">
          <button
            type="button"
            aria-controls="director-scene-panel"
            aria-expanded={compactPanel === "scene"}
            aria-pressed={compactPanel === "scene"}
            onClick={() => setCompactPanel((panel) => (panel === "scene" ? null : "scene"))}
          >
            场景
          </button>
          <button
            type="button"
            aria-controls="director-properties-panel"
            aria-expanded={compactPanel === "properties"}
            aria-pressed={compactPanel === "properties"}
            onClick={() => setCompactPanel((panel) => (panel === "properties" ? null : "properties"))}
          >
            属性
          </button>
        </nav>
      ) : null}
      {isCompact && compactPanel !== null && !viewportPanelsCollapsed ? (
        <button
          className="director-compact-panel-backdrop"
          type="button"
          tabIndex={-1}
          aria-label="收起面板"
          onClick={() => setCompactPanel(null)}
        />
      ) : null}
      <aside
        id="director-scene-panel"
        className="left-sidebar director-sidebar"
        aria-hidden={scenePanelHidden ? "true" : undefined}
        aria-label="场景"
        hidden={scenePanelHidden}
      >
        <ObjectTreePanel />
      </aside>
      <aside
        id="director-properties-panel"
        className="right-sidebar director-sidebar"
        aria-hidden={propertiesPanelHidden ? "true" : undefined}
        aria-label="属性"
        hidden={propertiesPanelHidden}
      >
        <RightPanel />
      </aside>
    </div>
  );
}
