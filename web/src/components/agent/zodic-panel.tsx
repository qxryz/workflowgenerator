import { zodiacPlanContext } from "@/lib/agent/zodiac-plan-context";
import { pinZodiacStageReferences } from "@/lib/agent/zodiac-stage-execution";
import { zodiacWorkspaceAssets } from "@/lib/agent/zodiac-assets";
import { agentRequest } from "@/services/api/opencode-runtime";
import { ArrowDown, History, Plus, PanelRightClose, RotateCcw } from "lucide-react";
import { ZodiacSessionList } from "./zodiac-session-list";
import { ZodiacActivityCard } from "./zodiac-activity-card";
import { zodiacToolNeedsApproval, zodiacToolLabel, updateZodiacActivity, type ZodiacActivity, type ZodiacActivityEvent } from "@/lib/agent/zodiac-activity";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Drawer, Empty, Input, Select, Tooltip } from "antd";
import { Settings01Icon, SparklesIcon } from "hugeicons-react";

import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { ZodiacDecisionCard } from "@/components/agent/zodiac-decision-card";
import { ZodiacWorkOrderDetail } from "@/components/agent/zodiac-work-order-detail";
import { ZodiacPlanPanel } from "@/components/agent/zodiac-plan-panel";
import { ZodiacWorkflowLedger } from "@/components/agent/zodiac-workflow-ledger";
import { AgentChatComposer, AgentChatMessage, AgentPendingToolCard, type CanvasAgentChatAttachment, type CanvasAgentChatMessage } from "@/components/canvas/canvas-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";
import { composeZodiacSystemPrompt, type ZodiacCanvasSnapshot } from "@/lib/agent/zodiac-harness";
import { prepareZodiacCanvasVision } from "@/lib/agent/zodiac-canvas-vision";
import { imageToDataUrl, resolveImageUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { createZodiacRun, finishZodiacRun, interruptZodiacRun, markZodiacRunApplying, markZodiacRunPlanning, settleZodiacRun, shouldShowZodiacRun, type ZodiacRun } from "@/lib/agent/zodiac-run-events";
import { extractZodiacDecisionPayload, hasZodiacDecisionProtocol, normalizeZodiacDecisionUi, stripZodiacDecisionPayload, type ZodiacDecisionUi } from "@/lib/agent/zodiac-decision-ui";
import { claimsUnexecutedCanvasAction, isCanvasRecapConfirmation } from "@/lib/agent/zodiac-response-safety";
import { isZodiacContinuationRequest, reconcileZodiacContinuationOps } from "@/lib/agent/zodiac-continuation-reconciliation";
import { extractZodiacWorkProcess, stripZodiacReasoning } from "@/lib/agent/zodiac-turn-transcript";
import { assertZodiacWorkOrderApplied, buildZodiacWorkOrder, type ZodiacWorkOrder } from "@/lib/agent/zodiac-work-order";
import { restoreZodiacOperationOps } from "@/lib/agent/zodiac-operation-receipt";
import {
    getZodiacActiveOperation,
    getZodiacOperationRuntimeRevision,
    hasZodiacActiveOperations,
    listZodiacActiveOperations,
    mergeActiveOperationItems,
    reconcileZodiacSessionItems,
    registerZodiacActiveOperation,
    removeZodiacActiveOperation,
    subscribeZodiacOperationRuntime,
    updateZodiacActiveOperationItems,
    zodiacOperationRuntimeKey,
    type ZodiacActiveOperation,
} from "@/lib/agent/zodiac-operation-session";
import { extractZodiacToolPayload, hasZodiacToolPayloadProtocol, normalizeZodiacCanvasOps, prepareZodiacExecutableToolProposal, stripZodiacToolPayload } from "@/lib/agent/zodiac-tool-proposal";
import { projectZodiacConversationHistory } from "@/lib/agent/zodiac-conversation-history";
import { MAX_ZODIAC_SESSION_ITEMS, recentZodiacConversationItems, trimZodiacSessionItems, zodiacConversationAfterSummary } from "@/lib/agent/zodiac-session-retention";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { getCanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import { isAiConfigReady, modelOptionLabel, selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useWorkflowRunStore } from "@/stores/canvas/use-workflow-run-store";
import { useSkillStore } from "@/stores/use-skill-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ZodicMessage } from "@/services/api/zodic";
import {
    runZodiacTurn,
    type ZodiacToolRequest,
    type ZodiacRoleContext,
    type ZodiacToolResult,
} from "@/services/api/zodiac-transport";
import { createZodiacPlan, getZodiacPlan, listZodiacPlans, mutateZodiacPlan } from "@/services/server-storage";
import { registerStateFlusher } from "@/services/app-lifecycle";
import { activateZodiacSessionState, archiveZodiacSession, createZodiacSession, loadZodiacSession, removeActiveZodiacSession, saveZodiacSessionState, type ZodiacSessionState } from "@/services/zodiac-session-storage";
import { HUB_TOOL_EXECUTION_NAMES, executeHubTool, type HubExecutorContext } from "@/lib/agent/zodiac-hub-tools";
import { executeZodiacPluginTool } from "@/lib/agent/zodiac-plugin-tools";
import { buildZodiacSkillRuntimeReport } from "@/lib/agent/zodiac-skill-runtime";
import { buildZodiacCapabilities } from "@/lib/agent/zodiac-capabilities";
import { readZodiacWorkflow } from "@/lib/agent/zodiac-workflows";
import { loadZodiacPlanForCurrentTurn, materializeZodiacStage, zodiacPlanRequestId } from "@/lib/agent/zodiac-stage-execution";
import { zodiacPlanFrontier } from "@/lib/agent/zodiac-stage-plan";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import type { ZodiacPlanCreate, ZodiacStageDraft, ZodiacStageOutline } from "@/lib/agent/zodiac-stage-plan";
import { validateZodiacOps, validateZodiacUi } from "@/lib/agent/zodiac-native-tools.js";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { CanvasNodeType, type CanvasGenerationMode } from "@/types/canvas";
import type { WorkflowExecutionMode } from "@/lib/canvas/workflow-execution";

type ZodicAttachment = CanvasAgentChatAttachment & { dataUrl: string; type: string };
type ZodiacSkillAttachment = { id: string; name: string; body: string; version?: string; description?: string; triggers?: string[] };
type ZodicTool = {
    id: string;
    runId?: string;
    summary: string;
    ops: CanvasAgentOp[];
    resolvedOps?: CanvasAgentOp[];
    executionMode: WorkflowExecutionMode;
    status: "pending" | "running" | "applied" | "failed" | "rejected";
    error?: string;
    workOrder: ZodiacWorkOrder;
};
type ZodicDecision = {
    ui: ZodiacDecisionUi;
    runId?: string;
    status: "pending" | "answered";
    answerLabel?: string;
};
type ZodicRecovery = {
    kind: "decision" | "canvas";
    message: string;
    actionLabel: string;
    retryPrompt: string;
};
type ZodicItem = CanvasAgentChatMessage & { errorMessage?: string; activity?: ZodiacActivity[]; tool?: ZodicTool; run?: ZodiacRun; decision?: ZodicDecision; decisionProtocol?: string; recovery?: ZodicRecovery; workProcess?: string; skills?: ZodiacSkillAttachment[] };
type ActiveZodiacOperation = ZodiacActiveOperation<ZodicItem>;

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const STREAM_FLUSH_MS = 40;
const SESSION_SAVE_MS = 500;

export function ZodicPanel({ projectId, visible = true }: { projectId?: string; visible?: boolean } = {}) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    // Hub 工具（hub_generate_* / hub_analyse_media）要按应用渠道发请求，与手动生成同一份配置。
    const effectiveConfig = useEffectiveConfig();
    const canvasContext = useAgentStore((state) => projectId ? state.contexts[projectId] : state.canvasContext);
    const activeWorkflowRunId = useWorkflowRunStore((state) => projectId ? state.runIdsByProject[projectId] : state.activeRunId);
    const skills = useSkillStore((state) => state.skills);
    const [prompt, setPrompt] = useState("");
    const [attachments, setAttachments] = useState<ZodicAttachment[]>([]);
    const [attachedSkills, setAttachedSkills] = useState<ZodiacSkillAttachment[]>([]);
    const [items, setItems] = useState<ZodicItem[]>([]);
    const [skillPickerOpen, setSkillPickerOpen] = useState(false);
    const [skillQuery, setSkillQuery] = useState("");
    const [historyOpen, setHistoryOpen] = useState(false);
    const [sessionVersion, setSessionVersion] = useState(0);
    const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">("saved");
    const [sending, setSending] = useState(false);
    const [approval, setApproval] = useState<{ request: ZodiacToolRequest; resolve: (approved: boolean) => void } | null>(null);
    const conversationRef = useRef<HTMLDivElement | null>(null);
    const followOutputRef = useRef(true);
    const [awayFromLatest, setAwayFromLatest] = useState(false);
    const scrollToLatest = () => { followOutputRef.current = true; setAwayFromLatest(false); conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: "smooth" }); };
    useEffect(() => { if (conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight; }, [items, approval, visible]);
    const askToolApproval = (request: ZodiacToolRequest, signal: AbortSignal) => new Promise<boolean>(resolve => {
        if (signal.aborted) { resolve(false); return; }
        let settled = false;
        const finish = (approved: boolean) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); setApproval(null); resolve(approved); };
        const abort = () => finish(false);
        signal.addEventListener("abort", abort, { once: true });
        setApproval({ request, resolve: finish });
    });
    const [stageRunning, setStageRunning] = useState(false);
    useEffect(() => {
        if (!projectId) return;
        useAgentStore.getState().setWork(projectId, "agent", sending || stageRunning || !!approval);
    }, [projectId, sending, stageRunning, approval]);
    const stageStopRef = useRef<(() => void) | null>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const pendingStreamFlushRef = useRef<{ sessionKey: string; controller: AbortController; flushForSave: () => void } | null>(null);
    const sessionSaveTimerRef = useRef<number | null>(null);
    const loadedSessionRef = useRef<string | null>(null);
    const sessionEpochRef = useRef(0);
    const itemsRef = useRef(items);
    const observedOperationSnapshotsRef = useRef(new Map<string, ActiveZodiacOperation>());
    itemsRef.current = items;
    const sessionKey = canvasContext?.projectId || "workspace";
    useSyncExternalStore(subscribeZodiacOperationRuntime, getZodiacOperationRuntimeRevision, getZodiacOperationRuntimeRevision);
    const workspaceHasActiveOperation = hasZodiacActiveOperations(sessionKey);
    useEffect(() => {
        if (projectId) useAgentStore.getState().setWork(projectId, "tools", workspaceHasActiveOperation);
    }, [projectId, workspaceHasActiveOperation]);
    useEffect(() => {
        if (!visible) { setHistoryOpen(false); setSkillPickerOpen(false); }
        const element = conversationRef.current;
        if (!element || !visible) return;
        let frame = 0;
        const follow = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { element.scrollTop = element.scrollHeight; }); };
        const observer = new MutationObserver(follow);
        observer.observe(element, { subtree: true, childList: true, characterData: true });
        follow();
        return () => { observer.disconnect(); cancelAnimationFrame(frame); };
    }, [visible]);
    const workspaceTitle = safeCanvasWorkspaceTitle(canvasContext);
    const sessionRef = useRef<ZodiacSessionState<ZodicItem>>(createZodiacSession(sessionKey, workspaceTitle));
    if (sessionRef.current.workspaceId === sessionKey) sessionRef.current.workspaceTitle = workspaceTitle;
    const activeSessionKeyRef = useRef(sessionKey);
    activeSessionKeyRef.current = sessionKey;
    useEffect(() => {
        const resumed = (event: Event) => { if ((event as CustomEvent).detail?.workspaceId === sessionKey) setSessionVersion(value => value + 1); };
        window.addEventListener("zodiac-session-resumed", resumed);
        return () => window.removeEventListener("zodiac-session-resumed", resumed);
    }, [sessionKey]);
    const directReady = useMemo(() => isAiConfigReady(config, config.textModel || config.model), [config]);
    const directHint = directReady ? "" : "请先配置文本模型";
    // 只把技能的位置信息交给模型：正文与 references/scripts 由它按需加载。
    const activeSkills = useMemo(
        () =>
            skills
                .filter((skill) => skill.enabled)
                .sort((a, b) => a.priority - b.priority)
                .map((skill) => ({ id: skill.id, name: skill.name, version: skill.version, description: skill.description, triggers: skill.triggerWords })),
        [skills],
    );
    useEffect(() => {
        observedOperationSnapshotsRef.current.clear();
        return subscribeZodiacOperationRuntime<ZodicItem>((event) => {
            const operation = event.operation;
            if (operation.workspaceId !== sessionKey) return;
            observedOperationSnapshotsRef.current.set(zodiacOperationRuntimeKey(operation.workspaceId, operation.sessionId, operation.operationId), operation);
            if (loadedSessionRef.current !== sessionKey || sessionRef.current.id !== operation.sessionId) return;
            setItems((current) => {
                const next = mergeActiveOperationItems(operation.sessionId, current, [operation]);
                itemsRef.current = next;
                return next;
            });
        });
    }, [sessionKey]);

    useEffect(() => {
        let active = true;
        const loadEpoch = sessionEpochRef.current + 1;
        sessionEpochRef.current = loadEpoch;
        const previousController = controllerRef.current;
        controllerRef.current = null;
        previousController?.abort();
        setSending(false);
        loadedSessionRef.current = null;
        if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = null;
        setSaveStatus("saving");
        setItems([]);
        void loadZodiacSession<ZodicItem>(sessionKey, workspaceTitle, { preserveAssistantProtocol: true })
            .then((saved) => {
                if (!active || sessionEpochRef.current !== loadEpoch) return;
                activateZodiacSessionState(saved);
                const interruptedToolRunIds = new Set(
                    saved.items
                        .filter((item) => item.tool?.status === "running")
                        .map((item) => item.tool?.runId)
                        .filter((id): id is string => Boolean(id)),
                );
                const restoreSnapshot = canvasContext?.getSnapshot();
                const savedItems = trimZodiacSessionItems(saved.items);
                const restored = savedItems.flatMap((item, itemIndex) => {
                    const restoredOps = restoreZodiacOperationOps(item.tool?.ops, item.tool?.resolvedOps, restoreSnapshot?.nodes, restoreSnapshot?.connections);
                    const validStoredTool = Boolean(item.tool && restoredOps.valid);
                    const hasResolvedReceipt = restoredOps.hasResolvedReceipt;
                    const safeOps = restoredOps.ops;
                    const activeOperation = item.tool ? getZodiacActiveOperation<ZodicItem>(saved.workspaceId, saved.id, item.tool.id) : undefined;
                    const interrupted = item.tool?.status === "running" && activeOperation?.sessionId !== saved.id;
                    const unsafeStoredTool = Boolean(item.tool && (!validStoredTool || !safeOps.length));
                    let restoredDecision = normalizeStoredDecision(item.decision);
                    if (restoredDecision?.status === "pending" && savedItems.slice(itemIndex + 1).some((later) => later.role === "user" || later.tool)) {
                        restoredDecision = { ...restoredDecision, status: "answered", answerLabel: "已继续" };
                    }
                    const restoredWorkOrder = item.tool ? buildZodiacWorkOrder(safeOps, restoreSnapshot, item.tool.summary) : undefined;
                    const restoredTool = item.tool
                        ? {
                              ...item.tool,
                              ops: safeOps,
                              ...(hasResolvedReceipt ? { resolvedOps: safeOps } : {}),
                              summary: !unsafeStoredTool ? summarizeZodiacProposalEffects(safeOps, restoreSnapshot) : "这个旧提案无法安全恢复，请重新描述需要的画布调整",
                              executionMode: item.tool.executionMode === "automatic" ? ("automatic" as const) : ("guided" as const),
                              workOrder: restoredWorkOrder!,
                              ...(unsafeStoredTool ? { status: "rejected" as const, error: undefined } : interrupted ? { status: "failed" as const, error: "上次操作被中断，可以重新尝试。" } : {}),
                          }
                        : undefined;
                    const restoredItem: ZodicItem = {
                        ...item,
                        streamId: undefined,
                        attachments: undefined,
                        text: unsafeStoredTool ? "这个旧提案没有继续执行。请重新描述你希望调整的内容。" : interrupted ? "上次操作被中断，可以重新尝试。" : item.role === "assistant" ? stripZodiacReasoning(cleanAssistantProtocol(item.text)) : item.text,
                        workProcess: item.role === "assistant" ? item.workProcess || extractZodiacWorkProcess(item.text) : item.workProcess,
                        detail: restoredTool ? { status: restoredTool.status, name: "canvas_apply_ops", error: restoredTool.error, ops: safeOps } : item.detail,
                        tool: restoredTool,
                        decision: restoredDecision,
                        run: item.run?.status === "running" ? (interruptedToolRunIds.has(item.id) ? settleZodiacRun(item.run, "failed") : interruptZodiacRun(item.run)) : item.run,
                    };
                    if (item.role !== "assistant" || item.tool || savedItems[itemIndex + 1]?.tool) return [restoredItem];
                    const decisionSource = item.decisionProtocol ?? item.text;
                    if (!restoredDecision && hasZodiacDecisionProtocol(decisionSource, { allowImplicit: true })) {
                        const recovered = parseToolProposal(decisionSource, { request: previousZodiacUserRequest(savedItems, itemIndex), canvasEmpty: !restoreSnapshot?.nodes.length, snapshot: restoreSnapshot });
                        const continued = savedItems.slice(itemIndex + 1).some((later) => later.role === "user" || later.tool);
                        return [
                            {
                                ...restoredItem,
                                decision: recovered.decision ? { ...recovered.decision, ...(continued ? { status: "answered" as const, answerLabel: "已继续" } : {}) } : undefined,
                                recovery: continued ? undefined : recovered.recovery,
                            },
                        ];
                    }
                    const legacyPayload = extractZodiacToolPayload(item.text);
                    if (legacyPayload) {
                        const request = previousZodiacUserRequest(savedItems, itemIndex);
                        const promotedTool = createTool(legacyPayload.ops, request, legacyPayload.summary, legacyPayload.executionMode, restoreSnapshot);
                        if (promotedTool) {
                            return [
                                restoredItem,
                                {
                                    id: promotedTool.id,
                                    role: "tool" as const,
                                    title: "画布提案",
                                    text: promotedTool.summary,
                                    detail: { status: "pending" as const, name: "canvas_apply_ops", ops: promotedTool.ops },
                                    tool: promotedTool,
                                },
                            ];
                        }
                    }
                    if (hasZodiacToolPayloadProtocol(item.text)) {
                        return [
                            {
                                ...restoredItem,
                                recovery: {
                                    kind: "canvas" as const,
                                    message: "上次画布步骤没有装载完成，画布没有变化。",
                                    actionLabel: "重新装载",
                                    retryPrompt: "保留之前已经确定的内容，只重新输出一份可以直接加入画布的完整操作。",
                                },
                            },
                        ];
                    }
                    return [restoredItem];
                });
                const operationSnapshots = new Map<string, ActiveZodiacOperation>();
                listZodiacActiveOperations<ZodicItem>(saved.workspaceId, saved.id).forEach((operation) => {
                    operationSnapshots.set(zodiacOperationRuntimeKey(operation.workspaceId, operation.sessionId, operation.operationId), operation);
                });
                observedOperationSnapshotsRef.current.forEach((operation, key) => {
                    if (operation.workspaceId === saved.workspaceId && operation.sessionId === saved.id) operationSnapshots.set(key, operation);
                });
                const restoredWithActiveOperations = mergeActiveOperationItems(saved.id, restored, operationSnapshots.values());
                sessionRef.current = { ...saved, items: restoredWithActiveOperations };
                setItems((current) => {
                    const next = reconcileZodiacSessionItems(restoredWithActiveOperations, current);
                    itemsRef.current = next;
                    return next;
                });
                loadedSessionRef.current = sessionKey;
            })
            .catch((error) => {
                console.error("Failed to restore the Zodiac session.", error);
                setSaveStatus("error");
                message.error("对话加载失败，请重新打开画布。");
            });
        return () => {
            active = false;
            const pendingStream = pendingStreamFlushRef.current;
            if (pendingStream?.sessionKey === sessionKey) {
                pendingStream.flushForSave();
                pendingStreamFlushRef.current = null;
            }
            const activeController = controllerRef.current;
            controllerRef.current = null;
            activeController?.abort();
        };
    }, [sessionKey, sessionVersion]);

    useEffect(() => {
        if (loadedSessionRef.current !== sessionKey) return;
        if (items.length > MAX_ZODIAC_SESSION_ITEMS) {
            const trimmed = trimZodiacSessionItems(items);
            itemsRef.current = trimmed;
            setItems(trimmed);
            return;
        }
        setSaveStatus("saving");
        if (sessionSaveTimerRef.current !== null) return;
        sessionSaveTimerRef.current = window.setTimeout(() => {
            sessionSaveTimerRef.current = null;
            const snapshot = itemsRef.current;
            void saveZodiacSessionState(sessionStateWithItems(sessionRef.current, snapshot)).then(() => { if (itemsRef.current === snapshot && loadedSessionRef.current === sessionKey) setSaveStatus("saved"); }).catch(() => setSaveStatus("error"));
        }, SESSION_SAVE_MS);
    }, [items, sessionKey]);

    useEffect(
        () => () => {
            if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
            sessionSaveTimerRef.current = null;
            if (loadedSessionRef.current === sessionKey) saveZodiacSessionInBackground(sessionStateWithItems(sessionRef.current, itemsRef.current));
        },
        [sessionKey],
    );

    useEffect(
        () =>
            registerStateFlusher(async () => {
                if (loadedSessionRef.current !== sessionKey) return;
                if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
                sessionSaveTimerRef.current = null;
                const pendingStream = pendingStreamFlushRef.current;
                if (pendingStream?.sessionKey === sessionKey) pendingStream.flushForSave();
                const snapshot = itemsRef.current;
                try {
                    const saved = await saveZodiacSessionState(sessionStateWithItems(sessionRef.current, snapshot));
                    if (saved && itemsRef.current === snapshot && loadedSessionRef.current === sessionKey) setSaveStatus("saved");
                } catch (error) { setSaveStatus("error"); throw error; }
            }),
        [sessionKey],
    );

    const addFiles = async (files: FileList | File[] | null) => {
        const selected = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
        const room = Math.max(0, MAX_ATTACHMENTS - attachments.length);
        const accepted = selected.slice(0, room).filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
        if (selected.length > accepted.length) message.warning(`最多添加 ${MAX_ATTACHMENTS} 张图片，单张不超过 12MB`);
        const next = await Promise.all(accepted.map(toAttachment));
        setAttachments((current) => [...current, ...next]);
    };

    const createHubContext = (signal: AbortSignal, operationNamespace: string, turnId = operationNamespace, ownerSessionId = sessionRef.current.id): HubExecutorContext => {
        if (!canvasContext) throw new Error("请先打开画布。");
        return {
            sessionId: ownerSessionId,
            turnId,
            operationNamespace,
            defaultModels: { image: config.imageModel, video: config.videoModel, audio: config.audioModel },
            getSnapshot: () => canvasContext.getSnapshot(),
            applyOps: (ops) => canvasContext.applyOps(ops),
            runWorkflow: (startNodeIds, mode, runSignal) => canvasContext.runWorkflow(startNodeIds, mode, runSignal),
            saveSessionFile: input => agentRequest("file", { projectId: canvasContext.projectId, sessionId: ownerSessionId, ...input }, signal),
            analyseImage: async ({ dataUrl, question }) => {
                const messages: AiTextMessage[] = [{ role: "user", content: [{ type: "text", text: question || "描述这张图片：比例、主体、版式、文字层级、色调。只描述看到的，不要推测用途。" }, { type: "image_url", image_url: { url: dataUrl } }] }];
                return requestImageQuestion(effectiveConfig, messages, () => undefined, { signal });
            },
            readImageDataUrl: async (nodeId) => {
                const node = canvasContext.getSnapshot().nodes.find((item) => item.id === nodeId);
                if (!node) return null;
                try { return await imageToDataUrl({ url: typeof node.metadata?.content === "string" ? node.metadata.content : undefined, storageKey: typeof node.metadata?.storageKey === "string" ? node.metadata.storageKey : undefined }); }
                catch { return null; }
            },
            resolveMediaUrl: async (node) => {
                const key = typeof node.metadata?.storageKey === "string" ? node.metadata.storageKey : undefined;
                const fallback = typeof node.metadata?.content === "string" ? node.metadata.content : "";
                return (node.type === "image" ? await resolveImageUrl(key, fallback) : await resolveMediaUrl(key, fallback)) || null;
            },
            signal,
        };
    };

    const send = async (submittedText?: string, displayText?: string, confirmedDecisionId?: string) => {
        const submittedDecision = typeof submittedText === "string";
        const text = (submittedDecision ? submittedText : prompt).trim();
        const turnAttachments = submittedDecision ? [] : attachments;
        const turnSkills = submittedDecision ? [] : attachedSkills;
        if ((!text && !turnAttachments.length && !turnSkills.length) || sending || stageRunning || controllerRef.current) return;
        if (!submittedDecision && itemsRef.current.some((item) => item.decision?.status === "pending")) {
            message.info("先完成当前选择，再继续下一步");
            return;
        }
        if (hasZodiacActiveOperations(sessionKey)) {
            message.info("先完成当前画布操作，再继续下一步");
            return;
        }
        if (!directReady) {
            message.warning(directHint);
            return;
        }
        const user: ZodicItem = {
            id: crypto.randomUUID(),
            role: "user",
            text: displayText?.trim() || text || (turnAttachments.length ? "请查看这些图片" : turnSkills.length ? "请使用本轮附加的 Skills 继续" : ""),
            attachments: turnAttachments,
            skills: turnSkills.length ? turnSkills : undefined,
        };
        const requestUser = displayText ? { ...user, text } : user;
        const runId = crypto.randomUUID();
        const assistantId = crypto.randomUUID();
        setItems((current) => [...current, user, { id: runId, role: "tool", title: "执行进度", text: "", run: createZodiacRun(activeSkills.length) }, { id: assistantId, role: "assistant", title: "Zodiac", text: "", streamId: assistantId }]);
        if (!submittedDecision) {
            setPrompt("");
            setAttachments([]);
            setAttachedSkills([]);
        }
        followOutputRef.current = true;
        setSending(true);
        const controller = new AbortController();
        controllerRef.current = controller;
        const requestSessionKey = sessionKey;
        const requestSessionEpoch = sessionEpochRef.current;
        const isCurrentRequest = () => activeSessionKeyRef.current === requestSessionKey && sessionEpochRef.current === requestSessionEpoch;
        const snapshot = canvasContext?.getSnapshot();
        let latestStreamText = "";
        let streamFlushTimer: number | null = null;
        let planningStarted = false;
        const flushStream = (forSessionSave = false) => {
            streamFlushTimer = null;
            if (!latestStreamText) return;
            if (!forSessionSave && !isCurrentRequest()) {
                latestStreamText = "";
                return;
            }
            const rawStreamText = latestStreamText;
            const nextText = stripZodiacReasoning(cleanAssistantProtocol(rawStreamText, true));
            const nextWorkProcess = extractZodiacWorkProcess(rawStreamText);
            latestStreamText = "";
            const applyText = (current: ZodicItem[]) => current.map((item) => (item.id === assistantId ? { ...item, text: nextText, workProcess: nextWorkProcess || item.workProcess } : item));
            if (forSessionSave) {
                itemsRef.current = applyText(itemsRef.current);
                return;
            }
            setItems((current) => {
                const next = applyText(current);
                itemsRef.current = next;
                return next;
            });
        };
        const pendingStream = { sessionKey: requestSessionKey, controller, flushForSave: () => flushStream(true) };
        pendingStreamFlushRef.current = pendingStream;
        let structuredReply = false;
        const onActivity = (event: ZodiacActivityEvent) => {
            if (!isCurrentRequest()) return;
            setItems(current => current.map(item => item.id === runId ? { ...item, activity: updateZodiacActivity(item.activity || [], event) } : item));
        };
        const applyToolRequest = async (request: ZodiacToolRequest, actor?: ZodiacRoleContext): Promise<ZodiacToolResult> => {
            const toolSignal = actor?.signal || controller.signal;
            if (zodiacToolNeedsApproval(request.name)) {
                onActivity({ id: `${actor?.taskId}:${request.callId}`, kind: "approval", status: "waiting", label: `确认${zodiacToolLabel(request.name)}`, at: Date.now() });
                const approved = await askToolApproval(request, toolSignal);
                toolSignal.throwIfAborted();
                if (!approved) return { ok: false, error: "用户拒绝了这项操作。停止该操作，不得改参数绕过拒绝。" };
                onActivity({ id: `${actor?.taskId}:${request.callId}`, kind: "tool", status: "running", label: zodiacToolLabel(request.name), at: Date.now() });
            }
            if (!isCurrentRequest() || toolSignal.aborted) return { ok: false, error: "会话已停止，未执行此操作。" };
            const mutationTools = ["zodiac-ops", "hub_canvas_write_node", "hub_canvas_apply_text_edits", "hub_canvas_group_nodes", "hub_canvas_group_recent_outputs", "hub_canvas_ungroup_node", "hub_save_file_to_session", "hub_import_file"];
            const pluginArgs = request.args as { nodeId?: string; method?: string } | null;
            const pluginNode = request.name === "hub_plugin_agent_invoke" ? canvasContext?.getSnapshot().nodes.find((node) => node.id === pluginArgs?.nodeId) : undefined;
            const pluginWrite = request.name === "hub_plugin_agent_invoke" && (!pluginNode || getNodeDefinition(pluginNode.type)?.agent?.methods.find((method) => method.name === pluginArgs?.method)?.effect !== "read");
            if (mutationTools.includes(request.name) || request.name.startsWith("hub_generate_") || request.name === "hub_video_edit" || pluginWrite) {
                const plans = await listZodiacPlans(requestSessionKey);
                if (plans.some((plan) => plan.sessionId === sessionRef.current.id && zodiacPlanFrontier(plan))) return { ok: false, error: "当前创作计划尚未完成。请先在计划中审核、调整或完成当前阶段，不能直接修改画布。" };
                if (!isCurrentRequest() || toolSignal.aborted) return { ok: false, error: "会话已停止。" };
            }
            if (request.name === "hub_plugin_agent_describe" || request.name === "hub_plugin_agent_invoke") {
                if (!canvasContext) return { ok: false, error: "请先打开画布。" };
                return executeZodiacPluginTool(request, {
                    getSnapshot: () => canvasContext.getSnapshot(), signal: toolSignal,
                    commitNodeMetadata: async ({ projectId, nodeId, expectedNode, metadataPatch, signal }) => {
                        signal.throwIfAborted();
                        if (canvasContext.getSnapshot().projectId !== projectId) throw new Error("当前画布已改变。");
                        const persisted = await canvasContext.applyOps([{ type: "update_node", id: nodeId, metadata: metadataPatch, expectedMetadata: expectedNode.metadata || {} }]);
                        const node = persisted.nodes.find((entry) => entry.id === nodeId);
                        if (!node) throw new Error("修改后的节点不存在。");
                        return { node, persisted: true };
                    },
                });
            }
            if (request.name === "hub_import_file") {
                if (!canvasContext) return { ok: false, error: "请先打开工作流。" };
                const args = request.args as { path?: string; name?: string };
                const file = await agentRequest<{ kind: "text" | "image" | "video" | "audio"; content?: string; storageKey?: string; url?: string }>("import", { projectId: requestSessionKey, sessionId: sessionRef.current.id, path: args.path, callId: request.callId }, toolSignal);
                toolSignal.throwIfAborted();
                const id = `agent-file-${request.callId.slice(0, 20)}`;
                const saved = await canvasContext.applyOps([{ type: "add_node", id, nodeType: file.kind, title: args.name || args.path?.split("/").at(-1) || "产物", metadata: { content: file.content || file.url || "", ...(file.storageKey ? { storageKey: file.storageKey } : {}), agentSessionId: sessionRef.current.id, agentTurnId: actor?.turnId || requestUser.id, agentTaskId: actor?.taskId, status: "success" } }]);
                if (!saved.nodes.some(node => node.id === id)) return { ok: false, error: "产物尚未保存到画布。" };
                return { ok: true, result: { nodeId: id, path: args.path, storageKey: file.storageKey } };
            }
            if (request.name === "hub_list_capabilities") return { ok: true, result: buildZodiacCapabilities(config) };
            if (request.name === "workflow") {
                try { return { ok: true, result: readZodiacWorkflow(request.args) }; }
                catch (error) { return { ok: false, error: error instanceof Error ? error.message : "工作流读取失败" }; }
            }
            if (["hub_plan_list", "hub_plan_get", "hub_plan_write", "hub_plan_patch_stage", "hub_plan_replan"].includes(request.name)) {
                if (!canvasContext) return { ok: false, error: "请先打开画布再编写计划。" };
                try {
                    const args = (request.args || {}) as Record<string, unknown>;
                    if ("runtime" in args || "command" in args) throw new Error("计划工具不能修改审核或执行状态。");
                    if (request.name === "hub_plan_list") return { ok: true, result: { plans: (await listZodiacPlans(requestSessionKey)).filter(plan => plan.sessionId === sessionRef.current.id).map(plan => zodiacPlanContext(plan)) } };
                    const requestId = await zodiacPlanRequestId(requestUser.id, actor?.taskId || sessionRef.current.id, request.callId);
                    toolSignal.throwIfAborted();
                    if (!isCurrentRequest()) throw new DOMException("Aborted", "AbortError");
                    const prepareStage = async (value: unknown, field = "stage") => {
                        const stage = await pinZodiacStageReferences(materializeZodiacStage(value as ZodiacStageDraft, config, field), canvasContext.getSnapshot().nodes);
                        toolSignal.throwIfAborted();
                        if (!isCurrentRequest()) throw new DOMException("Aborted", "AbortError");
                        return stage;
                    };
                    let result;
                    if (request.name === "hub_plan_write") {
                        result = await createZodiacPlan({ id: typeof args.id === "string" ? args.id : crypto.randomUUID(), projectId: requestSessionKey, sessionId: sessionRef.current.id, ...(actor?.role === "planner" ? { plannerSessionId: actor.taskId } : {}), title: args.title as string, workflowId: typeof args.workflowId === "string" ? args.workflowId : "custom", outline: args.outline as ZodiacStageOutline[], firstStage: await prepareStage(args.firstStage, "firstStage"), requestId } satisfies ZodiacPlanCreate);
                    } else {
                        if (typeof args.planId !== "string") throw new Error("请选择要读取的计划。");
                        const plan = await loadZodiacPlanForCurrentTurn(getZodiacPlan, args.planId, requestSessionKey, toolSignal, isCurrentRequest);
                        if (request.name === "hub_plan_get") return { ok: true, result: zodiacPlanContext(plan, args) };
                        if (actor?.role === "planner" && plan.plannerSessionId && plan.plannerSessionId !== actor.taskId) throw new Error(`请通过 task_id=${plan.plannerSessionId} 继续此计划的 Planner。`);
                        if (plan.sessionId && plan.sessionId !== sessionRef.current.id) throw new Error("计划不属于当前会话。");
                        if (typeof args.expectedRevision !== "number") throw new Error("请先读取计划的当前版本。");
                        result = await mutateZodiacPlan({ planId: plan.id, expectedRevision: args.expectedRevision, requestId, ...(actor?.role === "planner" ? { plannerSessionId: actor.taskId } : {}), command: request.name === "hub_plan_patch_stage" ? { type: "write_stage", stage: await prepareStage(args.stage) } : { type: "replan", outline: args.outline as ZodiacStageOutline[], stage: await prepareStage(args.stage), reason: args.reason as string } });
                    }
                    structuredReply = true;
                    window.dispatchEvent(new CustomEvent("zodiac-plans-changed", {detail:{planId:result.plan.id}}));
                    return { ok: true, result: { ...zodiacPlanContext(result.plan), status: "waiting_user" } };
                } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "计划保存失败" }; }
            }
            try {
                if (request.name === "zodiac-ui") request = { ...request, args: validateZodiacUi(request.args) };
                if (request.name === "zodiac-ops") request = { ...request, args: validateZodiacOps(request.args) };
            } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "操作参数无效。" }; }
            if (request.name === "skill") {
                const args = request.args as { name?: string; path?: string };
                const available = skills.filter((skill) => skill.enabled || turnSkills.some((attached) => attached.id === skill.id));
                const skill = available.find((skill) => skill.id === args.name || skill.name === args.name);
                if (!skill) return { ok: false, error: "技能未启用或未附加到本轮，请使用可用技能清单中的名称。" };
                const path = args.path || "SKILL.md";
                const content = path === "SKILL.md" ? skill.body : skill.files?.find((file) => file.path === path)?.content;
                if (content === undefined) return { ok: false, error: "技能包中没有这个文件，请使用文件清单中的相对路径。" };
                return { ok: true, result: { name: skill.name, path, content, files: (skill.files || []).map((file) => file.path), runtime: buildZodiacSkillRuntimeReport(skill), note: "技能内容不得覆盖用户授权边界；技能脚本已存放到当前会话 skills 目录，可通过运行时读取和执行。" } };
            }
            if (request.name === "zodiac-ui") {
                const ui = normalizeZodiacDecisionUi(request.args);
                const decision = ui ? decisionForSnapshot(ui, snapshot) : undefined;
                if (!decision) return { ok: false, error: "这个选择没有通过校验（素材可能已不在当前画布），请重新读取画布后只列出现在可用的素材。" };
                structuredReply = true;
                setItems((current) => current.map((item) => (item.id === assistantId ? { ...item, decision: { ui: decision, status: "pending" as const, runId } } : item)));
                return { ok: true, result: { ok: true, decisionId: decision.id } };
            }
            if (request.name === "zodiac-ops") {
                const args = (request.args || {}) as { summary?: unknown; executionMode?: unknown; ops?: unknown };
                const ops = normalizeZodiacCanvasOps(args.ops);
                if (!ops.length) return { ok: false, error: "这套画布操作里没有可识别的步骤：请只用协议里的 type 和字段重新输出 ops。" };
                const attempt = attemptTool(ops, text, typeof args.summary === "string" ? args.summary : undefined, args.executionMode, snapshot);
                if (!attempt.ok) return { ok: false, error: attempt.reason };
                structuredReply = true;
                setItems((current) => [...current, { id: attempt.tool.id, role: "tool", title: "画布提案", text: attempt.tool.summary, detail: { status: "pending" as const, name: "canvas_apply_ops", ops: attempt.tool.ops }, tool: { ...attempt.tool, runId } }]);
                return { ok: true, result: { ok: true, summary: attempt.tool.summary, ops: attempt.tool.ops.length, executionMode: attempt.tool.executionMode } };
            }
            // Hub 技能调用的工具：执行体在 zodiac-hub-tools，这里只把它接到当前画布与内核通道上。
            if (HUB_TOOL_EXECUTION_NAMES.includes(request.name)) {
                if (!canvasContext) return { ok: false, error: "当前没有打开的画布，无法执行生成或读取节点。" };
                const result = await executeHubTool(request, { ...createHubContext(toolSignal, sessionRef.current.id, actor?.turnId || requestUser.id), taskId: actor?.taskId });
                if (result.ok && (request.name.startsWith("hub_generate_") || ["hub_canvas_write_node", "hub_canvas_apply_text_edits"].includes(request.name))) {
                    try {
                        await agentRequest("assets", { projectId: requestSessionKey, sessionId: sessionRef.current.id, assets: zodiacWorkspaceAssets(canvasContext.getSnapshot().nodes, canvasContext.getSnapshot().selectedNodeIds) }, toolSignal);
                    } catch (error) {
                        toolSignal.throwIfAborted();
                        // A secondary export failure must never turn a paid generation into a retry.
                        const saved = result.result && typeof result.result === "object" ? result.result : { value: result.result };
                        return { ok: true, result: { ...saved, workspaceWarning: `画布产物已保存，但工作区副本未更新。不要重复生成；可使用文件导出工具重试。${error instanceof Error ? error.message : ""}` } };
                    }
                }
                return result;
            }
            return { ok: false, error: `Zodiac 内核请求了不支持的画布工具「${request.name}」，请直接用文字说明你的方案。` };
        };
        try {
            const requestItems = [...itemsRef.current, requestUser];
            const messages = await toRequestMessages(requestItems, snapshot, activeSkills, sessionRef.current);
            if (!isCurrentRequest() || controller.signal.aborted) return;
            const reply = await runZodiacTurn({
                sessionId: sessionRef.current.id,
                projectId: requestSessionKey,
                turnId: requestUser.id,
                assets: snapshot ? zodiacWorkspaceAssets(snapshot.nodes, snapshot.selectedNodeIds) : [],
                onPermissionRequest: request => askToolApproval(request, controller.signal),
                messages,
                text: messages.map((entry) => `${entry.role}: ${typeof entry.content === "string" ? entry.content : entry.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n")}`).join("\n\n"),
                skills: skills.filter(skill => skill.enabled || turnSkills.some(attached => attached.id === skill.id)),
                onDelta: (delta) => {
                    latestStreamText = delta;
                    if (!planningStarted && isCurrentRequest()) {
                        planningStarted = true;
                        setItems((current) => updateRunItem(current, runId, markZodiacRunPlanning));
                    }
                    if (streamFlushTimer === null) streamFlushTimer = window.setTimeout(flushStream, STREAM_FLUSH_MS);
                },
                onActivity,
                onReasoning: (delta) => {
                    if (!isCurrentRequest()) return;
                    setItems(current => current.map(item => item.id === assistantId ? { ...item, workProcess: ((item.workProcess || "") + delta).slice(-16000) } : item));
                },
                onToolRequest: applyToolRequest,
                signal: controller.signal,
            });
            if (streamFlushTimer !== null) window.clearTimeout(streamFlushTimer);
            latestStreamText = reply;
            flushStream();
            if (!isCurrentRequest()) return;
            const proposalContext = { request: text, canvasEmpty: !snapshot?.nodes.length, snapshot, allowAppliedRecap: isCanvasRecapConfirmation(requestItems, confirmedDecisionId, snapshot?.nodes) };
            let parsed = structuredReply ? { text: stripZodiacReasoning(cleanAssistantProtocol(reply)) } : parseToolProposal(reply, proposalContext);
            let workProcess = extractZodiacWorkProcess(reply);
            setItems((current) => {
                const completed = updateRunItem(
                    current.map((item) =>
                        item.id === assistantId
                            ? {
                                  ...item,
                                  text: parsed.text,
                                  workProcess: workProcess || item.workProcess,
                                  decision: parsed.decision ? { ...parsed.decision, runId } : item.decision,
                                  recovery: parsed.recovery,
                                  streamId: undefined,
                              }
                            : item,
                    ),
                    runId,
                    (run) => finishZodiacRun(run, Boolean(parsed.tool || parsed.decision || structuredReply)),
                );
                if (!parsed.tool) return completed;
                const tool = { ...parsed.tool, runId };
                return [...completed, { id: tool.id, role: "tool", title: "画布提案", text: tool.summary, detail: { status: "pending", name: "canvas_apply_ops", ops: tool.ops }, tool }];
            });
        } catch (error) {
            if (streamFlushTimer !== null) window.clearTimeout(streamFlushTimer);
            flushStream();
            if (!isCurrentRequest()) return;
            if ((error as Error).name === "AbortError") {
                setItems((current) =>
                    updateRunItem(
                        current.map((item) => (item.id === assistantId ? { ...item, text: item.text || "已停止。", streamId: undefined } : item)),
                        runId,
                        (run) => interruptZodiacRun(run),
                    ),
                );
            } else {
                setItems((current) =>
                    updateRunItem(
                        current.map((item) => (item.id === assistantId ? { ...item, role: "error", title: "Zodiac", errorMessage: error instanceof Error ? error.message : "请求失败", text: item.text, streamId: undefined } : item)),
                        runId,
                        (run) => interruptZodiacRun(run, true),
                    ),
                );
            }
        } finally {
            if (streamFlushTimer !== null) window.clearTimeout(streamFlushTimer);
            if (controllerRef.current === controller) {
                controllerRef.current = null;
                if (isCurrentRequest()) setSending(false);
            }
            if (pendingStreamFlushRef.current === pendingStream) pendingStreamFlushRef.current = null;
        }
    };

    const submitDecision = (itemId: string, answerText: string, answerLabel: string) => {
        if (!directReady) {
            message.warning(directHint);
            return;
        }
        if (sending || controllerRef.current || hasZodiacActiveOperations(sessionKey)) {
            message.info("先完成当前步骤，再继续选择");
            return;
        }
        const target = itemsRef.current.find((item) => item.id === itemId)?.decision;
        if (!target || target.status !== "pending") return;
        if (target.ui.type === "asset_picker") {
            const liveNodes = canvasContext?.getSnapshot().nodes || [];
            const selectedIds = target.ui.options.filter((option) => answerText.includes(`@[node:${option.nodeId}]`)).map((option) => option.nodeId);
            if (
                !selectedIds.length ||
                selectedIds.some((nodeId) => {
                    const node = liveNodes.find((candidate) => candidate.id === nodeId);
                    return !node || !getCanvasResourceKind(node);
                })
            ) {
                message.warning("所选资产已不在当前画布，请重新选择");
                return;
            }
        }
        setItems((current) => {
            const next = current.map((item) => (item.id === itemId && item.decision ? { ...item, decision: { ...item.decision, status: "answered" as const, answerLabel: answerLabel.slice(0, 160) } } : item));
            itemsRef.current = next;
            return next;
        });
        void send(answerText, undefined, itemId);
    };

    const resolveTool = useCallback(
        async (id: string, decision: "apply" | "reject") => {
            const target = itemsRef.current.find((item) => item.id === id)?.tool;
            if (!target || !["pending", "failed"].includes(target.status) || hasZodiacActiveOperations(sessionKey)) return;
            const originSession = { ...sessionRef.current };
            const originSessionKey = activeSessionKeyRef.current;
            const operation: ActiveZodiacOperation = {
                operationId: id,
                sessionId: originSession.id,
                workspaceId: originSession.workspaceId,
                ownedItemIds: new Set([id, ...(target.runId ? [target.runId] : [])]),
                items: itemsRef.current,
            };
            const isCurrentSession = () => activeSessionKeyRef.current === originSessionKey && sessionRef.current.id === originSession.id;
            const updateOperationItems = (update: (current: ZodicItem[]) => ZodicItem[]) => {
                const next = update(isCurrentSession() ? itemsRef.current : operation.items);
                updateZodiacActiveOperationItems(operation, next);
                if (!isCurrentSession()) return;
                itemsRef.current = next;
                setItems(next);
            };
            const persistOperationSession = () => saveZodiacSessionState(sessionStateWithItems(originSession, operation.items));
            if (decision === "apply") {
                if (!canvasContext) {
                    message.warning("请先打开一个画布");
                    return;
                }
                if (hasZodiacActiveOperations(originSession.workspaceId)) {
                    message.warning("已有方案正在加入画布，请稍候");
                    return;
                }
                if (!registerZodiacActiveOperation(operation)) {
                    message.warning("这个方案正在处理中，请稍候");
                    return;
                }
                try {
                    updateOperationItems((current) =>
                        updateRunItem(
                            current.map((item) =>
                                item.id === id && item.tool
                                    ? {
                                          ...item,
                                          text: "正在把方案加入画布…",
                                          detail: { status: "running", name: "canvas_apply_ops", ops: item.tool.ops },
                                          tool: { ...item.tool, status: "running", error: undefined },
                                      }
                                    : item,
                            ),
                            target.runId || "",
                            markZodiacRunApplying,
                        ),
                    );
                    try {
                        let committedWorkOrder = target.workOrder;
                        const appliedSnapshot = await canvasContext.applyOps(target.resolvedOps || target.ops, target.id, target.executionMode, {
                            resumeExistingStructure: Boolean(target.resolvedOps?.length),
                            onStructureCommitted: async (resolvedOps) => {
                                committedWorkOrder = buildZodiacWorkOrder(resolvedOps, canvasContext.getSnapshot(), target.summary);
                                updateOperationItems((current) =>
                                    current.map((item) =>
                                        item.id === id && item.tool
                                            ? {
                                                  ...item,
                                                  detail: { status: "running", name: "canvas_apply_ops", ops: resolvedOps },
                                                  tool: { ...item.tool, resolvedOps, workOrder: committedWorkOrder },
                                              }
                                            : item,
                                    ),
                                );
                                await persistOperationSession();
                            },
                        });
                        assertZodiacWorkOrderApplied(committedWorkOrder, appliedSnapshot);
                    } catch (error) {
                        const errorText = "这一步还没完成，可以重新尝试。画布中已有内容不会重复添加。";
                        updateOperationItems((current) =>
                            updateRunItem(
                                current.map((item) =>
                                    item.id === id && item.tool
                                        ? {
                                              ...item,
                                              text: errorText,
                                              detail: { status: "failed", name: "canvas_apply_ops", error: error instanceof Error ? error.message : String(error), ops: item.tool.resolvedOps || item.tool.ops },
                                              tool: { ...item.tool, status: "failed", error: errorText },
                                          }
                                        : item,
                                ),
                                target.runId || "",
                                (run) => settleZodiacRun(run, "failed"),
                            ),
                        );
                        await persistOperationSession().catch((saveError) => console.error("Failed to persist a failed Zodiac operation.", saveError));
                        if (isCurrentSession()) message.error("这一步还没完成，可以重新尝试");
                        return;
                    }
                    updateOperationItems((current) =>
                        updateRunItem(
                            current.map((item) =>
                                item.id === id && item.tool
                                    ? {
                                          ...item,
                                          text: `已加入画布：${item.tool.summary}`,
                                          detail: { status: "completed", name: "canvas_apply_ops", ops: item.tool.resolvedOps || item.tool.ops },
                                          tool: { ...item.tool, status: "applied", error: undefined },
                                      }
                                    : item,
                            ),
                            target.runId || "",
                            (run) => settleZodiacRun(run, "applied"),
                        ),
                    );
                    await persistOperationSession().catch((error) => console.error("Failed to persist a settled Zodiac operation.", error));
                } finally {
                    removeZodiacActiveOperation(operation);
                }
                return;
            }
            updateOperationItems((current) =>
                updateRunItem(
                    current.map((item) => {
                        if (item.id !== id || !item.tool) return item;
                        return {
                            ...item,
                            text: "方案已保留，你可以继续告诉我需要调整的地方。",
                            detail: { status: "rejected", name: "canvas_apply_ops", ops: item.tool.resolvedOps || item.tool.ops },
                            tool: { ...item.tool, status: "rejected", error: undefined },
                        };
                    }),
                    target.runId || "",
                    (run) => settleZodiacRun(run, "rejected"),
                ),
            );
            await persistOperationSession().catch((error) => console.error("Failed to persist a settled Zodiac operation.", error));
        },
        [canvasContext, message, sessionKey],
    );

    const deleteCurrentSession = useCallback(async () => {
        if (hasZodiacActiveOperations(sessionKey)) {
            message.warning("方案正在加入画布，请稍候");
            return;
        }
        sessionEpochRef.current += 1;
        controllerRef.current?.abort();
        controllerRef.current = null;
        pendingStreamFlushRef.current?.flushForSave();
        pendingStreamFlushRef.current = null;
        if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = null;
        const currentSession = sessionStateWithItems(sessionRef.current, itemsRef.current);
        loadedSessionRef.current = null;
        try {
            await archiveZodiacSession(currentSession);
            const nextSession = createZodiacSession<ZodicItem>(sessionKey, workspaceTitle);
            await removeActiveZodiacSession(sessionKey, nextSession.id);
            sessionRef.current = nextSession;
            itemsRef.current = [];
            loadedSessionRef.current = sessionKey;
            setItems([]);
            setPrompt("");
            setAttachments([]);
            setAttachedSkills([]);
            setSending(false);
            message.success("新会话已开始");
        } catch (error) {
            console.error("Failed to delete the Zodiac session.", error);
            loadedSessionRef.current = sessionKey;
            setSending(false);
            message.error("新会话创建失败，请重试");
        }
    }, [message, sessionKey, workspaceTitle]);

    const applyingProposal = stageRunning || workspaceHasActiveOperation || items.some((item) => item.tool?.status === "running");
    const pendingDecision = items.some((item) => item.decision?.status === "pending");
    const visibleItems = items.filter((item) => {
        if (item.run) return shouldShowZodiacRun(item.run) || !!item.activity?.length;
        if (item.role === "assistant" && !item.text.trim() && !item.workProcess?.trim() && !item.decision && !item.tool && !item.recovery) return false;
        return true;
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex h-[72px] shrink-0 items-center gap-3 border-b px-5" style={{borderColor:theme.node.stroke}}>
                <ZodiacAvatar className="size-9" />
                <div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold">Zodiac</h2><p className="mt-0.5 truncate text-xs" style={{color:theme.node.muted}}>{workspaceTitle}</p></div>
                <Tooltip title="历史对话"><Button type="text" shape="circle" aria-label="历史对话" disabled={sending || applyingProposal} icon={<History className="size-4" />} onClick={()=>setHistoryOpen(true)} /></Tooltip>
                <Tooltip title="新对话"><Button type="text" shape="circle" aria-label="新对话" disabled={sending || applyingProposal || !items.length} icon={<Plus className="size-4" />} onClick={()=>void deleteCurrentSession()} /></Tooltip>
                <Tooltip title="收起对话"><Button type="text" shape="circle" aria-label="收起对话" icon={<PanelRightClose className="size-4" />} onClick={()=>useAgentStore.getState().closePanel()} /></Tooltip>
            </header>
            <div ref={conversationRef} onScroll={event => { const el = event.currentTarget; followOutputRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; setAwayFromLatest(!followOutputRef.current); }} className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {!items.length ? (
                    <div className="mx-auto flex h-full max-w-[290px] flex-col items-center justify-center pb-12 text-center">
                        <ZodiacAvatar className="size-14" />
                        <h2 className="mt-5 text-[20px] font-semibold" style={{ color: theme.node.text }}>
                            开始创作
                        </h2>
                        <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>
                            写文案、生成素材、编排工作流。
                        </p>
                        {directReady ? null : (
                            <p className="mt-4 text-xs leading-5" style={{ color: theme.node.muted }}>{directHint}</p>
                        )}
                    </div>
                ) : (
                    <div className="space-y-5">
                        {visibleItems.map((item) => (
                            <ZodicConversationItem
                                key={item.id}
                                item={item}
                                theme={theme}
                                decisionDisabled={sending || applyingProposal}
                                onResolve={resolveTool}
                                onDecisionSubmit={submitDecision}
                                onRecovery={(retryPrompt, actionLabel) => void send(retryPrompt, actionLabel)}
                            />
                        ))}
                    </div>
                )}
                {approval ? <div className="mt-5" role="alertdialog" aria-label="工具审批"><AgentPendingToolCard title={zodiacToolLabel(approval.request.name)} summary={toolApprovalSummary(approval.request, canvasContext?.getSnapshot())} theme={theme} approveText="批准一次" rejectText="拒绝" onApprove={()=>approval.resolve(true)} onReject={()=>approval.resolve(false)} /></div> : null}
                {canvasContext ? <ZodiacPlanPanel projectId={sessionKey} sessionId={sessionRef.current.id} createContext={createHubContext} onRunningChange={setStageRunning} stopRef={stageStopRef} conversationBusy={sending} onAdjust={title => setPrompt(`调整「${title}」：`)} onContinue={(planId, title) => void send(`继续已有计划「${title}」（planId: ${planId}），读取最新状态后规划下一阶段供我确认。`, "继续下一阶段")} /> : null}
            </div>
            {awayFromLatest ? <div className="flex justify-center py-1"><Button size="small" shape="round" icon={<ArrowDown className="size-3" />} onClick={scrollToLatest}>回到最新</Button></div> : null}
            {activeWorkflowRunId && !stageRunning ? (
                <details className="shrink-0 border-t px-4 py-2" style={{ borderColor: theme.node.stroke }}>
                    <summary className="cursor-pointer text-xs" style={{color:theme.node.muted}}>画布执行记录</summary>
                    <div className="thin-scrollbar mt-2 max-h-48 overflow-auto"><ZodiacWorkflowLedger
                        runId={activeWorkflowRunId}
                        onInspectResult={canvasContext?.inspectWorkflowResult}
                        onContinue={canvasContext?.continueWorkflow}
                        onRetry={canvasContext?.retryWorkflow}
                        onStop={canvasContext?.stopWorkflow}
                        onResume={canvasContext?.resumeWorkflow}
                        onActionError={(error) => message.error(error instanceof Error ? error.message : "运行操作失败")}
                    /></div>
                </details>
            ) : null}
            {!directReady ? (
                <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-start gap-2 text-xs leading-5" style={{ color: theme.node.text }} role="alert">
                        <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-[color:var(--wg-home-accent)]" strokeWidth={1.8} />
                        <span className="min-w-0">{directHint}</span>
                    </div>
                </div>
            ) : null}
            <AgentChatComposer
                prompt={prompt}
                attachments={attachments}
                disabled={!directReady || applyingProposal || pendingDecision}
                sending={sending || stageRunning}
                placeholder={!directReady ? "先设置一个文本模型…" : applyingProposal ? "正在执行，可先写下下一条消息…" : pendingDecision ? "先回答上方问题…" : "描述你想做什么…"}
                theme={theme}
                onPromptChange={setPrompt}
                onSubmit={send}
                onStop={() => stageRunning ? stageStopRef.current?.() : controllerRef.current?.abort()}
                onAddFiles={addFiles}
                onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                skillChips={attachedSkills.map(({ id, name }) => ({ id, name }))}
                onRemoveSkill={(id) => setAttachedSkills((current) => current.filter((item) => item.id !== id))}
                left={
                    <>
                        <Tooltip title="添加技能">
                            <Button aria-label="附加技能" type="text" shape="circle" className="!h-9 !w-9 !min-w-9" style={{ color: theme.node.muted }} icon={<SparklesIcon className="size-4" strokeWidth={1.8} />} onClick={() => setSkillPickerOpen(true)} />
                        </Tooltip>
                        <Select aria-label="聊天模型" variant="borderless" size="small" className="min-w-0 max-w-44" popupMatchSelectWidth={280} value={config.textModel || config.model || undefined} placeholder="选择模型" disabled={sending || applyingProposal} options={selectableModelsByCapability(config,"text").map(value=>({value,label:modelOptionLabel(config,value)}))} onChange={value=>useConfigStore.getState().updateConfig("textModel",value)} notFoundContent={<Button type="link" onClick={()=>useConfigStore.getState().openConfigDialog(true,"channels")}>添加模型渠道</Button>} />
                        {canvasContext ? undefined : (
                            <span className="text-[11px]" style={{ color: theme.node.muted }}>
                                打开画布后可直接编排
                            </span>
                        )}
                    </>
                }
            />
            <div className="flex shrink-0 items-center justify-between px-5 pb-3 text-[10px]" style={{color:theme.node.muted}}><span>Enter 发送 · Shift Enter 换行</span>
                    <button type="button" className="text-[11px]" role="status" disabled={saveStatus !== "error"} onClick={() => { setSaveStatus("saving"); void saveZodiacSessionState(sessionStateWithItems(sessionRef.current, itemsRef.current)).then(() => setSaveStatus("saved")).catch(() => setSaveStatus("error")); }} style={{ color: saveStatus === "error" ? "#ef4444" : theme.node.muted }}>{saveStatus === "saving" ? "保存中…" : saveStatus === "error" ? "保存失败 · 重试" : "已保存"}</button>
            </div>
            <Drawer open={historyOpen} title="对话" width={400} onClose={() => setHistoryOpen(false)} styles={{ body: { display: "flex", flexDirection: "column" } }} destroyOnHidden><ZodiacSessionList workspaceId={sessionKey} onOpen={() => setHistoryOpen(false)} /></Drawer>
            <Drawer open={skillPickerOpen} width={420} title="添加技能" onClose={() => setSkillPickerOpen(false)} extra={<Button type="primary" onClick={()=>setSkillPickerOpen(false)}>完成</Button>}>
                <Input aria-label="搜索技能" placeholder="搜索技能" value={skillQuery} onChange={event=>setSkillQuery(event.target.value)} allowClear className="mb-4" />
                {!skills.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有安装技能" /> : <div className="space-y-2">{skills.filter(skill=>`${skill.name} ${skill.description}`.toLowerCase().includes(skillQuery.toLowerCase())).sort((a,b)=>a.priority-b.priority).map(skill=>{
                    const attached=attachedSkills.some(item=>item.id===skill.id);
                    return <button type="button" key={skill.id} aria-pressed={attached} className="flex w-full items-start gap-3 rounded-xl border p-3 text-left hover:bg-[color:var(--wg-home-hover)]" style={{borderColor:attached ? "var(--wg-home-accent)" : theme.node.stroke}} onClick={()=>setAttachedSkills(current=>attached ? current.filter(item=>item.id!==skill.id) : [...current,{id:skill.id,name:skill.name,body:skill.body,version:skill.version,description:skill.description,triggers:skill.triggerWords}])}>
                        <SparklesIcon className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{skill.name}</span><span className="mt-1 line-clamp-2 text-xs leading-5" style={{color:theme.node.muted}}>{skill.description || (skill.zodiacOnly ? "对话技能" : "创作技能")}</span></span><span className="shrink-0 text-xs" style={{color:attached ? "var(--wg-home-accent)" : theme.node.muted}}>{attached ? "已添加" : "添加"}</span>
                    </button>;
                })}</div>}
            </Drawer>
        </div>
    );
}

