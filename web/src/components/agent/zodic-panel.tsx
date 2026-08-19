import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Drawer, Empty, Popconfirm, Tag, Tooltip } from "antd";
import { CheckmarkCircle02Icon, Delete02Icon, Settings01Icon, SparklesIcon } from "hugeicons-react";

import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { ZodiacDecisionCard } from "@/components/agent/zodiac-decision-card";
import { ZodiacWorkOrderDetail } from "@/components/agent/zodiac-work-order-detail";
import { ZodiacWorkflowLedger } from "@/components/agent/zodiac-workflow-ledger";
import { AgentChatComposer, AgentChatMessage, AgentPendingToolCard, type CanvasAgentChatAttachment, type CanvasAgentChatMessage } from "@/components/canvas/canvas-agent-chat-ui";
import { PersonalSkillEditorModal } from "@/components/skills/skills-manager";
import { canvasThemes } from "@/lib/canvas-theme";
import { composeZodiacSystemPrompt, type ZodiacCanvasSnapshot } from "@/lib/agent/zodiac-harness";
import { createZodiacRun, finishZodiacRun, interruptZodiacRun, markZodiacRunApplying, markZodiacRunPlanning, settleZodiacRun, shouldShowZodiacRun, type ZodiacRun } from "@/lib/agent/zodiac-run-events";
import { extractZodiacDecisionPayload, hasExplicitZodiacDecisionProtocol, normalizeZodiacDecisionUi, stripZodiacDecisionPayload, type ZodiacDecisionUi } from "@/lib/agent/zodiac-decision-ui";
import { claimsUnexecutedCanvasAction } from "@/lib/agent/zodiac-response-safety";
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
import { extractZodiacToolPayload, hasZodiacToolPayloadProtocol, prepareZodiacExecutableToolProposal, stripZodiacToolPayload } from "@/lib/agent/zodiac-tool-proposal";
import {
    MAX_ZODIAC_SESSION_ITEMS,
    planZodiacContextCompaction,
    recentZodiacConversationItems,
    trimZodiacSessionItems,
    zodiacConversationAfterSummary,
} from "@/lib/agent/zodiac-session-retention";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { getCanvasResourceKind } from "@/lib/canvas/canvas-resource-references";
import { isAiConfigReady, useConfigStore } from "@/stores/use-config-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useWorkflowRunStore } from "@/stores/canvas/use-workflow-run-store";
import { useSkillStore } from "@/stores/use-skill-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { requestZodicReply, type ZodicMessage } from "@/services/api/zodic";
import { registerDesktopFlusher } from "@/services/desktop-lifecycle";
import { createPersonalSkill, type InstalledSkill } from "@/services/skills/skill-presets";
import {
    activateZodiacSessionState,
    archiveZodiacSession,
    createZodiacSession,
    loadZodiacSession,
    removeActiveZodiacSession,
    saveZodiacSessionState,
    type ZodiacSessionState,
} from "@/services/zodiac-session-storage";
import { CanvasNodeType, type CanvasGenerationMode } from "@/types/canvas";
import type { WorkflowExecutionMode } from "@/lib/canvas/workflow-execution";

type ZodicAttachment = CanvasAgentChatAttachment & { dataUrl: string; type: string };
type ZodiacSkillAttachment = { id: string; name: string; body: string };
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
type ZodicItem = CanvasAgentChatMessage & { tool?: ZodicTool; run?: ZodiacRun; decision?: ZodicDecision; recovery?: ZodicRecovery; workProcess?: string; skills?: ZodiacSkillAttachment[] };
type ActiveZodiacOperation = ZodiacActiveOperation<ZodicItem>;

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const STREAM_FLUSH_MS = 40;
const SESSION_SAVE_MS = 500;

