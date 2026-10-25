import type { DialogueLine, ShotProposalItem, ShotsProposal, ShotTransition } from "../types.ts";
import { asArray, asObject, bool, extractJson, num, str, strings } from "./json.ts";
import { clip, entityText, episodeLine, projectText, requireEpisode, section, sections, taskSection, type Prompt, type StageInput } from "./context.ts";

const SYSTEM = `你是短剧分镜导演，把一集剧本拆成镜头表。每个镜头之后会单独生成一张画面和一段视频，所以每个镜头必须自成一体、前后状态衔接。

镜头规则：
- seconds 为 4–15 的整数，所有镜头秒数之和接近本集 targetSeconds（偏差不超过 10%）。
- size（景别）用：大远景/远景/全景/中景/近景/特写/大特写；camera（运镜）用：固定/推/拉/摇/移/跟/升降/手持/环绕 等简短词。相邻两镜运镜不要相同，同一景别不要连续出现 3 次，有强调需要时才用特写。
- description：这一镜画面里发生什么，一两句。
- entities：本镜出场的设定，用上下文里的短标签（E3）：必须包含场景、出场人物和画面里出现的重要道具。对白说话人必须在其中。
- dialogue 逐句取自剧本，speaker 填人物短标签（旁白或画外音留空字符串）；narration 是本镜旁白。没有就写 [] 和 ""。

连续性（每个字段都必须填，镜头表的准确度取决于它）：
- transition：continuous 动作与上一镜首尾相接、cut 切镜、time_jump 时间跳转。第 1 镜不能是 continuous。
- startState：开拍那一刻的画面状态——人物站位、朝向、姿态、手里拿着什么、门窗灯光状态。endState：本镜结束那一刻的同类状态。continuous 镜头的 startState 必须等于上一镜的 endState。
- props：本镜出现的每一件道具逐项写：entity（短标签）、quantity（数量）、startVisible/endVisible（开始/结束时是否在画面内可见）、startHolder/endHolder（开始/结束时由哪个人物持有，填人物短标签，无人持有填 ""；持有人必须在本镜 entities 里）、note（位置或状态变化，如“从桌上被拿起”）。continuous 镜头的道具开始状态必须等于上一镜的结束状态。
- 道具在镜头里被拿起、放下、打开、损坏、数量变化时，必须反映在 endVisible / endHolder / quantity / note。

提示词：
- imagePrompt：只写开拍瞬间的一张静止画面——景别与构图、人物位置与姿态与表情、道具的开始状态、环境与光线。不要写之后发生的动作或结果。用设定的名称称呼人物和物件，不写“同上”“如前所述”，不写画风（由系统另加）。
- videoPrompt：按时间顺序写“开始状态 → 动作过程 → 结束状态”，并写明运镜。结束状态要与 endState 一致。不要把对白文字写进去。

只输出一个 JSON 对象，格式如下：
{
  "shots": [
    {"seconds": 6, "size": "全景", "camera": "固定", "description": "江雾中的渡口茶棚，林夏独自坐在桌边等人。", "dialogue": [], "narration": "", "entities": ["E5", "E1", "E7"], "transition": "cut",
     "startState": "林夏坐在靠江的方桌旁，面朝棚外，双手放在桌上，怀表放在桌角，煤油灯亮着。",
     "endState": "林夏仍坐着，右手拿起桌角的怀表，抬头看向棚口。",
     "props": [{"entity": "E7", "quantity": 1, "startVisible": true, "endVisible": true, "startHolder": "", "endHolder": "E1", "note": "从桌角被林夏拿起"}],
     "imagePrompt": "全景，固定机位。江雾弥漫的临江竹木茶棚内，二十二岁的林夏身穿深蓝粗布长衫坐在方桌旁，面朝棚外，双手平放桌面，神情平静，桌角放着一枚黄铜怀表，头顶煤油灯发出暖黄光，棚外灰青色江雾。",
     "videoPrompt": "固定机位全景。开始：林夏坐在桌边，怀表在桌角。她缓缓伸出右手拿起怀表，握在掌心，随后抬头看向棚口。结束：林夏手握怀表，视线对着棚口。"}
  ]
}`;

export function build(input: StageInput): Prompt {
    const { snapshot } = input;
    const episode = requireEpisode(input);
    const user = sections(
        section("项目", projectText(snapshot.project)),
        section("本集", episodeLine(episode, snapshot.chapters)),
        section("本集剧本", clip(episode.script, 9000)),
        section("设定（用短标签引用）", entityText(snapshot.entities, "brief")),
        taskSection(input, `把${episode.label}的剧本拆成镜头表，总时长约 ${episode.targetSeconds} 秒。`),
    );
    return { system: SYSTEM, user };
}

export function parse(text: string): ShotsProposal {
    const root = asObject(extractJson(text), "输出");
    return { shots: asArray(root, "shots").map(shot) };
}

function shot(s: Record<string, unknown>): ShotProposalItem {
    const lines = Array.isArray(s.dialogue) ? s.dialogue : str(s.dialogue) ? [{ speaker: "", text: str(s.dialogue) }] : [];
    const dialogue: DialogueLine[] = lines.map((line) => ({ speaker: str((line as Record<string, unknown>)?.speaker), text: str((line as Record<string, unknown>)?.text) }));
    const props = (Array.isArray(s.props) ? s.props : []).map((p) => {
        const prop = (p ?? {}) as Record<string, unknown>;
        return { entity: str(prop.entity), quantity: Math.round(num(prop.quantity, 1)), startVisible: bool(prop.startVisible, true), endVisible: bool(prop.endVisible, true), startHolder: str(prop.startHolder), endHolder: str(prop.endHolder), note: str(prop.note) };
    });
    return {
        seconds: Math.round(num(s.seconds)),
        size: str(s.size),
        camera: str(s.camera),
        description: str(s.description),
        dialogue,
        narration: str(s.narration),
        entities: strings(s.entities),
        transition: str(s.transition) as ShotTransition,
        startState: str(s.startState),
        endState: str(s.endState),
        props,
        imagePrompt: str(s.imagePrompt),
        videoPrompt: str(s.videoPrompt),
    };
}