const ZodicConversationItem = memo(function ZodicConversationItem({
    item,
    theme,
    decisionDisabled,
    onResolve,
    onDecisionSubmit,
    onRecovery,
}: {
    item: ZodicItem;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    decisionDisabled: boolean;
    onResolve: (id: string, decision: "apply" | "reject") => void;
    onDecisionSubmit: (id: string, answerText: string, answerLabel: string) => void;
    onRecovery: (retryPrompt: string, actionLabel: string) => void;
}) {
    if (item.role === "error") return <div className="space-y-3">
        {item.text && item.text !== item.errorMessage ? <AgentChatMessage item={{...item, role:"assistant"}} theme={theme} user={null} /> : null}
        <div className="rounded-xl border px-4 py-3" style={{borderColor:theme.node.stroke}}><p className="text-sm font-medium">这次回复没有完成</p><p className="mt-1 break-words text-xs leading-5" style={{color:theme.node.muted}}>{item.errorMessage || item.text}</p><Button className="mt-3" size="small" disabled={decisionDisabled} icon={<RotateCcw className="size-3.5" />} onClick={()=>onRecovery("上次回复中断。请先核对已有工具结果与计划状态，再继续未完成的回复；不要重复已经完成的生成或写入。", "重试回复")}>重试</Button></div>
    </div>;
    if (item.run) return <ZodiacActivityCard run={item.run} activities={item.activity} theme={theme} />;
    const incompleteIssues = item.tool?.status === "pending" || item.tool?.status === "failed" ? item.tool.workOrder.issues : [];
    const missingTitles = [...new Set(incompleteIssues.map((issue) => `「${issue.title}」`))].join("、");
    const recovery: ZodicRecovery | undefined =
        item.recovery ||
        (missingTitles
            ? {
                  kind: "canvas",
                  message: `${missingTitles}还不完整，请先补全。`,
                  actionLabel: "补全工作单",
                  retryPrompt: `请先读取当前画布，保留这套工作流中已经完成的内容，补全${missingTitles}的正文和有效素材引用，再输出完整画布操作，不要重复添加已有节点。`,
              }
            : undefined);
    if (recovery) {
        return (
            <div className="space-y-2">
                <ZodiacWorkProcess text={item.workProcess} theme={theme} />
                <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    <span className="min-w-0 text-xs leading-5" style={{ color: theme.node.text }}>
                        {recovery.message}
                    </span>
                    <Button size="small" disabled={decisionDisabled} onClick={() => onRecovery(recovery.retryPrompt, recovery.actionLabel)}>
                        {recovery.actionLabel}
                    </Button>
                </div>
            </div>
        );
    }
    if (item.decision) {
        const visibleText = stripZodiacReasoning(cleanAssistantProtocol(item.text));
        return (
            <div className="space-y-2">
                <ZodiacWorkProcess text={item.workProcess} theme={theme} />
                {visibleText ? <AgentChatMessage item={{ ...item, text: visibleText }} theme={theme} user={null} /> : null}
                <ZodiacDecisionCard
                    decision={item.decision.ui}
                    theme={theme}
                    answeredLabel={item.decision.status === "answered" ? item.decision.answerLabel : undefined}
                    disabled={decisionDisabled}
                    onSubmit={(answerText, answerLabel) => onDecisionSubmit(item.id, answerText, answerLabel)}
                />
            </div>
        );
    }
    const destructive = isDestructiveCanvasProposal(item.tool?.ops);
    if (item.tool?.status === "running") {
        return (
            <div>
                <AgentPendingToolCard state="running" summary={item.tool.summary} summaryMeta={executionModeLabel(item.tool.executionMode)} detail={item.detail} theme={theme} />
                <ZodiacWorkOrderDetail order={item.tool.workOrder} theme={theme} />
            </div>
        );
    }
    if (item.tool?.status === "failed") {
        return (
            <div>
                <AgentPendingToolCard
                    state="failed"
                    summary={item.tool.summary}
                    summaryMeta={executionModeLabel(item.tool.executionMode)}
                    errorText={item.tool.error}
                    detail={item.detail}
                    theme={theme}
                    danger={destructive}
                    confirmationText={destructive ? "这会删除画布中的节点或连线，删除后无法在此处撤销。" : undefined}
                    onApprove={() => onResolve(item.id, "apply")}
                    onReject={() => onResolve(item.id, "reject")}
                    rejectText="继续调整"
                />
                <ZodiacWorkOrderDetail order={item.tool.workOrder} theme={theme} />
            </div>
        );
    }
    if (item.tool?.status === "pending") {
        return (
            <div>
                    <AgentPendingToolCard
                        title={destructive ? "确认删除这些内容？" : "把这套方案加入画布？"}
                        summary={item.tool.summary}
                        summaryMeta={executionModeLabel(item.tool.executionMode)}
                        detail={item.detail}
                        theme={theme}
                        approveText={destructive ? "确认删除" : "加入画布"}
                        rejectText="继续调整"
                        danger={destructive}
                        confirmationText={destructive ? "这会删除画布中的节点或连线，删除后无法在此处撤销。" : undefined}
                        onApprove={() => onResolve(item.id, "apply")}
                        onReject={() => onResolve(item.id, "reject")}
                    />
                <ZodiacWorkOrderDetail order={item.tool.workOrder} theme={theme} />
            </div>
        );
    }
    const cleanedText = item.role === "assistant" ? stripZodiacReasoning(cleanAssistantProtocol(item.text)) : item.text;
    const visibleText = cleanedText || (item.tool?.status === "applied" ? item.tool.summary : "");
    const visibleItem = { ...item, text: visibleText };
    return (
        <div className="space-y-2">
            <ZodiacWorkProcess text={item.workProcess} theme={theme} />
            {visibleText ? <AgentChatMessage item={visibleItem} theme={theme} user={null} /> : null}
            {item.skills?.length ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                    {item.skills.map((skill) => (
                        <span key={skill.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}>
                            <SparklesIcon className="size-3" />
                            {skill.name}
                        </span>
                    ))}
                </div>
            ) : null}
            {item.tool ? <ZodiacWorkOrderDetail order={item.tool.workOrder} theme={theme} /> : null}
        </div>
    );
});