export function ZodicPanel() {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasContext = useAgentStore((state) => state.canvasContext);
    const confirmTools = useAgentStore((state) => state.confirmTools);
    const showReasoning = useAgentStore((state) => state.showReasoning);
    const activeWorkflowRunId = useWorkflowRunStore((state) => state.activeRunId);
    const skills = useSkillStore((state) => state.skills);
    const saveSkill = useSkillStore((state) => state.save);
    const [prompt, setPrompt] = useState("");
    const [attachments, setAttachments] = useState<ZodicAttachment[]>([]);
    const [attachedSkills, setAttachedSkills] = useState<ZodiacSkillAttachment[]>([]);
    const [items, setItems] = useState<ZodicItem[]>([]);
    const [skillDraft, setSkillDraft] = useState<InstalledSkill | null>(null);
    const [skillPickerOpen, setSkillPickerOpen] = useState(false);
    const [sending, setSending] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);
    const pendingStreamFlushRef = useRef<{ sessionKey: string; controller: AbortController; flushForSave: () => void } | null>(null);
    const sessionSaveTimerRef = useRef<number | null>(null);
    const loadedSessionRef = useRef<string | null>(null);
    const sessionEpochRef = useRef(0);
    const itemsRef = useRef(items);
    const observedOperationSnapshotsRef = useRef(new Map<string, ActiveZodiacOperation>());
    itemsRef.current = items;
    const sessionKey = canvasContext?.projectId || "workspace";
    useSyncExternalStore(
        subscribeZodiacOperationRuntime,
        getZodiacOperationRuntimeRevision,
        getZodiacOperationRuntimeRevision,
    );
    const workspaceHasActiveOperation = hasZodiacActiveOperations(sessionKey);
    const workspaceTitle = safeCanvasWorkspaceTitle(canvasContext);
    const sessionRef = useRef<ZodiacSessionState<ZodicItem>>(createZodiacSession(sessionKey, workspaceTitle));
    if (sessionRef.current.workspaceId === sessionKey) sessionRef.current.workspaceTitle = workspaceTitle;
    const activeSessionKeyRef = useRef(sessionKey);
    activeSessionKeyRef.current = sessionKey;
    const ready = useMemo(() => {
        const model = config.textModel || config.model;
        return isAiConfigReady(config, model);
    }, [config]);
    const activeSkills = useMemo(
        () =>
            skills
                .filter((skill) => skill.enabled && skill.zodiacOnly)
                .sort((a, b) => a.priority - b.priority)
                .map((skill) => ({ id: skill.id, name: skill.name, version: skill.version, body: skill.body })),
        [skills],
    );

    useEffect(() => {
        observedOperationSnapshotsRef.current.clear();
        return subscribeZodiacOperationRuntime<ZodicItem>((event) => {
            const operation = event.operation;
            if (operation.workspaceId !== sessionKey) return;
            observedOperationSnapshotsRef.current.set(
                zodiacOperationRuntimeKey(operation.workspaceId, operation.sessionId, operation.operationId),
                operation,
            );
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
        setItems([]);
        void loadZodiacSession<ZodicItem>(sessionKey, workspaceTitle, { preserveAssistantProtocol: true })
            .then((saved) => {
                if (!active || sessionEpochRef.current !== loadEpoch) return;
                activateZodiacSessionState(saved);
                const interruptedToolRunIds = new Set(saved.items.filter((item) => item.tool?.status === "running").map((item) => item.tool?.runId).filter((id): id is string => Boolean(id)));
                const restoreSnapshot = canvasContext?.getSnapshot();
                const savedItems = trimZodiacSessionItems(saved.items);
                const restored = savedItems.flatMap((item, itemIndex) => {
                    const restoredOps = restoreZodiacOperationOps(item.tool?.ops, item.tool?.resolvedOps, restoreSnapshot?.nodes, restoreSnapshot?.connections);
                    const validStoredTool = Boolean(item.tool && restoredOps.valid);
                    const hasResolvedReceipt = restoredOps.hasResolvedReceipt;
                    const safeOps = restoredOps.ops;
                    const activeOperation = item.tool
                        ? getZodiacActiveOperation<ZodicItem>(saved.workspaceId, saved.id, item.tool.id)
                        : undefined;
                    const interrupted = item.tool?.status === "running" && activeOperation?.sessionId !== saved.id;
                    const unsafeStoredTool = Boolean(item.tool && (!validStoredTool || !safeOps.length));
                    const restoredDecision = normalizeStoredDecision(item.decision);
                    const restoredWorkOrder = item.tool
                        ? buildZodiacWorkOrder(safeOps, restoreSnapshot, item.tool.summary)
                        : undefined;
                    const restoredTool = item.tool
                        ? {
                            ...item.tool,
                            ops: safeOps,
                            ...(hasResolvedReceipt ? { resolvedOps: safeOps } : {}),
                            summary: !unsafeStoredTool ? summarizeZodiacProposalEffects(safeOps, restoreSnapshot) : "这个旧提案无法安全恢复，请重新描述需要的画布调整",
                            executionMode: item.tool.executionMode === "automatic" ? "automatic" as const : "guided" as const,
                            workOrder: restoredWorkOrder!,
                            ...(unsafeStoredTool ? { status: "rejected" as const, error: undefined } : interrupted ? { status: "failed" as const, error: "上次操作被中断，可以重新尝试。" } : {}),
                        }
                        : undefined;
                    const restoredItem: ZodicItem = {
                        ...item,
                        streamId: undefined,
                        attachments: undefined,
                        text: unsafeStoredTool
                            ? "这个旧提案没有继续执行。请重新描述你希望调整的内容。"
                            : interrupted
                                ? "上次操作被中断，可以重新尝试。"
                                : item.role === "assistant"
                                    ? stripZodiacReasoning(cleanAssistantProtocol(item.text))
                                    : item.text,
                        workProcess: item.role === "assistant"
                            ? item.workProcess || extractZodiacWorkProcess(item.text)
                            : item.workProcess,
                        detail: restoredTool ? { status: restoredTool.status, name: "canvas_apply_ops", error: restoredTool.error, ops: safeOps } : item.detail,
                        tool: restoredTool,
                        decision: restoredDecision,
                        run: item.run?.status === "running"
                            ? interruptedToolRunIds.has(item.id)
                                ? settleZodiacRun(item.run, "failed")
                                : interruptZodiacRun(item.run)
                            : item.run,
                    };
                    if (item.role !== "assistant" || item.tool || savedItems[itemIndex + 1]?.tool) return [restoredItem];
                    const legacyPayload = extractZodiacToolPayload(item.text);
                    if (legacyPayload) {
                        const request = previousZodiacUserRequest(savedItems, itemIndex);
                        const promotedTool = createTool(
                            legacyPayload.ops,
                            request,
                            legacyPayload.summary,
                            legacyPayload.executionMode,
                            restoreSnapshot,
                        );
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
                        return [{
                            ...restoredItem,
                            recovery: {
                                kind: "canvas" as const,
                                message: "上次画布步骤没有装载完成，画布没有变化。",
                                actionLabel: "重新装载",
                                retryPrompt: "保留之前已经确定的内容，只重新输出一份可以直接加入画布的完整操作。",
                            },
                        }];
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
    }, [sessionKey]);

    useEffect(() => {
        if (loadedSessionRef.current !== sessionKey) return;
        if (items.length > MAX_ZODIAC_SESSION_ITEMS) {
            const trimmed = trimZodiacSessionItems(items);
            itemsRef.current = trimmed;
            setItems(trimmed);
            return;
        }
        if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = window.setTimeout(() => {
            sessionSaveTimerRef.current = null;
            saveZodiacSessionInBackground(sessionStateWithItems(sessionRef.current, itemsRef.current));
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
            registerDesktopFlusher(async () => {
                if (loadedSessionRef.current !== sessionKey) return;
                if (sessionSaveTimerRef.current !== null) window.clearTimeout(sessionSaveTimerRef.current);
                sessionSaveTimerRef.current = null;
                const pendingStream = pendingStreamFlushRef.current;
                if (pendingStream?.sessionKey === sessionKey) pendingStream.flushForSave();
                await saveZodiacSessionState(sessionStateWithItems(sessionRef.current, itemsRef.current));
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

    const send = async (submittedText?: string, displayText?: string) => {
        const submittedDecision = typeof submittedText === "string";
        const text = (submittedDecision ? submittedText : prompt).trim();
        const turnAttachments = submittedDecision ? [] : attachments;
        const turnSkills = submittedDecision ? [] : attachedSkills;
        if ((!text && !turnAttachments.length && !turnSkills.length) || sending || controllerRef.current) return;
        if (!submittedDecision && itemsRef.current.some((item) => item.decision?.status === "pending")) {
            message.info("先完成当前选择，再继续下一步");
            return;
        }
        if (hasZodiacActiveOperations(sessionKey)) {
            message.info("先完成当前画布操作，再继续下一步");
            return;
        }
        if (!ready) {
            openConfigDialog(true, "channels");
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
        setItems((current) => [
            ...current,
            user,
            { id: runId, role: "tool", title: "执行进度", text: "", run: createZodiacRun(activeSkills.length) },
            { id: assistantId, role: "assistant", title: "Zodiac", text: "", streamId: assistantId },
        ]);
        if (!submittedDecision) {
            setPrompt("");
            setAttachments([]);
            setAttachedSkills([]);
        }
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
            const nextText = stripZodiacReasoning(cleanAssistantProtocol(rawStreamText));
            const nextWorkProcess = extractZodiacWorkProcess(rawStreamText);
            latestStreamText = "";
            const applyText = (current: ZodicItem[]) => current.map((item) => (item.id === assistantId
                ? { ...item, text: nextText, workProcess: nextWorkProcess || item.workProcess }
                : item));
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
        try {
            const requestItems = [...itemsRef.current, requestUser];
            const compaction = planZodiacContextCompaction(requestItems, sessionRef.current.summaryThroughId);
            if (compaction) {
                try {
                    const summary = await summarizeZodiacContext(config, sessionRef.current.summary, compaction.items, controller.signal);
                    if (!isCurrentRequest()) return;
                    sessionRef.current = {
                        ...sessionRef.current,
                        summary,
                        summaryThroughId: compaction.throughId,
                    };
                    saveZodiacSessionInBackground(sessionStateWithItems(sessionRef.current, requestItems));
                } catch (error) {
                    if ((error as Error).name === "AbortError") throw error;
                    console.warn("Zodiac context compaction failed; continuing with recent messages.", error);
                }
            }
            const messages = toRequestMessages(requestItems, snapshot, activeSkills, sessionRef.current);
            const reply = await requestZodicReply(config, messages, (delta) => {
                latestStreamText = delta;
                if (!planningStarted && isCurrentRequest()) {
                    planningStarted = true;
                    setItems((current) => updateRunItem(current, runId, markZodiacRunPlanning));
                }
                if (streamFlushTimer === null) streamFlushTimer = window.setTimeout(flushStream, STREAM_FLUSH_MS);
            }, { signal: controller.signal });
            if (streamFlushTimer !== null) window.clearTimeout(streamFlushTimer);
            latestStreamText = reply;
            flushStream();
            if (!isCurrentRequest()) return;
            const proposalContext = { request: text, canvasEmpty: !snapshot?.nodes.length, snapshot };
            let parsed = parseToolProposal(reply, proposalContext);
            let workProcess = extractZodiacWorkProcess(reply);
            if (parsed.recovery) {
                try {
                    const repairReply = await requestZodicReply(config, [
                        ...messages,
                        { role: "assistant", content: cleanAssistantProtocol(reply) || "这一步没有形成可执行结果。" },
                        { role: "user", content: repairPromptFor(parsed.recovery) },
                    ], () => undefined, { signal: controller.signal });
                    if (!isCurrentRequest()) return;
                    parsed = parseToolProposal(repairReply, proposalContext);
                    workProcess = mergeWorkProcess(workProcess, extractZodiacWorkProcess(repairReply));
                } catch (repairError) {
                    if ((repairError as Error).name === "AbortError") throw repairError;
                    console.warn("Zodiac response repair failed; showing a safe recovery action.", repairError);
                }
            }
            setItems((current) => {
                const completed = updateRunItem(
                    current.map((item) => (item.id === assistantId ? {
                        ...item,
                        text: parsed.text,
                        workProcess: workProcess || item.workProcess,
                        decision: parsed.decision ? { ...parsed.decision, runId } : undefined,
                        recovery: parsed.recovery,
                        streamId: undefined,
                    } : item)),
                    runId,
                    (run) => finishZodiacRun(run, Boolean(parsed.tool || parsed.decision)),
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
                setItems((current) => updateRunItem(
                    current.map((item) => (item.id === assistantId ? { ...item, text: item.text || "已停止。", streamId: undefined } : item)),
                    runId,
                    (run) => interruptZodiacRun(run),
                ));
            } else {
                setItems((current) => updateRunItem(
                    current.map((item) => (item.id === assistantId ? { ...item, role: "error", title: "Zodiac", text: error instanceof Error ? error.message : "请求失败", streamId: undefined } : item)),
                    runId,
                    (run) => interruptZodiacRun(run, true),
                ));
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
        if (!ready) {
            openConfigDialog(true, "channels");
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
            if (!selectedIds.length || selectedIds.some((nodeId) => {
                const node = liveNodes.find((candidate) => candidate.id === nodeId);
                return !node || !getCanvasResourceKind(node);
            })) {
                message.warning("所选资产已不在当前画布，请重新选择");
                return;
            }
        }
        setItems((current) => {
            const next = current.map((item) => item.id === itemId && item.decision
                ? { ...item, decision: { ...item.decision, status: "answered" as const, answerLabel: answerLabel.slice(0, 160) } }
                : item);
            itemsRef.current = next;
            return next;
        });
        void send(answerText);
    };

    const resolveTool = useCallback(async (id: string, decision: "apply" | "reject") => {
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
                updateOperationItems((current) => updateRunItem(
                    current.map((item) => item.id === id && item.tool
                        ? {
                            ...item,
                            text: "正在把方案加入画布…",
                            detail: { status: "running", name: "canvas_apply_ops", ops: item.tool.ops },
                            tool: { ...item.tool, status: "running", error: undefined },
                        }
                        : item),
                    target.runId || "",
                    markZodiacRunApplying,
                ));
                try {
                    let committedWorkOrder = target.workOrder;
                    const appliedSnapshot = await canvasContext.applyOps(
                        target.resolvedOps || target.ops,
                        target.id,
                        target.executionMode,
                        {
                            resumeExistingStructure: Boolean(target.resolvedOps?.length),
                            onStructureCommitted: async (resolvedOps) => {
                                committedWorkOrder = buildZodiacWorkOrder(resolvedOps, canvasContext.getSnapshot(), target.summary);
                                updateOperationItems((current) => current.map((item) => item.id === id && item.tool
                                    ? {
                                        ...item,
                                        detail: { status: "running", name: "canvas_apply_ops", ops: resolvedOps },
                                        tool: { ...item.tool, resolvedOps, workOrder: committedWorkOrder },
                                    }
                                    : item));
                                await persistOperationSession();
                            },
                        },
                    );
                    assertZodiacWorkOrderApplied(committedWorkOrder, appliedSnapshot);
                } catch (error) {
                    const errorText = "这一步还没完成，可以重新尝试。画布中已有内容不会重复添加。";
                    updateOperationItems((current) => updateRunItem(
                        current.map((item) => item.id === id && item.tool
                            ? {
                                ...item,
                                text: errorText,
                                detail: { status: "failed", name: "canvas_apply_ops", error: error instanceof Error ? error.message : String(error), ops: item.tool.resolvedOps || item.tool.ops },
                                tool: { ...item.tool, status: "failed", error: errorText },
                            }
                            : item),
                        target.runId || "",
                        (run) => settleZodiacRun(run, "failed"),
                    ));
                    await persistOperationSession().catch((saveError) => console.error("Failed to persist a failed Zodiac operation.", saveError));
                    if (isCurrentSession()) message.error("这一步还没完成，可以重新尝试");
                    return;
                }
                updateOperationItems((current) => updateRunItem(
                    current.map((item) => item.id === id && item.tool
                        ? {
                            ...item,
                            text: `已加入画布：${item.tool.summary}`,
                            detail: { status: "completed", name: "canvas_apply_ops", ops: item.tool.resolvedOps || item.tool.ops },
                            tool: { ...item.tool, status: "applied", error: undefined },
                        }
                        : item),
                    target.runId || "",
                    (run) => settleZodiacRun(run, "applied"),
                ));
                await persistOperationSession().catch((error) => console.error("Failed to persist a settled Zodiac operation.", error));
            } finally {
                removeZodiacActiveOperation(operation);
            }
            return;
        }
        updateOperationItems((current) => updateRunItem(
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
        ));
        await persistOperationSession().catch((error) => console.error("Failed to persist a settled Zodiac operation.", error));
    }, [canvasContext, message, sessionKey]);

    const createSkillDraft = useCallback((tool: ZodicTool) => {
        const latestRequest = [...itemsRef.current].reverse().find((item) => item.role === "user")?.text || tool.summary;
        setSkillDraft(skillDraftFromTool(tool, latestRequest));
    }, []);

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

    const applyingProposal = workspaceHasActiveOperation || items.some((item) => item.tool?.status === "running");
    const pendingDecision = items.some((item) => item.decision?.status === "pending");
    const visibleItems = items.filter((item) => {
        if (item.run) return shouldShowZodiacRun(item.run);
        if (item.role === "assistant" && !item.text.trim() && !(showReasoning && item.workProcess?.trim()) && !item.decision && !item.tool && !item.recovery) return false;
        return true;
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: theme.node.stroke }}>
                {!ready ? (
                    <div className="flex min-w-0 items-center gap-2 text-xs font-medium" style={{ color: theme.node.muted }}>
                        <SparklesIcon className="size-3.5 text-[color:var(--wg-home-accent)]" strokeWidth={1.8} />
                        <span>需要配置模型</span>
                    </div>
                ) : <span />}
                <div className="flex items-center gap-1">
                    <Popconfirm
                        title="开始新会话？"
                        description="当前对话会进入会话记录，画布内容不受影响。"
                        okText="归档并新建"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void deleteCurrentSession()}
                    >
                        <Button type="text" size="small" disabled={applyingProposal || (!items.length && !sending)} icon={<Delete02Icon className="size-3.5" />}>新会话</Button>
                    </Popconfirm>
                    <Button type="text" size="small" icon={<Settings01Icon className="size-3.5" />} onClick={() => openConfigDialog(false, "channels")}>模型</Button>
                </div>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5">
                {!items.length ? (
                    <div className="mx-auto flex h-full max-w-[290px] flex-col items-center justify-center pb-12 text-center">
                        <ZodiacAvatar className="size-14" />
                        <h2 className="wg-sketch-title mt-5 text-[20px] font-semibold" style={{ color: theme.node.text }}>从一个目标开始</h2>
                        <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>描述你想搭建、调整或生成的内容。我会先给出可确认的画布提案。</p>
                        {!ready ? <Button className="mt-5" type="primary" onClick={() => openConfigDialog(false, "channels")}>配置模型</Button> : null}
                    </div>
                ) : (
                    <div className="space-y-5">
                        {visibleItems.map((item) => <ZodicConversationItem key={item.id} item={item} theme={theme} showReasoning={showReasoning} confirmTools={confirmTools} decisionDisabled={sending || applyingProposal} onResolve={resolveTool} onDecisionSubmit={submitDecision} onRecovery={(retryPrompt, actionLabel) => void send(retryPrompt, actionLabel)} onCreateSkill={createSkillDraft} />)}
                    </div>
                )}
            </div>
            {activeWorkflowRunId ? (
                <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                    <ZodiacWorkflowLedger
                        runId={activeWorkflowRunId}
                        onInspectResult={canvasContext?.inspectWorkflowResult}
                        onContinue={canvasContext?.continueWorkflow}
                        onRetry={canvasContext?.retryWorkflow}
                        onStop={canvasContext?.stopWorkflow}
                        onResume={canvasContext?.resumeWorkflow}
                        onActionError={(error) => message.error(error instanceof Error ? error.message : "运行操作失败")}
                    />
                </div>
            ) : null}
            <AgentChatComposer
                prompt={prompt}
                attachments={attachments}
                disabled={!ready || applyingProposal || pendingDecision}
                sending={sending}
                placeholder={!ready ? "先配置一个文本模型…" : applyingProposal ? "正在完成当前画布操作…" : pendingDecision ? "先完成上方选择…" : "描述工作流，或询问当前画布…"}
                theme={theme}
                onPromptChange={setPrompt}
                onSubmit={send}
                onStop={() => controllerRef.current?.abort()}
                onAddFiles={addFiles}
                onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
                skillChips={attachedSkills.map(({ id, name }) => ({ id, name }))}
                onRemoveSkill={(id) => setAttachedSkills((current) => current.filter((item) => item.id !== id))}
                left={
                    <>
                        <Tooltip title="加载 Zodiac 技能">
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-9 !w-9 !min-w-9"
                                style={{ color: theme.node.muted }}
                                icon={<SparklesIcon className="size-4" strokeWidth={1.8} />}
                                onClick={() => setSkillPickerOpen(true)}
                            />
                        </Tooltip>
                        {canvasContext ? undefined : <span className="text-[11px]" style={{ color: theme.node.muted }}>打开画布后可直接编排</span>}
                    </>
                }
            />
            <Drawer
                open={skillPickerOpen}
                width={420}
                title="Zodiac 技能"
                onClose={() => setSkillPickerOpen(false)}
                styles={{ body: { paddingTop: 16 } }}
            >
                <p className="mb-3 text-[11px] leading-5" style={{ color: theme.node.muted }}>
                    点击技能即可附加到当前对话，随消息一起交给 Zodiac 使用。
                </p>
                <div className="space-y-2">
                    {skills.some((skill) => skill.zodiacOnly) ? (
                        skills
                            .filter((skill) => skill.zodiacOnly)
                            .slice()
                            .sort((a, b) => a.priority - b.priority)
                            .map((skill) => (
                                <details key={skill.id} className="rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                                    <summary className="flex cursor-pointer list-none items-center gap-2 outline-none focus-visible:underline">
                                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: theme.node.text }}>
                                            {skill.name}
                                        </span>
                                        <Tag className="!m-0 shrink-0" color="purple">Zodiac 专属</Tag>
                                    </summary>
                                    <p className="mt-1.5 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                                        {skill.description}
                                    </p>
                                    <pre className="thin-scrollbar mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg px-2 py-1.5 font-sans text-[11px] leading-5" style={{ background: theme.node.fill, color: theme.node.text }}>
                                        {skill.body}
                                    </pre>
                                    <div className="mt-2 flex justify-end">
                                        {attachedSkills.some((item) => item.id === skill.id) ? (
                                            <Button size="small" onClick={() => setAttachedSkills((current) => current.filter((item) => item.id !== skill.id))}>
                                                已在聊天框，点击移除
                                            </Button>
                                        ) : (
                                            <Button
                                                size="small"
                                                type="primary"
                                                icon={<SparklesIcon className="size-3.5" />}
                                                onClick={() => {
                                                    setAttachedSkills((current) => current.some((item) => item.id === skill.id)
                                                        ? current
                                                        : [...current, { id: skill.id, name: skill.name, body: skill.body }]);
                                                    setSkillPickerOpen(false);
                                                    message.success(`已附加「${skill.name}」`);
                                                }}
                                            >
                                                附加到对话
                                            </Button>
                                        )}
                                    </div>
                                </details>
                            ))
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有 Zodiac 专属技能" />
                    )}
                </div>
                <p className="mt-4 text-[11px] leading-5" style={{ color: theme.node.muted }}>
                    Zodiac 专属技能只在对话中附加使用；终端可用的技能请在画布终端节点的设置里启用。
                </p>
            </Drawer>
            <PersonalSkillEditorModal
                skill={skillDraft}
                onClose={() => setSkillDraft(null)}
                onSave={(skill) => {
                    saveSkill(skill);
                    setSkillDraft(null);
                    message.success("已保存到我的 Skills");
                }}
            />
        </div>
    );
}

const ZodicConversationItem = memo(function ZodicConversationItem({ item, theme, showReasoning, confirmTools, decisionDisabled, onResolve, onDecisionSubmit, onRecovery, onCreateSkill }: { item: ZodicItem; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; showReasoning: boolean; confirmTools: boolean; decisionDisabled: boolean; onResolve: (id: string, decision: "apply" | "reject") => void; onDecisionSubmit: (id: string, answerText: string, answerLabel: string) => void; onRecovery: (retryPrompt: string, actionLabel: string) => void; onCreateSkill: (tool: ZodicTool) => void }) {
    if (item.run) return <ZodiacRunCard run={item.run} theme={theme} />;
    if (item.recovery) {
        return (
            <div className="space-y-2">
                {showReasoning ? <ZodiacWorkProcess text={item.workProcess} theme={theme} /> : null}
                <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                    <span className="min-w-0 text-xs leading-5" style={{ color: theme.node.text }}>{item.recovery.message}</span>
                    <Button size="small" disabled={decisionDisabled} onClick={() => onRecovery(item.recovery!.retryPrompt, item.recovery!.actionLabel)}>{item.recovery.actionLabel}</Button>
                </div>
            </div>
        );
    }
    if (item.decision) {
        const visibleText = stripZodiacReasoning(cleanAssistantProtocol(item.text));
        return (
            <div className="space-y-2">
                {showReasoning ? <ZodiacWorkProcess text={item.workProcess} theme={theme} /> : null}
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
        return <div><AgentPendingToolCard state="running" summary={item.tool.summary} summaryMeta={executionModeLabel(item.tool.executionMode)} detail={item.detail} theme={theme} /><ZodiacWorkOrderDetail order={item.tool.workOrder} theme={theme} /></div>;
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
                {confirmTools || destructive
                    ? <AgentPendingToolCard title={destructive ? "确认删除这些内容？" : "把这套方案加入画布？"} summary={item.tool.summary} summaryMeta={executionModeLabel(item.tool.executionMode)} detail={item.detail} theme={theme} approveText={destructive ? "确认删除" : "加入画布"} rejectText="继续调整" danger={destructive} confirmationText={destructive ? "这会删除画布中的节点或连线，删除后无法在此处撤销。" : undefined} onApprove={() => onResolve(item.id, "apply")} onReject={() => onResolve(item.id, "reject")} />
                    : <AutoApplyTool item={item} onApply={() => onResolve(item.id, "apply")} />}
                <ZodiacWorkOrderDetail order={item.tool.workOrder} theme={theme} />
            </div>
        );
    }
    const cleanedText = item.role === "assistant" ? stripZodiacReasoning(cleanAssistantProtocol(item.text)) : item.text;
    const visibleText = cleanedText || (item.tool?.status === "applied" ? item.tool.summary : "");
    const visibleItem = { ...item, text: visibleText };
    return (
        <div className="space-y-2">
            {showReasoning ? <ZodiacWorkProcess text={item.workProcess} theme={theme} /> : null}
            {visibleText ? <AgentChatMessage item={visibleItem} theme={theme} user={null} /> : null}
            {item.skills?.length ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                    {item.skills.map((skill) => (
                        <span
                            key={skill.id}
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                            style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}
                        >
                            <SparklesIcon className="size-3" />
                            {skill.name}
                        </span>
                    ))}
                </div>
            ) : null}
            {item.tool ? <ZodiacWorkOrderDetail order={item.tool.workOrder} theme={theme} /> : null}
            {item.tool?.status === "applied" ? (
                <div className="flex justify-end">
                    <Button size="small" icon={<SparklesIcon className="size-3.5" />} onClick={() => onCreateSkill(item.tool!)}>整理成 Skill</Button>
                </div>
            ) : null}
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
        title: session.title === "新会话"
            ? durable.find((item) => item.role === "user" && item.text.trim())?.text.trim().replace(/\s+/g, " ").slice(0, 48) || session.title
            : session.title,
        items: durable,
    };
}

function saveZodiacSessionInBackground(session: ZodiacSessionState<ZodicItem>) {
    void saveZodiacSessionState(session).catch((error) => {
        console.error("Failed to save the Zodiac session.", error);
    });
}

function ZodiacRunCard({ run, theme }: { run: ZodiacRun; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (run.status !== "running") {
        const status = run.status === "waiting"
            ? { label: "方案已准备，等你决定", color: "#d97706" }
            : run.status === "completed"
                ? { label: run.phases.find((phase) => phase.id === "confirm")?.label || "方案已完成", color: "#16a34a" }
                : run.status === "error"
                    ? { label: "这套方案还没完成", color: "#dc2626" }
                    : { label: "已停止，可以继续调整", color: theme.node.muted };
        return (
            <div className="flex min-h-9 items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: status.color }} aria-live="polite">
                <span className="size-2 shrink-0 rounded-full" style={{ background: status.color }} aria-hidden />
                <span>{status.label}</span>
            </div>
        );
    }
    const activePhase = run.phases.find((phase) => phase.status === "active") || run.phases.at(-1);
    return (
        <div className="flex min-h-9 items-center gap-2 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }} aria-live="polite">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-[color:var(--wg-home-accent)]" aria-hidden />
            <span>{activePhase?.label || "正在组织方案"}</span>
        </div>
    );
}

function AutoApplyTool({ item, onApply }: { item: ZodicItem; onApply: () => void }) {
    return <div className="wg-sketch-panel flex items-center justify-between gap-3 bg-[color:var(--wg-home-raised)] px-3 py-2.5 text-sm"><span className="min-w-0 truncate">{item.tool?.summary}<span className="ml-2 text-[11px] opacity-60">· {executionModeLabel(item.tool?.executionMode)}</span></span><Button size="small" type="primary" icon={<CheckmarkCircle02Icon className="size-3.5" />} onClick={onApply}>加入画布</Button></div>;
}

function ZodiacWorkProcess({ text, theme }: { text?: string; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (!text?.trim()) return null;
    return (
        <details open className="ml-11 rounded-xl border px-3 py-2.5 text-left" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <summary className="cursor-pointer text-xs font-medium" style={{ color: theme.node.text }}>工作过程</summary>
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
    return items.map((item) => item.id === runId && item.run ? { ...item, run: update(item.run) } : item);
}

function skillDraftFromTool(tool: ZodicTool, request: string) {
    const name = tool.summary.replace(/[，。；;]+$/u, "").slice(0, 32) || "画布工作流";
    const steps = tool.ops.map(skillStepFromOp).filter((step): step is string => Boolean(step));
    const numberedSteps = steps.length ? steps.map((step, index) => `${index + 1}. ${step}`).join("\n") : "1. 根据目标组织画布步骤。\n2. 检查输入、输出与最终产物。";
    return createPersonalSkill({
        name,
        description: request.slice(0, 96),
        capabilities: capabilitiesFromOps(tool.ops),
        tags: ["Zodiac", "工作流"],
        body: `# ${name}

## 适用场景

${request}

## 工作步骤

${numberedSteps}

## 完成标准

- 每个步骤都有清楚的输入和输出。
- 预设产物沿已有连线向下传递，不产生重复结果。
- 最终产物保留在画布中，并可继续编辑。`,
    });
}

function skillStepFromOp(op: CanvasAgentOp) {
    if (op.type === "add_node") return `创建「${op.title || canvasNodeLabel(op.nodeType)}」`;
    if (op.type === "update_node") return `调整「${op.patch?.title || "现有节点"}」`;
    if (op.type === "connect_nodes") return "连接前后步骤并传递产物";
    if (op.type === "run_generation") return `运行${generationModeLabel(op.mode)}生成`;
    if (op.type === "delete_node") return "移除不再需要的步骤";
    if (op.type === "delete_connections") return "移除不再需要的数据连接";
    if (op.type === "select_nodes") return "聚焦需要继续处理的节点";
    if (op.type === "set_viewport") return null;
    return null;
}

function capabilitiesFromOps(ops: CanvasAgentOp[]): InstalledSkill["capabilities"] {
    const capabilities = new Set<InstalledSkill["capabilities"][number]>(["workflow"]);
    ops.forEach((op) => {
        if ((op.type === "add_node" && op.nodeType === CanvasNodeType.Terminal) || (op.type === "update_node" && op.patch?.type === CanvasNodeType.Terminal)) capabilities.add("terminal");
        const mode = op.type === "run_generation" ? op.mode : op.type === "add_node" ? op.metadata?.generationMode : undefined;
        if (mode === "image" || mode === "video" || mode === "audio") capabilities.add(mode);
        if (mode === "text") capabilities.add("writing");
    });
    return [...capabilities];
}

function canvasNodeLabel(nodeType?: string) {
    if (nodeType === CanvasNodeType.Terminal) return "终端步骤";
    if (nodeType === CanvasNodeType.Config) return "生成步骤";
    if (nodeType === CanvasNodeType.Image) return "图片";
    if (nodeType === CanvasNodeType.Video) return "视频";
    if (nodeType === CanvasNodeType.Audio) return "音频";
    return "文本步骤";
}

function generationModeLabel(mode?: CanvasGenerationMode) {
    if (mode === "image") return "图片";
    if (mode === "video") return "视频";
    if (mode === "audio") return "音频";
    return "文本";
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

function toRequestMessages(
    items: ZodicItem[],
    snapshot?: ZodiacCanvasSnapshot,
    activeSkills: Parameters<typeof composeZodiacSystemPrompt>[1] = [],
    session?: Pick<ZodiacSessionState<ZodicItem>, "summary" | "summaryThroughId">,
): ZodicMessage[] {
    const unsummarized = zodiacConversationAfterSummary(items, session?.summaryThroughId);
    const latestUser = [...unsummarized].reverse().find((item) => item.role === "user");
    const attachedSkills = latestUser?.skills || [];
    const mergedSkills = [...activeSkills];
    attachedSkills.forEach((skill) => {
        if (!mergedSkills.some((item) => item.id === skill.id)) mergedSkills.push(skill);
    });
    const system: ZodicMessage = {
        role: "system",
        content: [
            composeZodiacSystemPrompt(snapshot, mergedSkills),
            session?.summary ? `# 此前对话摘要\n\n${session.summary}` : "",
        ].filter(Boolean).join("\n\n---\n\n"),
    };
    return [system, ...recentZodiacConversationItems(unsummarized).map((item) => ({
        role: item.role === "assistant" ? "assistant" as const : "user" as const,
        content: item.role === "user" && item.attachments?.length
            ? [{ type: "text" as const, text: withAttachedSkillNote(item.text, item.skills) }, ...item.attachments.map((attachment) => ({ type: "image_url" as const, image_url: { url: (attachment as ZodicAttachment).dataUrl || attachment.url } }))]
            : item.role === "assistant"
                ? cleanAssistantProtocol(item.text)
                : withAttachedSkillNote(item.text, item.skills),
    }))];
}

function withAttachedSkillNote(text: string, skills?: ZodiacSkillAttachment[]) {
    if (!skills?.length) return text;
    const note = `本轮附加技能：${skills.map((skill) => `「${skill.name}」`).join("、")}。`;
    return text.trim() ? `${text}\n\n${note}` : note;
}

async function summarizeZodiacContext(
    config: Parameters<typeof requestZodicReply>[0],
    previousSummary: string,
    items: ZodicItem[],
    signal: AbortSignal,
) {
    const transcript = items
        .map((item) => `${item.role === "assistant" ? "Zodiac" : "用户"}：${withoutReasoning(item.role === "assistant" ? cleanAssistantProtocol(item.text) : item.text).slice(0, 8_000)}`)
        .join("\n\n")
        .slice(0, 96_000);
    const messages: ZodicMessage[] = [
        {
            role: "system",
            content: "你负责压缩一段长期创作会话。只输出可供后续继续工作的中文摘要，保留用户目标、偏好、已确认决策、工作流结构、节点或资产名称、未完成事项与重要约束。删除寒暄、重复内容和中间推理，不要输出操作协议或代码块。",
        },
        {
            role: "user",
            content: `${previousSummary ? `已有摘要：\n${previousSummary.slice(0, 16_000)}\n\n` : ""}需要并入摘要的新对话：\n${transcript}`,
        },
    ];
    const summary = await requestZodicReply(config, messages, () => undefined, { signal });
    return withoutReasoning(summary).trim().slice(0, 16_000);
}

type ToolProposalContext = { request: string; canvasEmpty: boolean; snapshot?: CanvasAgentSnapshot };

function parseToolProposal(reply: string, context: ToolProposalContext): { text: string; tool?: ZodicTool; decision?: ZodicDecision; recovery?: ZodicRecovery } {
    const decisionPayload = extractZodiacDecisionPayload(reply);
    const parsed = extractZodiacToolPayload(reply);
    const hasDecisionProtocol = hasExplicitZodiacDecisionProtocol(reply);
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
                    retryPrompt: continuation
                        ? "请先读取当前画布，只生成现有工作流尚缺失的下一段；不得重复已有节点、结果槽和连线。若流程已经完整，直接说明可以运行。"
                        : "请根据刚才的目标重新整理成一套可以直接加入画布的步骤。",
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
    if (claimsUnexecutedCanvasAction(visibleReply)) {
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

function repairPromptFor(recovery: ZodicRecovery) {
    return recovery.kind === "canvas"
        ? `${recovery.retryPrompt} 不要道歉、复述或声称已经完成。`
        : `${recovery.retryPrompt} 只输出当前这一层的一个选择。`;
}

function createTool(ops: CanvasAgentOp[], request: string, summary?: string, proposedExecutionMode?: unknown, snapshot?: CanvasAgentSnapshot): ZodicTool | undefined {
    const proposal = prepareZodiacExecutableToolProposal(ops, request, proposedExecutionMode, snapshot?.nodes, snapshot?.connections);
    const reconciledOps = reconcileZodiacContinuationOps(proposal.ops, request, snapshot?.nodes, snapshot?.connections);
    if (!reconciledOps.length) return undefined;
    const proposalChanged = reconciledOps.length !== proposal.ops.length;
    const resolvedSummary = summarizeZodiacProposalEffects(reconciledOps, snapshot, proposalChanged ? undefined : summary);
    const workOrder = buildZodiacWorkOrder(reconciledOps, snapshot, resolvedSummary);
    if (workOrder.issues.length) return undefined;
    return {
        id: crypto.randomUUID(),
        summary: resolvedSummary,
        ops: reconciledOps,
        workOrder,
        executionMode: proposal.executionMode,
        status: "pending",
    };
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
        const knownTitles = Array.from(deletedIds).map((id) => nodeById.get(id)?.title).filter((title): title is string => Boolean(title));
        parts.push(knownTitles.length === deletedIds.size && knownTitles.length <= 3
            ? `删除${knownTitles.map((title) => `「${title}」`).join("、")}`
            : `删除 ${deletedIds.size} 个节点`);
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
    const intent = providerSummary?.replace(/[\u0000-\u001f]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 72);
    return intent ? `${effectSummary}。${intent}` : effectSummary;
}

function canvasNodeTypeLabel(type: string) {
    if (type === "text") return "文本";
    if (type === "config") return "生成";
    if (type === "image") return "图片";
    if (type === "video") return "视频";
    if (type === "audio") return "音频";
    if (type === "terminal") return "终端";
    if (type === "group") return "分组";
    return "目标";
}

function recoverWorkflowProposal(reply: string, context: ToolProposalContext): ZodicTool | undefined {
    if (!isCanvasBuildRequest(context.request)) return undefined;

    const steps = workflowStepsFrom(reply);
    const terminalRequest = isTerminalNodeRequest(context.request);
    const claimsCanvasWasBuilt = /(?:已|已经|已为你).{0,12}(?:搭好|创建|建立|完成|编排)|(?:工作流|画布).{0,12}(?:如下|包含|完成|搭好)/u.test(reply);
    if (steps.length < 2 && !terminalRequest && !(context.canvasEmpty && claimsCanvasWasBuilt)) return undefined;

    const resolvedSteps = steps.length >= 2 ? steps : terminalRequest ? ["终端 Agent"] : ["需求与提示词", "处理与生成", "输出结果"];
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
            metadata: nodeType === CanvasNodeType.Text
                ? { content: prompt, prompt }
                : nodeType === CanvasNodeType.Config
                    ? { composerContent: prompt, prompt, generationMode }
                    : nodeType === CanvasNodeType.Terminal
                        ? { prompt, terminalInputMode: "auto", terminalOutputMode: generationMode, terminalConfigured: false }
                        : { prompt },
        };
    });
    ids.slice(1).forEach((id, index) => ops.push({ type: "connect_nodes", fromNodeId: ids[index], toNodeId: id }));
    return createTool(ops, context.request, `已识别 ${resolvedSteps.length} 个工作流步骤`, undefined, context.snapshot);
}

function isCanvasBuildRequest(request: string) {
    return /(?:画布|工作流|节点|流程).{0,16}(?:创建|搭建|生成|添加|修改|删除|连接|编排)|(?:创建|搭建|生成|添加|修改|删除|连接|编排).{0,16}(?:画布|工作流|节点|流程)|(?:帮我|帮忙).{0,20}(?:做|建).{0,12}(?:流程|画布|工作流)/u.test(request) || isTerminalNodeRequest(request);
}

function isTerminalNodeRequest(request: string) {
    return /(?:创建|新建|添加|搭建|编排|连接|调整|修改).{0,20}(?:终端|terminal|CLI|Codex|Claude Code|命令行)(?:节点|Agent|工具)?|(?:终端|terminal|CLI|Codex|Claude Code|命令行)(?:节点|Agent|工具)?.{0,20}(?:创建|新建|添加|搭建|编排|连接|调整|修改)/iu.test(request);
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
    if (/(?:终端|CLI|Codex|Claude Code|命令行)/iu.test(step)) return CanvasNodeType.Terminal;
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

function mergeWorkProcess(left: string, right: string) {
    if (!left) return right;
    if (!right || left === right) return left;
    return `${left}\n\n${right}`.slice(0, 48_000);
}

function cleanAssistantProtocol(text: string) {
    return stripZodiacDecisionPayload(stripZodiacToolPayload(text));
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
    if (node.metadata?.role === "result-slot") return true;
    return node.type === CanvasNodeType.Terminal && ["text", "image", "video", "audio"].includes(String(node.metadata?.terminalOutputMode || ""));
}

function safeCanvasWorkspaceTitle(canvasContext: ReturnType<typeof useAgentStore.getState>["canvasContext"]) {
    try {
        return canvasContext?.getSnapshot().title || "工作区";
    } catch {
        return "工作区";
    }
}
