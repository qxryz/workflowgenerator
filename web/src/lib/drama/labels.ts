import type { ArtifactKind, DramaSourceType, EntityKind, LedgerKind, RelationKind, ReviewCriterion, RunStage, RunStatus, ShotTransition } from "./types";

export const SOURCE_TYPE_LABELS: Record<DramaSourceType, string> = { original: "原创", novel: "小说改编", script: "已有剧本" };

export const ENTITY_KIND_LABELS: Record<EntityKind, string> = { character: "人物", scene: "场景", prop: "道具", world: "世界观" };
/** Catalogue headings; props are shown as equipment under characters and furnishings under scenes. */
export const ENTITY_GROUP_LABELS: Record<EntityKind, string> = { character: "人物", scene: "场景", prop: "道具陈设", world: "世界观" };

export const RELATION_KIND_LABELS: Record<RelationKind, string> = { family: "亲属", ally: "同盟", mentor: "师徒", enemy: "敌对", love: "情感", belong: "隶属", rival: "竞争", other: "其他" };

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = { character: "人物", place: "地点", item: "物件", world: "世界观", thread: "伏笔线索" };

export const TRANSITION_LABELS: Record<ShotTransition, string> = { continuous: "连续", cut: "切镜", time_jump: "跳时" };

export const RUN_STAGE_LABELS: Record<RunStage, string> = { chapter: "章节", settings: "设定", episodes: "分集", script: "剧本", shots: "分镜", review: "复核" };

export const RUN_STATUS_LABELS: Record<RunStatus, string> = { running: "运行中", review: "待你确认", accepted: "已采用", rejected: "已放弃", failed: "失败", stopped: "已停止" };

/** A review is a report that is finished on arrival, so for it "accepted" reads as done rather than adopted. */
export const runStatusLabel = (status: RunStatus, stage?: RunStage): string => (stage === "review" && status === "accepted" ? "已完成" : RUN_STATUS_LABELS[status]);

export const REVIEW_CRITERION_LABELS: Record<ReviewCriterion, string> = { consistency: "设定一致", character: "人设", plot: "情节连贯", ai_tone: "AI 腔", style: "文风", foreshadowing: "伏笔", pacing: "节奏" };
export const REVIEW_VERDICT_LABELS = { pass: "通过", issue: "有问题", unknown: "无法判断" } as const;

export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = { sheet: "设定图", image: "分镜图", video: "视频", audio: "配音" };
export type MediaState = "none" | "pending" | "ready" | "adopted" | "stale" | "failed";
export const MEDIA_STATE_LABELS: Record<MediaState, string> = { none: "未生成", pending: "生成中", ready: "可采用", adopted: "已采用", stale: "过期", failed: "失败" };

/** `term` is what goes into prompts when the prompt language is English. */
export type Term = { name: string; term: string };

export const SHOT_SIZES: readonly Term[] = [
    { name: "大远景", term: "extreme wide shot" },
    { name: "远景", term: "wide shot" },
    { name: "全景", term: "full shot" },
    { name: "中景", term: "medium shot" },
    { name: "中近景", term: "medium close-up" },
    { name: "近景", term: "close-up" },
    { name: "特写", term: "tight close-up" },
    { name: "大特写", term: "extreme close-up" },
    { name: "过肩", term: "over-the-shoulder shot" },
];

export const CAMERA_MOVES: readonly Term[] = [
    { name: "固定", term: "static locked-off camera" },
    { name: "推镜", term: "slow dolly in" },
    { name: "拉镜", term: "slow dolly out" },
    { name: "左摇", term: "pan left" },
    { name: "右摇", term: "pan right" },
    { name: "上摇", term: "tilt up" },
    { name: "下摇", term: "tilt down" },
    { name: "左移", term: "truck left" },
    { name: "右移", term: "truck right" },
    { name: "升镜", term: "crane up" },
    { name: "降镜", term: "crane down" },
    { name: "跟拍", term: "tracking shot following the subject" },
    { name: "环绕", term: "orbit around the subject" },
    { name: "手持", term: "handheld camera" },
    { name: "甩镜", term: "whip pan" },
    { name: "变焦推近", term: "zoom in" },
    { name: "变焦拉远", term: "zoom out" },
    { name: "滑动变焦", term: "dolly zoom" },
    { name: "俯拍", term: "high-angle shot" },
    { name: "仰拍", term: "low-angle shot" },
    { name: "航拍", term: "aerial drone shot" },
    { name: "主观视角", term: "first-person POV" },
    { name: "荷兰角", term: "dutch angle" },
];

/** Known names translate for English prompts; free text the user typed passes through. */
export function promptTerm(list: readonly Term[], value: string, english: boolean): string {
    const text = value.trim();
    const hit = list.find((item) => item.name === text);
    return english && hit ? hit.term : text;
}