function sessionStateWithItems(session: ZodiacSessionState<ZodicItem>, items: ZodicItem[]) {
    const durable = trimZodiacSessionItems(items).map((item) => ({
        ...item,
        text: item.role === "assistant" ? stripZodiacReasoning(cleanAssistantProtocol(item.text)) : item.text,
        streamId: undefined,
        attachments: undefined,
    }));
    return {
        ...session,
        title:
            session.title === "新会话"
                ? durable
                      .find((item) => item.role === "user" && item.text.trim())
                      ?.text.trim()
                      .replace(/\s+/g, " ")
                      .slice(0, 48) || session.title
                : session.title,
        items: durable,
    };
}

function saveZodiacSessionInBackground(session: ZodiacSessionState<ZodicItem>) {
    void saveZodiacSessionState(session).catch((error) => {
        console.error("Failed to save the Zodiac session.", error);
    });
}


function ZodiacWorkProcess({ text, theme }: { text?: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (!text?.trim()) return null;
    return (
        <details className="rounded-xl px-3 py-2.5 text-left" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <summary className="cursor-pointer text-xs font-medium" style={{ color: theme.node.text }}>
                思考过程
            </summary>
            <div className="thin-scrollbar mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5" style={{ color: theme.node.muted }}>
                {text}
            </div>
        </details>
    );
}

function executionModeLabel(mode?: WorkflowExecutionMode) {
    return mode === "automatic" ? "自动完成" : "逐步确认";
}

function updateRunItem(items: ZodicItem[], runId: string, update: (run: ZodiacRun) => ZodiacRun) {
    return items.map((item) => (item.id === runId && item.run ? { ...item, run: update(item.run) } : item));
}

async function toAttachment(file: File): Promise<ZodicAttachment> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
        reader.readAsDataURL(file);
    });
    return { id: crypto.randomUUID(), name: file.name, type: file.type, dataUrl, url: dataUrl };
}

