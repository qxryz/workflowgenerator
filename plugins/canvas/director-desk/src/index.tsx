import {
  DIRECTOR_BRIDGE_CAPABILITIES,
  createDirectorBridgeMessage,
  isDirectorFrameMessage,
  type DirectorHostMessage,
} from "../../../../web/src/lib/director-bridge";
import type {
  CanvasConnection,
  CanvasNodeContext,
  CanvasNodeData,
  CanvasNodeMetadata,
  CanvasPlugin,
  PluginRuntime,
} from "@infinite-canvas/plugin-sdk";
import {
  normalizeDirectorCaptures,
  persistDirectorCaptureBatch,
} from "./capture-media";

export {
  buildDirectorCaptureOps,
  normalizeDirectorCaptures,
  persistDirectorCaptureBatch,
} from "./capture-media";
export type { DirectorStoredCapture } from "./capture-media";

export const DIRECTOR_DESK_PLUGIN_ID = "director-desk";
export const DIRECTOR_DESK_NODE_TYPE = "director-desk:project";
export const DIRECTOR_DESK_BUNDLED_URL = "builtin:director-desk";
export const DIRECTOR_DESK_VERSION = "1.0.0";

const PROJECT_STORAGE_PREFIX = "project:";
const RECENT_PROJECT_STORAGE_PREFIX = "recent:";

type DirectorDeskMetadata = CanvasNodeMetadata & {
  directorSchemaVersion?: number;
  directorLastCaptureFileName?: string;
};

export type DirectorPanoramaInput = {
  edgeId: string;
  sourceNodeId: string;
  imageUrl: string;
  fileName: string;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function directorProjectStorageKey(nodeId: string) {
  return `${PROJECT_STORAGE_PREFIX}${nodeId}`;
}

export function directorRecentProjectStorageKey(nodeId: string) {
  return `${RECENT_PROJECT_STORAGE_PREFIX}${nodeId}`;
}

export function buildDirectorDeskRoute(instanceId: string, returnTo: string) {
  const params = new URLSearchParams({ instanceId, returnTo });
  return `/director?${params.toString()}`;
}

export function findDirectorPanoramaInput(
  nodeId: string,
  nodes: CanvasNodeData[],
  connections: CanvasConnection[],
): DirectorPanoramaInput | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const connection of connections) {
    if (connection.toNodeId !== nodeId) continue;
    const source = nodeById.get(connection.fromNodeId);
    const imageUrl =
      source?.type === "image" ? stringValue(source.metadata?.content) : "";
    if (!source || !imageUrl) continue;
    const extension = source.metadata?.mimeType?.includes("jpeg")
      ? "jpg"
      : source.metadata?.mimeType?.includes("webp")
        ? "webp"
        : "png";
    return {
      edgeId: connection.id,
      sourceNodeId: source.id,
      imageUrl,
      fileName: `${source.title || "画布全景图"}.${extension}`,
    };
  }
  return null;
}

function currentCanvasLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function openDirectorDesk(ctx: CanvasNodeContext) {
  window.location.assign(
    buildDirectorDeskRoute(ctx.node.id, currentCanvasLocation()),
  );
}

function samePanorama(
  left: DirectorPanoramaInput | null,
  right: DirectorPanoramaInput | null,
) {
  return (
    left?.edgeId === right?.edgeId &&
    left?.sourceNodeId === right?.sourceNodeId &&
    left?.imageUrl === right?.imageUrl &&
    left?.fileName === right?.fileName
  );
}

export function buildDirectorDeskIframeSource(
  instanceId: string,
  theme: "light" | "dark",
) {
  void theme;
  const params = new URLSearchParams({ embedded: "1", instanceId });
  return `/director-runtime.html?${params.toString()}`;
}

