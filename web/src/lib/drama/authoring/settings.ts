import type { EntityKind, RelationKind, SettingsProposal } from "../types.ts";
import { byOrd, chapterDigest, chapterExcerpts, entityText, ledgerText, projectText, relationText, section, sections, taskSection, type Prompt, type StageInput } from "./context.ts";
import { asArray, asObject, extractJson, str, strings } from "./json.ts";

const SYSTEM = `你是短剧美术与设定统筹，把小说资料整理成可直接用于出图和写剧本的设定目录与人物关系。

设定分四类，必须全部覆盖（资料里确实没有的类别除外，如实说明在 sourceNote）：
- character 人物：description 写身份、性格、与主线的关系；appearance 写年龄、体型、面貌、发型、服装、配饰、标志性细节，只写看得见的静态外观，不写情绪和动作。
- scene 场景：appearance 写空间结构、主要陈设、材质、光线、色调、时间与天气。
- prop 道具陈设：appearance 写形状、材质、尺寸、颜色、磨损与细节；parent 填它所属的人物（随身装备）或场景（固定陈设）。
- world 世界观：规则、势力、时代背景，appearance 留空。

要求：
- 以“创作账本”为主要依据，账本里的人物、地点、物件、世界观条目都要落成设定；章节摘要和正文片段用来补细节，不要凭空添加有名有姓的新人物。
- 上下文里已有的设定带短标签（如 E3）：要修改它就在 ref 里填该标签，不要重复新建；没有变化的不用输出。只增改，不删除。
- 设定是要出图、要在镜头里反复用到的资产：道具只保留对情节起作用、会被特写或反复出现的物件（一般不超过 8 个）；一次性的日用品、背景杂物不要单列，写进所在场景的 appearance 里。人物只列有名有姓或有台词的角色。
- 人物的 appearance 只写身体与穿着（年龄、身形、脸、发型、服装、固定的配饰），不写手里拿着或随身带着的物品——那些是道具，在道具里单列。
- description 和 appearance 只写设定本身（是什么、长什么样），不写“资料前后矛盾”“尚未揭示”之类对资料的评论；有矛盾时选一个说法，把疑点写进 sourceNote。
- parent、relations 的 from/to 可以写设定名称或短标签。
- aliases 写资料里出现过的别称；sourceNote 写依据，如“账本·人物；第2章”。
- 关系 kind 只能是：family 亲属、ally 同伴、mentor 师徒、enemy 敌对、love 感情、belong 隶属、rival 对手、other 其他；label 用 2–6 个字的中文关系名（如“结义兄妹”）。同一对人物只写一条最主要的关系。
- 中文输出。

只输出一个 JSON 对象，格式如下：
{
  "entities": [
    {"ref": "E3", "kind": "character", "name": "许青", "aliases": ["小青"], "description": "旧书店的店员，沉默谨慎，在找一本被人买走的账册。", "appearance": "二十六岁，身形瘦削，齐肩黑发常挽在脑后，深灰色针织开衫，袖口起球，左腕戴一根褪色的红绳。", "parent": "", "sourceNote": "账本·人物；第1-3章"},
    {"kind": "scene", "name": "纸页书店", "aliases": [], "description": "许青与老蒋每次碰头的地方。", "appearance": "街角的老书店，高到天花板的深色木书架，窄窄的过道，收银台上一盏绿罩台灯，窗外是潮湿的街道，色调偏暖黄。", "parent": "", "sourceNote": "账本·地点；第1章"},
    {"kind": "prop", "name": "蓝布雨伞", "aliases": [], "description": "老蒋留给许青的线索。", "appearance": "折叠长柄雨伞，蓝色布面，伞骨有一根弯折，木质伞柄上缠着一圈白胶布。", "parent": "许青", "sourceNote": "账本·物件；第3章"},
    {"kind": "world", "name": "书店的规矩", "aliases": [], "description": "打烊后不许外借孤本，违者取消会员。", "appearance": "", "parent": "", "sourceNote": "账本·世界观"}
  ],
  "relations": [
    {"from": "许青", "to": "老蒋", "kind": "ally", "label": "忘年交", "note": "老蒋是书店的常客，帮过许青很多次"}
  ]
}`;

export function build(input: StageInput): Prompt {
    const { snapshot } = input;
    const chapters = byOrd(snapshot.chapters);
    const user = sections(
        section("项目", projectText(snapshot.project)),
        section("创作账本（主要依据）", ledgerText(snapshot.ledger)),
        section("章节摘要", chapterDigest(chapters)),
        section("正文片段（补充细节用）", chapterExcerpts(chapters, 5000, 1200)),
        section("已有设定（短标签可用于 ref）", entityText(snapshot.entities)),
        section("已有关系", relationText(snapshot.relations, snapshot.entities)),
        taskSection(input, snapshot.entities.length ? "补充和更新设定与关系，只输出需要新增或修改的部分。" : "首次整理：输出完整的设定目录和人物关系。"),
    );
    return { system: SYSTEM, user };
}

export function parse(text: string): SettingsProposal {
    const root = asObject(extractJson(text), "输出");
    const entities = asArray(root, "entities").map((e) => {
        const ref = str(e.ref);
        const parent = str(e.parent);
        return {
            ...(ref ? { ref } : {}),
            kind: str(e.kind) as EntityKind,
            name: str(e.name),
            aliases: strings(e.aliases),
            description: str(e.description),
            appearance: str(e.appearance),
            ...(parent ? { parent } : {}),
            sourceNote: str(e.sourceNote),
        };
    });
    const relations = (Array.isArray(root.relations) ? asArray(root, "relations") : []).map((r) => ({ from: str(r.from), to: str(r.to), kind: str(r.kind) as RelationKind, label: str(r.label), note: str(r.note) }));
    return { entities, relations };
}