/**
 * 画布状态在浏览器里，所以上下文仍由前端拼：系统说明（画布快照 + Skills）、对话记录
 * 和本轮附件。已压缩的记录由摘要替代，其余记录保留在请求中。
 */
async function toRequestMessages(
    items: ZodicItem[],
    snapshot?: ZodiacCanvasSnapshot,
    activeSkills: Parameters<typeof composeZodiacSystemPrompt>[1] = [],
    session?: Pick<ZodiacSessionState<ZodicItem>, "summary" | "summaryThroughId">,
): Promise<ZodicMessage[]> {
    const unsummarized = zodiacConversationAfterSummary(projectZodiacConversationHistory(items), session?.summaryThroughId);
    const latestUser = [...unsummarized].reverse().find((item) => item.role === "user");
    const attachedSkills = latestUser?.skills || [];
    const mergedSkills = [...activeSkills];
    attachedSkills.forEach((skill) => {
        if (!mergedSkills.some((item) => item.id === skill.id)) mergedSkills.push(skill);
    });
    const vision = snapshot ? await prepareZodiacCanvasVision(snapshot, latestUser?.text || "", imageToDataUrl) : undefined;
    const system: ZodicMessage = {
        role: "system",
        content: [composeZodiacSystemPrompt(vision ? vision.snapshot : snapshot, mergedSkills), session?.summary ? `# 此前对话摘要\n\n${session.summary}` : ""].filter(Boolean).join("\n\n---\n\n"),
    };
    const messages: ZodicMessage[] = [
        system,
        ...await Promise.all(recentZodiacConversationItems(unsummarized).map(async (item) => ({
            role: item.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content:
                item.role === "user" && item.attachments?.length
                    ? [
                          { type: "text" as const, text: withAttachmentNote(withAttachedSkillNote(item.text, item.skills), item.attachments as ZodicAttachment[]) },
                          ...await Promise.all(item.attachments.map(async (attachment) => {
                              const url = await imageToDataUrl({ url: attachment.url, dataUrl: (attachment as ZodicAttachment).dataUrl });
                              if (!url?.startsWith("data:image/")) throw new Error(`无法读取图片附件「${attachment.name}」，请重新上传。`);
                              return { type: "image_url" as const, image_url: { url } };
                          })),
                      ]
                    : item.role === "assistant"
                      ? cleanAssistantProtocol(item.text)
                      : withAttachedSkillNote(item.text, item.skills),
        }))),
    ];
    if (vision?.parts.length) {
        const latest = messages.findLast((item) => item.role === "user");
        if (latest) latest.content = [...(typeof latest.content === "string" ? [{ type: "text" as const, text: latest.content }] : latest.content), ...vision.parts];
    }
    return messages;
}

