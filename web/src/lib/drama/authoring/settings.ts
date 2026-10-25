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
- parent、relations 的 from/to 可以写设定名称或短标签。
- aliases 写资料里出现过的别称；sourceNote 写依据，如“账本·人物；第2章”。
- 关系 kind 只能是：family 亲属、ally 同伴、mentor 师徒、enemy 敌对、love 感情、belong 隶属、rival 对手、other 其他；label 用 2–6 个字的中文关系名（如“结义兄妹”）。同一对人物只写一条最主要的关系。
- 中文输出。

只输出一个 JSON 对象，格式如下：
{
  "entities": [
    {"ref": "E3", "kind": "character", "name": "林夏", "aliases": ["小夏"], "description": "码头账房的女儿，沉默谨慎，在找失踪的父亲。", "appearance": "二十二岁，身形瘦削，齐肩黑发常挽在脑后，深蓝粗布长衫，袖口磨白，左腕缠一圈旧麻绳。", "parent": "", "sourceNote": "账本·人物；第1-3章"},
    {"kind": "scene", "name": "渡口茶棚", "aliases": [], "description": "林夏与周远每次碰头的地方。", "appearance": "临江的竹木茶棚，四张方桌，棚顶油布泛黄，一盏煤油灯悬在梁下，江雾常年不散，色调灰青。", "parent": "", "sourceNote": "账本·地点；第1章"},
    {"kind": "prop", "name": "黄铜怀表", "aliases": [], "description": "周远留给林夏的线索。", "appearance": "拇指大的圆形黄铜怀表，表盖内刻“七”字，链条断过一节。", "parent": "林夏", "sourceNote": "账本·物件；第3章"},
    {"kind": "world", "name": "七号码头的规矩", "aliases": [], "description": "夜里不许点明火，违者由码头会处置。", "appearance": "", "parent": "", "sourceNote": "账本·世界观"}
  ],
  "relations": [
    {"from": "林夏", "to": "周远", "kind": "ally", "label": "同伴", "note": "周远欠林夏父亲一条命"}
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
