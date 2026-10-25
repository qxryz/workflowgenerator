import type { DialogueLine, ShotProposalItem, ShotsProposal, ShotTransition } from "../types.ts";
import { asArray, asObject, bool, extractJson, num, str, strings } from "./json.ts";
import { clip, entityText, episodeLine, projectText, requireEpisode, section, sections, taskSection, type Prompt, type StageInput } from "./context.ts";

const SYSTEM = `你是短剧分镜导演，把一集剧本拆成镜头表。每个镜头之后会单独生成一张画面和一段视频，所以每个镜头必须自成一体、前后状态衔接。

镜头规则：
- seconds 为 4–15 的整数（大多数镜头 4–6 秒），所有镜头秒数之和接近本集 targetSeconds（偏差不超过 10%），宁可合并镜头也不要超时。
- size（景别）用：大远景/远景/全景/中景/近景/特写/大特写；camera（运镜）用：固定/推/拉/摇/移/跟/升降/手持/环绕 等简短词。相邻两镜运镜不要相同，同一景别不要连续出现 3 次，有强调需要时才用特写。
- description：这一镜画面里发生什么，一两句。
- entities：本镜出场的设定，用上下文里的短标签（E3）：必须包含场景、出场人物和画面里出现的重要道具。对白说话人必须在其中。只列画面里真的出现的人物：只在对白里被提到、不在场的人物不要列。只能用设定列表里已有的标签；列表里没有的物件（临时出现的杂物）不要列出，也不要自己编标签，在 description 里写到即可。
- 对白要说得完：中文每秒约 4 个字，一镜的对白加旁白不超过 seconds×4 个字，超出就拆到下一镜或调大 seconds。
- dialogue 逐句取自剧本，speaker 填人物短标签（旁白或画外音留空字符串）；narration 是本镜旁白。没有就写 [] 和 ""。

连续性（每个字段都必须填，镜头表的准确度取决于它）：
- transition：continuous 动作与上一镜首尾相接、cut 切镜、time_jump 时间跳转。第 1 镜不能是 continuous。
- startState：开拍那一刻的画面状态——人物站位、朝向、姿态、手里拿着什么、门窗灯光状态。endState：本镜结束那一刻的同类状态。continuous 镜头的 startState 必须等于上一镜的 endState。
- props：本镜出现的、设定列表里有的每一件道具逐项写（没有列出的杂物不写）：entity（短标签）、quantity（数量）、startVisible/endVisible（开始/结束时是否在画面内可见）、startHolder/endHolder（开始/结束时由哪个人物持有，填人物短标签，无人持有填 ""；持有人必须在本镜 entities 里）、note（位置或状态变化，如“从桌上被拿起”）。continuous 镜头的道具开始状态必须等于上一镜的结束状态。
- 道具在镜头里被拿起、放下、打开、损坏、数量变化时，必须反映在 endVisible / endHolder / quantity / note。

提示词：
- startState 与 imagePrompt 必须是同一个瞬间、互不矛盾：人物在镜头中途才入场的，把开拍定在他刚进入画面的那一刻（门口、画面边缘），不要写“空无一人”却又在画面里画出他。
- imagePrompt：只写开拍瞬间的一张静止画面——景别与构图、人物位置与姿态与表情、道具的开始状态、环境与光线。不要写之后发生的动作或结果。用设定的名称称呼人物和物件，不写“同上”“如前所述”，不写画风（由系统另加）。
- videoPrompt：按时间顺序写“开始状态 → 动作过程 → 结束状态”，并写明运镜。结束状态要与 endState 一致。不要把对白文字写进去。

只输出一个 JSON 对象，格式如下：
{
  "shots": [
    {"seconds": 6, "size": "全景", "camera": "固定", "description": "雨夜的纸页书店，许青独自坐在收银台后等人。", "dialogue": [], "narration": "", "entities": ["E5", "E1", "E7"], "transition": "cut",
     "startState": "许青坐在收银台后，面朝店门，双手放在台面上，雨伞靠在台边，台灯亮着。",
     "endState": "许青仍坐着，右手拿起靠在台边的雨伞，抬头看向店门。",
     "props": [{"entity": "E7", "quantity": 1, "startVisible": true, "endVisible": true, "startHolder": "", "endHolder": "E1", "note": "从台边被许青拿起"}],
     "imagePrompt": "全景，固定机位。雨夜的老书店内，二十六岁的许青身穿深灰针织开衫坐在收银台后，面朝店门，双手平放台面，神情平静，台边靠着一把蓝布长柄雨伞，绿罩台灯发出暖黄光，橱窗外是潮湿的街道。",
     "videoPrompt": "固定机位全景。开始：许青坐在收银台后，雨伞靠在台边。她缓缓伸出右手拿起雨伞，握在手里，随后抬头看向店门。结束：许青手握雨伞，视线对着店门。"}
  ]
}`;

/** Models cut every beat into its own shot unless told how many shots the runtime allows. */
export function shotBudget(seconds: number) {
    const count = Math.max(2, Math.round(seconds / 5));
    return `镜头数控制在 ${count} 个左右（每镜 4–6 秒为主），秒数加起来要落在 ${Math.round(seconds * 0.9)}–${Math.round(seconds * 1.1)} 秒：一个动作或一两句对白用一镜完成，不要把同一场戏拆成很多短镜；超出就合并镜头，不要缩短剧本里的主线。`;
}

export function build(input: StageInput): Prompt {
    const { snapshot } = input;
    const episode = requireEpisode(input);
    const user = sections(
        section("项目", projectText(snapshot.project)),
        section("本集", episodeLine(episode, snapshot.chapters)),
        section("本集剧本", clip(episode.script, 9000)),
        section("设定（用短标签引用）", entityText(snapshot.entities.filter((e) => e.kind !== "world"), "brief")),
        taskSection(input, `把${episode.label}的剧本拆成镜头表，总时长约 ${episode.targetSeconds} 秒。${shotBudget(episode.targetSeconds)}`),
    );
    return { system: SYSTEM, user };
}

export function parse(text: string): ShotsProposal {
    const root = asObject(extractJson(text), "输出");
    return { shots: asArray(root, "shots").map(shot) };
}

/** The line itself, whatever key the model chose for it. */
const lineText = (line: Record<string, unknown>) => str(line.text) || str(line.line) || str(line.content) || str(line.dialogue) || str(line.words);

function shot(s: Record<string, unknown>): ShotProposalItem {
    const lines = Array.isArray(s.dialogue) ? s.dialogue : str(s.dialogue) ? [{ speaker: "", text: str(s.dialogue) }] : [];
    const dialogue: DialogueLine[] = lines.map((line) => ({ speaker: str((line as Record<string, unknown>)?.speaker), text: lineText((line ?? {}) as Record<string, unknown>) }));
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