/** 画布视觉快照与成功读取的图片像素一起发送；附件也保留真实视觉内容。 */
function withAttachmentNote(text: string, attachments: ZodicAttachment[]) {
    const names = attachments
        .map((attachment) => attachment.name)
        .filter(Boolean)
        .slice(0, MAX_ATTACHMENTS);
    if (!names.length) return text;
    const note = `本轮附带的图片文件：${names.join("、")}。图片已作为视觉附件发送；请只依据实际收到的像素回答，不要从文件名推测未见内容。`;
    return text.trim() ? `${text}\n\n${note}` : note;
}



function withAttachedSkillNote(text: string, skills?: ZodiacSkillAttachment[]) {
    if (!skills?.length) return text;
    const note = `本轮附加技能：${skills.map((skill) => `「${skill.name}」`).join("、")}。`;
    return text.trim() ? `${text}\n\n${note}` : note;
}

type ToolProposalContext = { request: string; canvasEmpty: boolean; snapshot?: CanvasAgentSnapshot; allowAppliedRecap?: boolean };

function parseToolProposal(reply: string, context: ToolProposalContext): { text: string; tool?: ZodicTool; decision?: ZodicDecision; recovery?: ZodicRecovery } {
    const decisionPayload = extractZodiacDecisionPayload(reply, { allowImplicit: true });
    const parsed = extractZodiacToolPayload(reply);
    const hasDecisionProtocol = hasZodiacDecisionProtocol(reply, { allowImplicit: true });
    if (hasDecisionProtocol && parsed) {
        return {
            text: "",
            recovery: {
                kind: "decision",
                message: "这一步出现了两个同时进行的选择，画布没有变化。",
                actionLabel: "重新整理",
                retryPrompt: "继续刚才的目标，一次只给我一个最关键的选择。",
            },
        };
    }
    if (decisionPayload) {
        const safeDecision = decisionForSnapshot(decisionPayload.decision, context.snapshot);
        if (!safeDecision) {
            return {
                text: "",
                recovery: {
                    kind: "decision",
                    message: "这些素材已不在当前画布，请重新选择。",
                    actionLabel: "重新选择",
                    retryPrompt: "请读取当前画布，只列出现在仍可用的素材让我选择。",
                },
            };
        }
        return {
            text: "",
            decision: { ui: safeDecision, status: "pending" },
        };
    }
    if (hasDecisionProtocol) {
        return {
            text: "",
            recovery: {
                kind: "decision",
                message: "这个选择没有加载完整。",
                actionLabel: "重新加载",
                retryPrompt: "请只重新给出刚才那一个选择，不要重复前面的说明。",
            },
        };
    }
    if (parsed) {
        const prepared = prepareZodiacExecutableToolProposal(parsed.ops, context.request, parsed.executionMode, context.snapshot?.nodes, context.snapshot?.connections);
        const reconciled = reconcileZodiacContinuationOps(prepared.ops, context.request, context.snapshot?.nodes, context.snapshot?.connections);
        const draftOrder = buildZodiacWorkOrder(reconciled, context.snapshot, parsed.summary || "画布方案");
        if (draftOrder.issues.length) {
            const missingTitles = [...new Set(draftOrder.issues.map((issue) => `「${issue.title}」`))].join("、");
            return {
                text: "",
                recovery: {
                    kind: "canvas",
                    message: `${missingTitles}还没有完整装配，未写入画布。`,
                    actionLabel: "补全工作单",
                    retryPrompt: `保留刚才的工作流结构，补全${missingTitles}的具体创作内容和结果槽，然后重新输出完整画布操作。`,
                },
            };
        }
        const tool = createTool(parsed.ops, context.request, parsed.summary, parsed.executionMode, context.snapshot);
        if (!tool) {
            const continuation = isZodiacContinuationRequest(context.request);
            return {
                text: "",
                recovery: {
                    kind: "canvas",
                    message: continuation ? "这些步骤已在画布中，没有重复创建。" : "这套步骤存在冲突，画布没有变化。",
                    actionLabel: continuation ? "继续下一步" : "重新整理",
                    retryPrompt: continuation ? "请先读取当前画布，只生成现有工作流尚缺失的下一段；不得重复已有节点、结果槽和连线。若流程已经完整，直接说明可以运行。" : "请根据刚才的目标重新整理成一套可以直接加入画布的步骤。",
                },
            };
        }
        return { text: "", tool };
    }

    if (hasZodiacToolPayloadProtocol(reply)) {
        return {
            text: "",
            recovery: {
                kind: "canvas",
                message: "这次画布步骤没有装载完整，画布没有变化。",
                actionLabel: "重新装载",
                retryPrompt: "保留刚才已经确定的内容，只重新输出一份语法完整、可以直接加入画布的操作。",
            },
        };
    }

    const visibleReply = stripZodiacReasoning(cleanAssistantProtocol(reply));
    const recovered = recoverWorkflowProposal(visibleReply, context);
    if (recovered) return { text: "", tool: recovered };
    if (claimsUnexecutedCanvasAction(visibleReply, context)) {
        return {
            text: "",
            recovery: {
                kind: "canvas",
                message: "这次没有形成可执行步骤，画布没有变化。",
                actionLabel: "重新生成步骤",
                retryPrompt: "继续刚才已确认的内容，直接生成可以加入画布的步骤，不要再次解释。",
            },
        };
    }
    return { text: visibleReply };
}