function createSessionMessage(
  instanceId: string,
  theme: "light" | "dark",
  project: unknown,
): DirectorHostMessage {
  return createDirectorBridgeMessage<
    Extract<DirectorHostMessage, { type: "session.open" }>
  >(
    "session.open",
    project == null ? { instanceId, theme } : { instanceId, theme, project },
  );
}

function createPanoramaMessage(
  instanceId: string,
  panorama: DirectorPanoramaInput,
): DirectorHostMessage {
  return createDirectorBridgeMessage<
    Extract<DirectorHostMessage, { type: "panorama.set" }>
  >("panorama.set", { instanceId, ...panorama });
}

function createSnapshotResultMessage(
  instanceId: string,
  action: "save" | "restore",
  status: "saved" | "restored" | "empty" | "error",
  project?: unknown,
): DirectorHostMessage {
  return createDirectorBridgeMessage<
    Extract<DirectorHostMessage, { type: "project.snapshot.result" }>
  >("project.snapshot.result", {
    instanceId,
    action,
    status,
    ...(project === undefined ? {} : { project }),
  });
}

export default function createDirectorDeskPlugin(
  runtime: PluginRuntime,
): CanvasPlugin {
  const React = runtime.React;
  const h = React.createElement;

  function DirectorDeskContent({ ctx }: { ctx: CanvasNodeContext }) {
    const iframeRef = React.useRef<HTMLIFrameElement>(null);
    const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );
    const pendingProjectRef = React.useRef<unknown>(undefined);
    const [frameReady, setFrameReady] = React.useState(false);
    const [frameClosed, setFrameClosed] = React.useState(false);
    const [projectSynced, setProjectSynced] = React.useState(false);
    const [panorama, setPanorama] =
      React.useState<DirectorPanoramaInput | null>(() =>
        findDirectorPanoramaInput(
          ctx.node.id,
          ctx.getNodes(),
          ctx.getConnections(),
        ),
      );
    const metadata = (ctx.node.metadata || {}) as DirectorDeskMetadata;
    const lastCapture = stringValue(metadata.content);
    const showFrame = !frameClosed && (ctx.isSelected || !lastCapture);
    const theme = document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";

    const postToFrame = React.useCallback((message: DirectorHostMessage) => {
      iframeRef.current?.contentWindow?.postMessage(
        message,
        window.location.origin,
      );
    }, []);

    const persistProject = React.useCallback(
      (project: unknown) => {
        pendingProjectRef.current = project;
        setProjectSynced(false);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          const pending = pendingProjectRef.current;
          pendingProjectRef.current = undefined;
          void ctx.storage
            .set(directorProjectStorageKey(ctx.node.id), pending)
            .then(() => setProjectSynced(true));
        }, 250);
      },
      [ctx.node.id, ctx.storage],
    );

    React.useEffect(() => {
      const refresh = () => {
        const next = findDirectorPanoramaInput(
          ctx.node.id,
          ctx.getNodes(),
          ctx.getConnections(),
        );
        setPanorama((current: DirectorPanoramaInput | null) =>
          samePanorama(current, next) ? current : next,
        );
      };
      refresh();
      const timer = window.setInterval(refresh, 750);
      return () => window.clearInterval(timer);
    }, [ctx]);

    React.useEffect(() => {
      if (!frameReady || !panorama) return;
      postToFrame(createPanoramaMessage(ctx.node.id, panorama));
    }, [ctx.node.id, frameReady, panorama, postToFrame]);

    React.useEffect(() => {
      const storageKey = stringValue(metadata.storageKey);
      if (!storageKey) return;
      let canceled = false;
      void ctx.media.resolveImage(storageKey, lastCapture).then((url) => {
        if (!canceled && url && url !== lastCapture)
          ctx.updateMetadata({ content: url });
      });
      return () => {
        canceled = true;
      };
    }, [ctx, lastCapture, metadata.storageKey]);

    React.useEffect(() => {
      const onMessage = (event: MessageEvent) => {
        if (
          event.origin !== window.location.origin ||
          event.source !== iframeRef.current?.contentWindow ||
          !isDirectorFrameMessage(event.data)
        )
          return;
        const message = event.data;
        if (message.type === "ready") {
          const capabilities = new Set(message.payload.capabilities);
          if (
            !DIRECTOR_BRIDGE_CAPABILITIES.every((capability) =>
              capabilities.has(capability),
            )
          )
            return;
          void ctx.storage
            .get(directorProjectStorageKey(ctx.node.id))
            .then((project) => {
              postToFrame(createSessionMessage(ctx.node.id, theme, project));
              setFrameReady(true);
            });
          return;
        }
        if (
          message.type === "project.changed" &&
          message.payload.instanceId === ctx.node.id
        ) {
          persistProject(message.payload.project);
          return;
        }
        if (
          message.type === "project.snapshot.save" &&
          message.payload.instanceId === ctx.node.id
        ) {
          void ctx.storage
            .set(
              directorRecentProjectStorageKey(ctx.node.id),
              message.payload.project,
            )
            .then(() =>
              postToFrame(
                createSnapshotResultMessage(ctx.node.id, "save", "saved"),
              ),
            )
            .catch(() =>
              postToFrame(
                createSnapshotResultMessage(ctx.node.id, "save", "error"),
              ),
            );
          return;
        }
        if (
          message.type === "project.snapshot.restore" &&
          message.payload.instanceId === ctx.node.id
        ) {
          void ctx.storage
            .get(directorRecentProjectStorageKey(ctx.node.id))
            .then((project) =>
              postToFrame(
                project == null
                  ? createSnapshotResultMessage(
                      ctx.node.id,
                      "restore",
                      "empty",
                    )
                  : createSnapshotResultMessage(
                      ctx.node.id,
                      "restore",
                      "restored",
                      project,
                    ),
              ),
            )
            .catch(() =>
              postToFrame(
                createSnapshotResultMessage(ctx.node.id, "restore", "error"),
              ),
            );
          return;
        }
        if (
          message.type === "panorama.removed" &&
          message.payload.instanceId === ctx.node.id
        ) {
          const edge = ctx
            .getConnections()
            .find(
              (connection) =>
                connection.id === message.payload.edgeId &&
                connection.fromNodeId === message.payload.sourceNodeId &&
                connection.toNodeId === ctx.node.id,
            );
          if (edge)
            ctx.applyOps([{ type: "delete_connections", ids: [edge.id] }]);
          return;
        }
        if (
          message.type === "captures.sent" &&
          message.payload.instanceId === ctx.node.id
        ) {
          const captures = normalizeDirectorCaptures(message.payload.captures);
          if (!captures.length) return;
          const batchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
          ctx.updateMetadata({ status: "loading", errorDetails: undefined });
          void persistDirectorCaptureBatch(ctx, captures, batchId).catch(() => {
            ctx.updateMetadata({
              status: "error",
              errorDetails: "镜头截图保存失败，请重试",
            });
          });
          return;
        }
        if (
          message.type === "close" &&
          (!message.payload.instanceId ||
            message.payload.instanceId === ctx.node.id)
        ) {
          setFrameClosed(true);
          setFrameReady(false);
          ctx.updateMetadata({ interactive: false });
        }
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }, [ctx, persistProject, postToFrame, theme]);

    React.useEffect(
      () => () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        if (pendingProjectRef.current !== undefined)
          void ctx.storage.set(
            directorProjectStorageKey(ctx.node.id),
            pendingProjectRef.current,
          );
      },
      [ctx.node.id, ctx.storage],
    );

    React.useEffect(() => {
      if (!showFrame) setFrameReady(false);
    }, [showFrame]);

    const stop = (event: { stopPropagation: () => void }) =>
      event.stopPropagation();
    const status =
      metadata.status === "loading"
        ? "正在保存镜头截图"
        : metadata.status === "error"
          ? "截图保存失败，请重试"
          : panorama
            ? "已接入全景"
            : projectSynced
              ? "项目已同步"
              : lastCapture
                ? "最近截图"
                : "打开导演台开始创作";

    return h(
      "div",
      {
        className: "director-desk-node",
        "data-canvas-no-zoom": true,
        onMouseDown: stop,
        onPointerDown: stop,
        onWheel: stop,
        style: { background: ctx.theme.node.fill, color: ctx.theme.node.text },
      },
      showFrame
        ? h("iframe", {
            ref: iframeRef,
            className: "director-desk-node__frame",
            src: buildDirectorDeskIframeSource(ctx.node.id, theme),
            title: `${ctx.node.title}预览`,
            style: { colorScheme: "dark" },
            onLoad: () => setFrameReady(false),
          })
        : lastCapture
          ? h("img", {
              className: "director-desk-node__thumbnail",
              src: lastCapture,
              alt: `${ctx.node.title}最近截图`,
            })
          : h(
              "button",
              {
                className: "director-desk-node__open",
                type: "button",
                onClick: () => {
                  setFrameClosed(false);
                  ctx.updateMetadata({ interactive: true });
                },
              },
              "打开导演台",
            ),
      h(
        "div",
        {
          className: "director-desk-node__status",
          style: {
            background: `${ctx.theme.toolbar.panel}e8`,
            color: ctx.theme.node.text,
          },
        },
        h("span", {
          className: `director-desk-node__dot${frameReady ? " is-ready" : ""}`,
        }),
        h("span", null, status),
      ),
    );
  }

  return {
    id: DIRECTOR_DESK_PLUGIN_ID,
    name: "导演台节点",
    version: DIRECTOR_DESK_VERSION,
    description: "在画布中连接全景素材，并把导演台截图送回工作流",
    css: `
.director-desk-node{position:relative;width:100%;height:100%;overflow:hidden;border-radius:20px}
.director-desk-node__frame,.director-desk-node__thumbnail{display:block;width:100%;height:100%;border:0;object-fit:cover;background:#05070a}
.director-desk-node__open{display:grid;width:100%;height:100%;place-items:center;border:0;color:#dbeafe;background:#05070a;font:600 13px/1.2 ui-sans-serif,system-ui,sans-serif;cursor:pointer}
.director-desk-node__status{position:absolute;left:10px;bottom:10px;display:flex;align-items:center;gap:7px;max-width:calc(100% - 20px);padding:6px 9px;border-radius:9px;font:500 11px/1.2 ui-sans-serif,system-ui,sans-serif;backdrop-filter:blur(12px)}
.director-desk-node__dot{width:6px;height:6px;flex:none;border-radius:999px;background:#94a3b8}.director-desk-node__dot.is-ready{background:#22c55e}
`,
    nodes: [
      {
        type: DIRECTOR_DESK_NODE_TYPE,
        title: "导演台",
        icon: "🎬",
        description: "安排场景、机位和镜头",
        defaultSize: { width: 520, height: 320 },
        defaultMetadata: {
          content: "",
          status: "idle",
          interactive: false,
          directorSchemaVersion: 1,
        } as DirectorDeskMetadata,
        minimapColor: "#2563eb",
        showInCreateMenu: true,
        hasSourceHandle: true,
        hidePanel: true,
        interactionToggle: true,
        resource: (node) => {
          const url = stringValue(node.metadata?.content);
          return url ? { kind: "image", url } : null;
        },
        Content: DirectorDeskContent,
        toolbar: (ctx) => [
          {
            id: "director-desk-open",
            title: "打开导演台",
            label: "导演台",
            icon: "🎬",
            onClick: () => openDirectorDesk(ctx),
          },
        ],
        onDoubleClick: (ctx) => {
          openDirectorDesk(ctx);
          return true;
        },
      },
    ],
  };
}
