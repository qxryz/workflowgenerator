# Category Playbook — 索引

每个品类有独立的详细 playbook 文件，位于 `references/categories/`。本文件只承载**所有品类共用的规则**和**索引表**。

> **使用方法**：
> 1. 先读本文档的"Cross-Category Rules"段（每个 brief 都适用）
> 2. 根据下方索引表找到对应品类文件，按需加载（如 `references/categories/01-womenswear.md`）
> 3. 跨品类商品按主搜索关键词归类（参考底部 Cross-Category Notes）

---

## Cross-Category Rules（适用于每个品类、每个 brief）

这五条规则被频繁忘记，占了大多数失败案例。无论什么品类，每个 brief 都要执行：

1. **Identity must be explicit, not inferred.** 凡是定义 SKU 的属性 —— 性别、版型、年龄段、颜色、材质、表面处理 —— 必须在每张图里清晰可辨,不能依赖模型从 reference 图里推断。模糊的身份必然漂向训练先验下的"通用款"。
2. **Same subject = same identity across every image.** 模特、宠物、产品 variant 在多张图里出现时,身份在第一张图里锁定后,后续每张都必须是同一个 —— 同一张脸、同一个发型、同一套搭配、同一个色款。两张图里的"她"看上去不像同一个人,整组就垮了。
3. **Same sub-set = same scene context.** 详情镜头共享一个表面和一面墙颜色（白墙不能在镜头之间变成绿/蓝）。生活化镜头共享一个地点和时间。重复出现的道具（杯子、植物、笔记本）必须是同一个、同一个状态。**整组图必须读起来像"同一天、同一个地点拍的",不是"一张图一次拍"**。详细的锁定维度参见 `image-quality.md` Part 3.3。详见 `image-quality.md` Part 3.5。
4. **Background contrast must be minimum-viable and harmonious.** 背景在亮度或饱和度上**移动一档**，**不要**跳到对立极端。保持同一大色调家族。目标是"优雅分离"而非"高对比海报"。禁止过度对比：奶白衣撞黑底、黑设备撞纯白、中性产品撞高饱和色。禁止欠对比：白撞白、黑撞炭灰、木撞木。可接受：奶白 → 自然柔白或微冷未漂白亚麻；黑 → 暖浅灰或柔燕麦色；暖木色 → 偏冷柔灰。详见 `image-quality.md` Part 2 — C1。
5. **Detail / macro / workmanship shots are product-only AND single-focus.** 不要人体皮肤、不要手、不要身体部位、不要无关道具。产品摆在干净中性表面（哑光织物、原木、拉丝混凝土、中灰纸）。**一张细节图 = 一个焦点 —— 永远不要把多个不相关细节（领口 + 袖口 + 下摆）塞进一帧；拆成多张**。详见 `image-quality.md` Part 2 — C2。
6. **Framing follows the focal product, not the model.** 焦点产品是模特佩戴/手持的小型/局部配饰（鞋、包、腰带、手表、首饰、墨镜、围巾、帽子）时，**模特的脸不是主体** —— 把焦点产品放在视觉中心，按下面规则裁掉模特：
    - **鞋** → 膝盖以下；不带脸。
    - **包（单肩/跨身）** → 肩到髋，包占主导；下颚以上或整头裁掉。
    - **腰带/腰部配饰** → 胸到大腿；通常不带头。
    - **手表/手镯** → 前臂周围；身体其余部分是上下文。
    - **项链/耳饰/墨镜/帽子** → **可以**包含脸（脸是画布）—— 干净肖像构图，但焦点仍通过光线/对焦/构图引向产品。
    - **围巾/领部** → 胸到上肩；脸视情况是否真正服务产品。
   **默认**：焦点产品是颈部以下的小件 → **不带脸**。带脸会形成抢戏的焦点（"她是谁"赢过"产品是什么"），同时还要让模特的眼神/表情也工作，通常会失败。**有疑问时把脸裁掉**。