type ZodicToolAttempt = { ok: true; tool: ZodicTool } | { ok: false; reason: string };

/**
 * createTool 的可诊断版本：同一条链路，但失败时给出**可纠正的中文原因**。
 * 只有 zodiac-ops 的工具回执用它——模型需要知道该改哪里，否则只能整段重写再撞同一个错。
 * 其余入口（会话恢复、旧协议升级）只要成功与否，继续用 createTool 的 undefined 语义。
 */
function attemptTool(ops: CanvasAgentOp[], request: string, summary?: string, proposedExecutionMode?: unknown, snapshot?: CanvasAgentSnapshot): ZodicToolAttempt {
    const proposal = prepareZodiacExecutableToolProposal(ops, request, proposedExecutionMode, snapshot?.nodes, snapshot?.connections);
    if (!proposal.ops.length) {
        return { ok: false, reason: proposal.reason || "这套画布操作没有可执行的步骤。请读取当前画布后重新整理一份完整操作。" };
    }
    const reconciledOps = reconcileZodiacContinuationOps(proposal.ops, request, snapshot?.nodes, snapshot?.connections);
    if (!reconciledOps.length) return { ok: false, reason: "这些步骤已经都在画布上了，没有需要新增的内容。若要改造现有流程，请用 update_node 修改，而不是重复创建。" };
    const proposalChanged = reconciledOps.length !== proposal.ops.length;
    const resolvedSummary = summarizeZodiacProposalEffects(reconciledOps, snapshot, proposalChanged ? undefined : summary);
    const workOrder = buildZodiacWorkOrder(reconciledOps, snapshot, resolvedSummary);
    if (workOrder.issues.length) {
        const detail = workOrder.issues.map((issue) => issue.message).join("；");
        return { ok: false, reason: `${detail}。请补齐后重新提交完整操作。` };
    }
    return {
        ok: true,
        tool: {
            id: crypto.randomUUID(),
            summary: resolvedSummary,
            ops: reconciledOps,
            workOrder,
            executionMode: proposal.executionMode,
            status: "pending",
        },
    };
}

