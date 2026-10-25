import type { ScriptProposal } from "../types.ts";
import { asObject, extractJson, ParseError, str } from "./json.ts";
import { byOrd, chapterExcerpts, clip, entityText, episodeLine, projectText, requireEpisode, section, sections, taskSection, type Prompt, type StageInput } from "./context.ts";

const SYSTEM = `你是短剧编剧，把一集的梗概和原著章节写成可拍摄的剧本。

剧本格式（纯文本，场景之间空一行）：
【场景 1】内景/外景｜地点｜时间
（动作描述：只写镜头里看得见、听得见的东西，现在时，短句）
许青：（语气或动作，可省）台词
旁白：……

要求：
- 篇幅按 targetSeconds 控制：约每 10 秒一个动作或一两句对白；宁可紧凑，不要注水。
- 人物、场景、道具使用“设定”里的名称；不新增有名有姓的新人物，路人用“店员”“邻居”这类称呼。
- 开场承接上一集结尾的状态，结尾落在下一集梗概能接住的钩子上。
- 对白口语化、按人物区分口吻，信息通过动作和对白交代，不要旁白解释心理；旁白只在确有必要时使用。
- 原著里的关键情节、关键道具和关键台词要保留，不照抄成段的环境描写。
- 中文输出。

只输出一个 JSON 对象，script 的值是完整剧本，换行写成 \\n：
{"script": "【场景 1】内景｜纸页书店｜夜\\n雨点敲着橱窗……\\n许青：你来晚了。"}`;

/** What fits in a runtime: models write the whole source chapter unless told how little room there is. */
export function pacing(seconds: number) {
    const beats = Math.max(3, Math.round(seconds / 6));
    const scenes = seconds <= 90 ? 2 : Math.ceil(seconds / 45);
    return `篇幅只有这么长：按每 6 秒一拍算（一个动作或一两句对白算一拍），全集约 ${beats} 拍、${scenes} 个场景以内。梗概里写到的主线必须保留，装不下的次要人物和情节直接删掉，不要把来源章节全部塞进来。`;
}

export function build(input: StageInput): Prompt {
    const { snapshot } = input;
    const episode = requireEpisode(input);
    const chapters = byOrd(snapshot.chapters);
    const episodes = byOrd(snapshot.episodes);
    const at = episodes.findIndex((e) => e.id === episode.id);
    const previous = episodes[at - 1];
    const next = episodes[at + 1];
    const sources = chapters.filter((c) => episode.sourceChapterIds.includes(c.id));
    const user = sections(
        section("项目", projectText(snapshot.project)),
        section("本集", episodeLine(episode, chapters)),
        section("本集来源章节", chapterExcerpts(sources, 9000, 4500)),
        section("设定（名称请与此一致）", entityText(snapshot.entities, "brief")),
        section(`上一集（${previous?.label ?? "无"}）结尾`, previous ? `${previous.outline ? "梗概：" + clip(previous.outline, 200) + "\n" : ""}${previous.script ? clip(previous.script, 800, "tail") : ""}` : ""),
        section(`下一集（${next?.label ?? "无"}）梗概`, next ? clip(next.outline, 300) : ""),
        section("本集现有剧本（重写时参考）", episode.script ? clip(episode.script, 3000) : ""),
        taskSection(input, `${episode.script ? "重写" : "写"}${episode.label}的完整剧本，时长约 ${episode.targetSeconds} 秒。${pacing(episode.targetSeconds)}`),
    );
    return { system: SYSTEM, user };
}

export function parse(text: string): ScriptProposal {
    const script = str(asObject(extractJson(text), "输出").script);
    if (!script) throw new ParseError("script 不能为空");
    return { script };
}
