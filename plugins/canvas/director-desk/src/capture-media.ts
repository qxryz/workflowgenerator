import type { DirectorBridgeCapture } from "../../../../web/src/lib/director-bridge";
import type {
  CanvasAgentOp,
  CanvasNodeContext,
  CanvasNodeData,
  CanvasNodeMetadata,
  CanvasPluginStoredImage,
} from "@infinite-canvas/plugin-sdk";

const MAX_CAPTURE_BATCH = 12;

export type DirectorStoredCapture = {
  fileName: string;
  image: CanvasPluginStoredImage;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function captureTitle(fileName: string, index: number) {
  return fileName.replace(/\.[^.]+$/, "").trim() || `导演台截图 ${index + 1}`;
}

function storedImageMetadata(
  image: CanvasPluginStoredImage,
): CanvasNodeMetadata {
  return {
    content: image.url,
    storageKey: image.storageKey,
    status: "success",
    naturalWidth: image.width,
    naturalHeight: image.height,
    bytes: image.bytes,
    mimeType: image.mimeType,
  };
}

export function normalizeDirectorCaptures(
  value: unknown,
): DirectorBridgeCapture[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CAPTURE_BATCH).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const capture = item as Partial<DirectorBridgeCapture>;
    const dataUrl = stringValue(capture.dataUrl);
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) return [];
    return [
      {
        dataUrl,
        fileName:
          stringValue(capture.fileName) ||
          `director-desk-capture-${index + 1}.png`,
      },
    ];
  });
}

export function buildDirectorCaptureOps(
  node: CanvasNodeData,
  captures: DirectorStoredCapture[],
  batchId: string,
): { ops: CanvasAgentOp[]; lastCapture?: DirectorStoredCapture } {
  const lastCapture = captures.at(-1);
  const ops: CanvasAgentOp[] = lastCapture
    ? [
        {
          type: "update_node",
          id: node.id,
          metadata: {
            ...storedImageMetadata(lastCapture.image),
            errorDetails: undefined,
            directorLastCaptureFileName: lastCapture.fileName,
          } as CanvasNodeMetadata,
        },
      ]
    : [];
  captures.forEach((capture, index) => {
    const id = `${node.id}-capture-${batchId}-${index + 1}`;
    ops.push({
      type: "add_node",
      id,
      nodeType: "image",
      title: captureTitle(capture.fileName, index),
      x: node.position.x + node.width + 72,
      y: node.position.y + index * 280,
      width: 340,
      height: 240,
      metadata: storedImageMetadata(capture.image),
    });
    ops.push({ type: "connect_nodes", fromNodeId: node.id, toNodeId: id });
  });
  return { ops, lastCapture };
}

export async function persistDirectorCaptureBatch(
  ctx: Pick<CanvasNodeContext, "node" | "media" | "applyOps">,
  captures: unknown,
  batchId: string,
) {
  const stored: DirectorStoredCapture[] = [];
  try {
    for (const capture of normalizeDirectorCaptures(captures)) {
      stored.push({
        fileName: capture.fileName,
        image: await ctx.media.storeImage(capture.dataUrl),
      });
    }
    if (!stored.length) return 0;
    ctx.applyOps(buildDirectorCaptureOps(ctx.node, stored, batchId).ops);
    return stored.length;
  } catch (error) {
    await Promise.allSettled(
      stored.map((capture) => ctx.media.discardImage(capture.image)),
    );
    throw error;
  }
}