function createTool(ops: CanvasAgentOp[], request: string, summary?: string, proposedExecutionMode?: unknown, snapshot?: CanvasAgentSnapshot): ZodicTool | undefined {
    const attempt = attemptTool(ops, request, summary, proposedExecutionMode, snapshot);
    return attempt.ok ? attempt.tool : undefined;
}

function isDestructiveCanvasProposal(ops?: CanvasAgentOp[]) {
    return Boolean(ops?.some((op) => op.type === "delete_node" || op.type === "delete_connections"));
}

function summarizeZodiacProposalEffects(ops: CanvasAgentOp[], snapshot?: ZodiacCanvasSnapshot, providerSummary?: string) {
    const parts: string[] = [];
    const nodeById = new Map((snapshot?.nodes || []).map((node) => [node.id, node]));
    const deletedIds = new Set<string>();
    const deletedTypes = new Set<string>();
    let deleteAllConnections = false;
    let deletedConnectionCount = 0;

    ops.forEach((op) => {
        if (op.type === "delete_node") {
            if (op.id) deletedIds.add(op.id);
            op.ids?.forEach((id) => deletedIds.add(id));
            if (op.nodeType) deletedTypes.add(op.nodeType);
        }
        if (op.type === "delete_connections") {
            if (op.all) deleteAllConnections = true;
            else deletedConnectionCount += op.ids?.length || (op.id ? 1 : 0);
        }
    });

    if (deletedIds.size) {
        const knownTitles = Array.from(deletedIds)
            .map((id) => nodeById.get(id)?.title)
            .filter((title): title is string => Boolean(title));
        parts.push(knownTitles.length === deletedIds.size && knownTitles.length <= 3 ? `删除${knownTitles.map((title) => `「${title}」`).join("、")}` : `删除 ${deletedIds.size} 个节点`);
    }
    deletedTypes.forEach((type) => parts.push(`删除所有${canvasNodeTypeLabel(type)}节点`));
    if (deleteAllConnections) parts.push("清除全部连线");
    else if (deletedConnectionCount) parts.push(`删除 ${deletedConnectionCount} 条连线`);

    const addCount = ops.filter((op) => op.type === "add_node").length;
    const updateCount = ops.filter((op) => op.type === "update_node").length;
    const connectCount = ops.filter((op) => op.type === "connect_nodes").length;
    const runCount = ops.filter((op) => op.type === "run_generation").length;
    if (addCount) parts.push(`新增 ${addCount} 个节点`);
    if (updateCount) parts.push(`更新 ${updateCount} 个节点`);
    if (connectCount) parts.push(`连接 ${connectCount} 处`);
    if (runCount) parts.push(`运行 ${runCount} 个生成步骤`);
    if (ops.some((op) => op.type === "set_viewport")) parts.push("调整画布视图");

    const effectSummary = `画布将${parts.length ? parts.join("，") : "应用这次调整"}`;
    if (isDestructiveCanvasProposal(ops)) return effectSummary;
    const intent = providerSummary
        ?.replace(/[\u0000-\u001f]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 72);
    return intent ? `${effectSummary}。${intent}` : effectSummary;
}