7. **Inspect against the Attribute Card + locked scene context before approving.** 每张已批准图必须在每个锁定属性上匹配 Phase 1.1.a 的 Attribute Card；每张子集图必须匹配该子集的 scene context。Drift = severe defect = 重新生成。

服装类（女装/男装/童装）额外加：
- 性别（women's / men's / unisex / kids'）必须在每张图里一望即知。
- 版型必须明确：slim / regular / oversized 的剪裁、cropped / regular / longline 的长度、cinched waist / straight body 的腰线、袖型与领型，都不能含糊。
- 反向性别版型必须避免:女装绝不能出现 men's cut、masculine drape、broad shoulders；男装反过来。

---

## 14 品类索引表

| # | 品类 | 文件 | 优先维度 | 张数 | 核心转化驱动 |
|---|------|------|----------|------|--------------|
| 1 | 女装 (Womenswear) | [`categories/01-womenswear.md`](categories/01-womenswear.md) | Visual + Trust | 7 | 色彩还原 + 面料质感 + 穿着代入感 |
| 2 | 家装家居 (Home & Furniture) | [`categories/02-home.md`](categories/02-home.md) | Information + Visual | 8–10 | 空间比例感 + 尺寸准确 |
| 3 | 日用品 (Daily Goods) | [`categories/03-daily-goods.md`](categories/03-daily-goods.md) | Clarity + Information | 6–8 | 功能可视化 + 使用便利性 |
| 4 | 宠物 (Pet) | [`categories/04-pet.md`](categories/04-pet.md) | Visual + Information | 6–8 | 萌宠情感 + 安全性 |
| 5 | 母婴 (Mother & Baby) | [`categories/05-baby.md`](categories/05-baby.md) | Trust + Brand Consistency | 6 | 安全第一 + 功能便利 |
| 6 | 数码 3C | [`categories/06-3c.md`](categories/06-3c.md) | Clarity + Information | 8–10 | 科技感 + 参数说服力 |
| 7 | 饰品珠宝 (Jewelry) | [`categories/07-jewelry.md`](categories/07-jewelry.md) | Visual + Clarity | 6–7 | 美感 + 工艺信任 |
| 8 | 美妆护肤 (Beauty) | [`categories/08-beauty.md`](categories/08-beauty.md) | Visual + Trust（颜色） | 6 | 颜值 + 质地 + 效果 |
| 9 | 保健品 (Supplements) | [`categories/09-supplements.md`](categories/09-supplements.md) | Trust + Information | 6–7 | 成分透明 + 权威认证 |
| 10 | 洗护用品 (Personal Care) | [`categories/10-personal-care.md`](categories/10-personal-care.md) | Visual + Brand Consistency | 6 | 质地感知 + 香味体验 |
| 11 | 男装 (Menswear) | [`categories/11-menswear.md`](categories/11-menswear.md) | Clarity + Brand Consistency | 7 | 版型 + 做工品质 |
| 12 | 鞋靴 (Footwear) | [`categories/12-footwear.md`](categories/12-footwear.md) | Clarity + Information | 7 | 颜值 + 舒适暗示 |
| 13 | 箱包 (Bags) | [`categories/13-bags.md`](categories/13-bags.md) | Clarity + Information | 7 | 尺寸感知 + 收纳能力 |
| 14 | 运动户外 (Sports & Outdoor) | [`categories/14-sports.md`](categories/14-sports.md) | Visual + Information | 9 | 动态活力 + 功能证据 |

每个品类文件都包含：
- 优先质量维度与权重覆盖
- 组图设计分布（详细到每张图的角色 / 数量 / 内容 / 不可遗漏信息）
- 整体风格与质感（风格方向 / 光线 / 背景 / 色调 / 道具 / 模特）
- 单图构图要求（构图方式 / 焦点 / 突出 / 禁忌）
- 必填项（仅服装等需要 cut tag 的品类）
- 易错点（Watch For）

---

## Cross-Category Notes

商品横跨两个品类时，按**主搜索关键词**归类。"婴儿背带" → 母婴（Trust 优先），不是箱包；"宠物服" → 宠物，不是服装。