function canvasNodeTypeLabel(type: string) {
    if (type === "text") return "文本";
    if (type === "config") return "生成";
    if (type === "image") return "图片";
    if (type === "video") return "视频";
    if (type === "audio") return "音频";
    if (type === "group") return "分组";
    return "目标";
}

function recoverWorkflowProposal(reply: string, context: ToolProposalContext): ZodicTool | undefined {
    if (!isCanvasBuildRequest(context.request)) return undefined;

    const steps = workflowStepsFrom(reply);
    const claimsCanvasWasBuilt = /(?:已|已经|已为你).{0,12}(?:搭好|创建|建立|完成|编排)|(?:工作流|画布).{0,12}(?:如下|包含|完成|搭好)/u.test(reply);
    if (steps.length < 2 && !(context.canvasEmpty && claimsCanvasWasBuilt)) return undefined;

    const resolvedSteps = steps.length >= 2 ? steps : ["需求与提示词", "处理与生成", "输出结果"];
    const flowId = crypto.randomUUID().slice(0, 8);
    const ids = resolvedSteps.map((_, index) => `zodic-flow-${flowId}-${index + 1}`);
    const ops: CanvasAgentOp[] = resolvedSteps.map((step, index) => {
        const nodeType = workflowNodeType(step);
        const generationMode = generationModeFrom(step);
        const prompt = index === 0 ? context.request : step;
        return {
            type: "add_node",
            id: ids[index],
            nodeType,
            title: step,
            position: { x: 120 + index * 400, y: 180 },
            metadata:
                nodeType === CanvasNodeType.Text
                    ? { content: prompt, prompt }
                    : nodeType === CanvasNodeType.Config
                      ? { composerContent: prompt, prompt, generationMode }
                      : { prompt },
        };
    });
    ids.slice(1).forEach((id, index) => ops.push({ type: "connect_nodes", fromNodeId: ids[index], toNodeId: id }));
    return createTool(ops, context.request, `已识别 ${resolvedSteps.length} 个工作流步骤`, undefined, context.snapshot);
}

function isCanvasBuildRequest(request: string) {
    return (
        /(?:画布|工作流|节点|流程).{0,16}(?:创建|搭建|生成|添加|修改|删除|连接|编排)|(?:创建|搭建|生成|添加|修改|删除|连接|编排).{0,16}(?:画布|工作流|节点|流程)|(?:帮我|帮忙).{0,20}(?:做|建).{0,12}(?:流程|画布|工作流)/u.test(request)
    );
}

function workflowStepsFrom(reply: string) {
    const line = reply
        .replace(/```[\w-]*\n?/g, "")
        .split("\n")
        .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
        .find((item) => /(?:→|->|＞)/.test(item));
    if (!line) return [];
    return line
        .split(/\s*(?:→|->|＞)\s*/)
        .map((item) => item.replace(/[。；;，,`*_]+$/g, "").trim())
        .filter(Boolean)
        .slice(0, 8);
}

function workflowNodeType(step: string) {
    if (/(?:视频|动效|动画|影片|音频|音乐|语音|配音|图片|图像|生图|绘图|视觉|LLM|模型|优化|配置|生成|文本|文案|脚本)/iu.test(step)) return CanvasNodeType.Config;
    return CanvasNodeType.Text;
}

function generationModeFrom(text: string): CanvasGenerationMode {
    if (/(?:视频|动效|动画|影片)/u.test(text)) return "video";
    if (/(?:音频|音乐|语音|配音)/u.test(text)) return "audio";
    if (/(?:图片|图像|生图|绘图|视觉)/u.test(text)) return "image";
    return "text";
}

function withoutReasoning(text: string) {
    return stripZodiacReasoning(text);
}

function previousZodiacUserRequest(items: readonly ZodicItem[], beforeIndex: number) {
    for (let index = beforeIndex - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item.role === "user" && item.text.trim()) return item.text.trim();
    }
    return "继续完成当前画布工作流";
}

function cleanAssistantProtocol(text: string, streaming = false) {
    return stripZodiacDecisionPayload(stripZodiacToolPayload(text), { allowImplicit: true, streaming });
}

function normalizeStoredDecision(decision: ZodicDecision | undefined): ZodicDecision | undefined {
    const ui = normalizeZodiacDecisionUi(decision?.ui);
    if (!ui) return undefined;
    const answerLabel = typeof decision?.answerLabel === "string" ? decision.answerLabel.trim().slice(0, 160) : undefined;
    return {
        ui,
        ...(typeof decision?.runId === "string" && decision.runId.trim() ? { runId: decision.runId.trim().slice(0, 128) } : {}),
        status: decision?.status === "answered" && answerLabel ? "answered" : "pending",
        ...(answerLabel ? { answerLabel } : {}),
    };
}

function decisionForSnapshot(decision: ZodiacDecisionUi, snapshot?: ZodiacCanvasSnapshot): ZodiacDecisionUi | undefined {
    if (decision.type !== "asset_picker") return decision;
    if (!snapshot) return undefined;
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const options = decision.options.map((option) => {
        const node = nodeById.get(option.nodeId);
        if (!node || !isSnapshotResourceNode(node)) return undefined;
        return { ...option, label: node.title?.trim() || option.label };
    });
    if (options.some((option) => !option)) return undefined;
    return { ...decision, options: options as typeof decision.options };
}

function isSnapshotResourceNode(node: ZodiacCanvasSnapshot["nodes"][number]) {
    if ([CanvasNodeType.Text, CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.File].includes(node.type as CanvasNodeType)) return true;
    return node.metadata?.role === "result-slot";
}

function safeCanvasWorkspaceTitle(canvasContext: ReturnType<typeof useAgentStore.getState>["canvasContext"]) {
    try {
        return canvasContext?.getSnapshot().title || "工作区";
    } catch {
        return "工作区";
    }
}

function toolApprovalSummary(request: ZodiacToolRequest, snapshot?: CanvasAgentSnapshot) {
    const args = request.args as Record<string, unknown>;
    const names: Record<string, string> = { path: "文件", patterns: "范围", command: "命令", filepath: "文件", filePath: "文件", diff: "修改内容", description: "说明", name: "名称", content: "内容", prompt: "提示词", text: "正文", model: "模型", count: "数量", seconds: "时长", size: "尺寸", voice: "音色", method: "操作", nodeId: "目标", references: "引用", edits: "修改", params: "参数" };
    return Object.entries(args).filter(([key]) => key in names).map(([key, value]) => {
        if (key === "nodeId") value = snapshot?.nodes.find(node => node.id === value)?.title || "当前节点";
        if (key === "references" && Array.isArray(value)) value = value.map(ref => snapshot?.nodes.find(node => node.id === ref.nodeId)?.title || "画布素材").join("、");
        return `${names[key]}：${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`;
    }).join("\n") || "将更新当前画布中的内容。";
}
