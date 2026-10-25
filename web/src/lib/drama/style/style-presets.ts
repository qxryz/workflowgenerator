// Adapted from Kinema config/models.yaml (AGPL-3.0). See THIRD_PARTY_NOTICES.md.
export type StylePreset = { id: string; name: string; nameEn: string; prompt: string; promptEn: string };
export const STYLE_PRESETS: readonly StylePreset[] = [
    {
        id: "narration",
        name: "口播",
        nameEn: "Talking head",
        prompt: "",
        promptEn: "",
    },
    {
        id: "anime",
        name: "现代新番",
        nameEn: "Modern anime",
        prompt: "现代日本新番动画风格，数字作画高精度锐利线条，高饱和色彩设计与明暗二分，高密度粒子特效与镜头光效演出（碎光拖尾、层叠辉光），大透视与倾斜地平线的动态构图，ufotable 式打光与镜头景深，2020年代顶级制作画质，",
        promptEn:
            "modern Japanese seasonal anime style, high-precision digital linework, high-saturation color design with crisp two-tone shading, dense particle and lens-flare effects with trailing sparks and layered glow, wide-angle perspective and tilted-horizon compositions, ufotable-style lighting and lens depth, 2020s top-tier production quality, ",
    },
    {
        id: "anime_cel",
        name: "赛璐璐",
        nameEn: "Cel animation",
        prompt: "日式赛璐璐动画风格，鲜明清晰的轮廓线，扁平上色，高饱和度，二次元人物设定，",
        promptEn: "Japanese cel anime style, clean crisp outlines, flat cel shading, high saturation, anime character design, ",
    },
    {
        id: "anime_80s",
        name: "80年代日漫",
        nameEn: "1980s anime",
        prompt: "1980年代日本剧场版赛璐璐动画风格，经费爆炸级手绘作画，胶片摄影质感与细腻颗粒，暗部偏青的复古胶片色域，手绘厚涂背景细节密度极高，角色鼻梁高光与锐利阴影分割，写实人体比例与厚重衣褶，机械与城市细节狂热刻画，AKIRA 与王立宇宙军时代的 OVA 黄金期美学，",
        promptEn:
            "1980s Japanese theatrical cel anime, lavish hand-drawn sakuga, film grain and photographic texture, retro film palette with teal-shifted shadows, densely detailed hand-painted backgrounds, sharp nose highlights and hard shadow separation, realistic proportions with heavy fabric folds, obsessive mechanical and cityscape detail, AKIRA and Royal Space Force era OVA golden-age aesthetic, ",
    },
    {
        id: "ghibli",
        name: "吉卜力",
        nameEn: "Ghibli",
        prompt: "吉卜力工作室手绘动画电影风格，宫崎骏质感，赛璐璐平涂搭配水彩晕染的手绘背景，柔和的光线过渡与柔化的阴影边缘，克制的手绘线条，圆润亲切的角色造型与红润脸颊，朴素温厚的日常生活质感，每一帧都像绘本插画，",
        promptEn:
            "Studio Ghibli hand-drawn animation film style, Hayao Miyazaki aesthetic, cel-painted flats over watercolor-washed hand-painted backgrounds, soft light falloff and softened shadow edges, restrained hand-drawn linework, rounded friendly characters with rosy cheeks, humble warm everyday-life texture, every frame like a picture-book illustration, ",
    },
    {
        id: "shinkai",
        name: "新海诚",
        nameEn: "Shinkai",
        prompt: "新海诚电影风格，写实系动画光影推到上限：高光过曝而暗部仍留细节，强烈逆光与镜头光晕，饱和度拉满的黄昏天空与层叠积云，雨滴与光斑的超细腻刻画，都市场景精确到电线与路牌，情绪化的色温变化，每一帧都是壁纸，",
        promptEn:
            "Makoto Shinkai film style, realistic anime lighting pushed to its ceiling: highlights blown out while shadows keep detail, strong backlight and lens flare, saturated sunset sky with layered cumulus clouds, raindrop and bokeh detail resolved to single droplets, urban scenery precise down to power lines and street signs, emotional color-temperature shifts, every frame wallpaper-grade, ",
    },
    {
        id: "pixar",
        name: "皮克斯",
        nameEn: "Pixar",
        prompt: "皮克斯3D动画电影风格，圆润夸张的角色造型，微表情逐帧可辨（眉尾先动、嘴角后到），皮肤次表面散射质感，电影级PBR材质渲染，柔和三点布光与暖色叙事光，浅景深电影镜头，温暖幽默的家庭电影质感，",
        promptEn:
            "Pixar 3D animated film style, rounded exaggerated character design whose micro-expressions read frame by frame (brow tail moves first, mouth corner follows), subsurface-scattering skin, cinematic PBR material rendering, soft three-point lighting with warm narrative light, shallow depth-of-field cinematic lens, warm family-film charm, ",
    },
    {
        id: "disney3d",
        name: "迪士尼3D",
        nameEn: "Disney 3D",
        prompt: "迪士尼3D动画电影风格，角色造型圆润、五官比例夸张，眼睛大而明亮、虹膜带多层高光，公主电影级的丝绸布料与发丝渲染，柔焦体积光束穿过浮尘，魔法粒子呈粉紫渐变缓慢上浮，音乐剧式舞台布光，饱满鲜艳的色彩，每种材质各带独立分层高光，",
        promptEn:
            "Disney 3D animated film style, rounded character design with exaggerated features, large bright eyes whose irises carry layered speculars, princess-movie grade silk cloth and hair-strand rendering, soft-focus volumetric shafts through floating dust, magic particles drifting upward in a pink-to-violet gradient, musical-theater stage lighting, rich vivid colors, every material carrying its own layered speculars, ",
    },
    {
        id: "anime_xianxia",
        name: "国漫仙侠",
        nameEn: "Xianxia animation",
        prompt: "国漫仙侠动画风格，中国古风二次元人物设定，工笔勾线结合水墨晕染的远景，飘逸的束发玉冠与广袖衣袂随风而动，灵力流光与仙气氤氲的粒子特效，飞檐斗拱与云海仙山的东方场景，黛青绯红鎏金的传统配色体系，魔道祖师与天官赐福级的国风美学，",
        promptEn:
            "Chinese xianxia donghua style, classical Chinese anime character design, fine gongbi linework with ink-wash distant scenery, flowing wide sleeves and jade hair crowns in the wind, spiritual-energy light streams and ethereal particles, upturned eaves and cloud-sea immortal mountains, traditional palette of indigo, crimson and gilt gold, Mo Dao Zu Shi grade Chinese animation, ",
    },
    {
        id: "anime_mecha",
        name: "机甲热血",
        nameEn: "Mecha action",
        prompt: "机甲热血动画风格，硬朗直线条的机械设定作画，装甲分件铆钉喷口与涂装编号的机设密度，驾驶舱仪表屏显与HUD光效，出击发进的爆炸烟火作画，强透视与速度线的热血作画，EVA与宇宙世纪高达级的机械美学，",
        promptEn:
            "hot-blooded mecha anime style, hard straight-line mechanical design, dense mech detailing with armor panel lines, rivets, thrusters and unit markings, cockpit instrument displays and HUD glow, launch-sequence explosion pyrotechnic sakuga, extreme-foreshortening and speed-line sakuga, EVA and Universal Century Gundam grade mechanical aesthetics, ",
    },
    {
        id: "anime_jojo",
        name: "JOJO奇妙冒险",
        nameEn: "JoJo-inspired",
        prompt: "JOJO的奇妙冒险动画风格，荒木飞吕彦浓烈美学，粗硬有力的轮廓线与漫画式剖面线排线阴影，高对比迷幻撞色的非自然配色（紫金品红青绿），时装模特般夸张拧转的经典JOJO站姿，健美写实的人体肌肉线条与奇异剪裁时装，宝石般高饱和色彩与情绪化色彩反转的戏剧打光，漫画网点与放射速度线铺满背景，人物躯干与四肢反向拧转到姿态极限，",
        promptEn:
            "JoJo's Bizarre Adventure anime style, Hirohiko Araki's intense aesthetic, bold heavy outlines with manga cross-hatching shadows, high-contrast psychedelic unnatural colors of purple, gold, magenta and teal, flamboyant contorted JoJo poses like fashion models, muscular realistic anatomy in avant-garde outfits, gem-like saturated colors with dramatic emotional color inversions, manga halftone dots and radial speed lines filling the background, torso and limbs counter-twisted to the limit of the pose, ",
    },
    {
        id: "anime_american",
        name: "美漫",
        nameEn: "American comics",
        prompt: "美式漫画风格，漫威DC经典美漫美学，粗重有力的墨线勾边与交叉排线阴影，半调网点印刷质感与轻微套印错位，红蓝黄高饱和原色配色，戏剧性明暗切割的英雄打光，强透视缩短的动态构图，splash page 级的画面冲击力，",
        promptEn:
            "American comic book style, classic Marvel DC aesthetics, heavy bold ink outlines with cross-hatched shading, halftone Ben-Day dot print texture with slight registration offset, high-saturation red, blue and yellow primaries, dramatic chiaroscuro hero lighting, dynamic foreshortened compositions, splash-page level impact, ",
    },
    {
        id: "moebius",
        name: "莫比斯",
        nameEn: "Moebius",
        prompt: "莫比斯式法式科幻漫画风格，清晰纤细的手绘墨线，疏密有序的细线排线，空旷异星建筑的空间感，有机曲线与精密机械细节并置，柔和平涂色块与克制阴影，保留主体既定材质特征，",
        promptEn:
            "Moebius-inspired French science-fiction comic style, clear delicate hand-inked outlines, sparse controlled fine hatching, the spaciousness of vast otherworldly architecture, organic curves alongside intricate mechanical details, soft flat color fields and restrained shadows, preserve the subject's established material characteristics, ",
    },
    {
        id: "anime_pixel",
        name: "像素动画",
        nameEn: "Pixel animation",
        prompt: "像素艺术动画风格，16-bit至32-bit像素美术，方正清晰的像素颗粒与有限调色板，dithering抖色渐变的天空与光晕，多层视差感的像素场景纵深，霓虹像素灯光与发光窗户，pixel-perfect 的锐利轮廓，无任何游戏UI界面元素，",
        promptEn:
            "pixel-art animation style, 16-bit to 32-bit pixel artwork, crisp chunky pixels with a limited palette, dithered gradient skies and glows, multi-layer parallax scene depth, neon pixel lights and glowing windows, pixel-perfect sharp outlines, no game UI elements, ",
    },
    {
        id: "anime_doodle",
        name: "涂鸦线稿",
        nameEn: "Doodle line art",
        prompt: "手绘涂鸦线稿动画风格，铅笔与钢笔的粗糙速写线条，保留起稿辅助线与线条抖动的手绘生命力，纸纹清晰的笔记本纸面底色，大面积单色线稿加一两处高饱和马克笔色块点睛，简笔画角色的夸张挤压拉伸表演，箭头星星爆炸圈的涂鸦装饰元素，稚拙而充满能量的草图美学，",
        promptEn:
            "hand-drawn doodle sketch animation style, rough pencil and pen sketch lines, visible construction lines and wobbly boiling linework full of life, notebook paper background with clear grain, largely monochrome linework with one or two saturated marker accents, stick-figure characters with exaggerated squash-and-stretch acting, doodle arrows, stars and burst circles, naive energetic sketchbook aesthetic, ",
    },
    {
        id: "anime_fairytale",
        name: "童话绘本",
        nameEn: "Fairy-tale illustration",
        prompt: "童话绘本动画风格，手绘水彩与色铅笔的纸纹质感，扁平装饰性构图与图案化的森林花草，圆润稚拙的角色造型与明亮大眼睛，温暖柔和的糖果色与大地色系，凯尔经的秘密式的平面美术设计，每一帧都像童书绘本的跨页插画，",
        promptEn:
            "storybook fairy-tale animation style, hand-drawn watercolor and colored-pencil paper texture, flat decorative composition with patterned stylized forests and flora, rounded childlike characters with bright big eyes, warm candy and earth-tone palette, The Secret of Kells style flat art design, every frame like a children's picture-book spread, ",
    },
    {
        id: "anime_ink",
        name: "水墨动画",
        nameEn: "Ink animation",
        prompt: "中国水墨动画风格，上海美术电影制片厂经典水墨片质感，湿笔晕染与飞白皴擦的笔触，墨分五色的浓淡干湿层次，大面积留白的文人画构图，形体写意概括而气韵生动，山水情与小蝌蚪找妈妈的水墨美学，偶以朱砂石青点睛，",
        promptEn:
            "Chinese ink-wash animation style, Shanghai Animation Film Studio classic ink-film texture, wet-brush bleeding and dry flying-white strokes, five shades of ink in layered gradation, literati composition with generous negative space, expressive forms with vivid qi-yun spirit, Feeling from Mountain and Water aesthetic, occasional cinnabar or azurite accents, ",
    },
    {
        id: "anime3d",
        name: "3D国漫",
        nameEn: "Chinese 3D animation",
        prompt: "顶级3D国漫渲染风格，国产年番级工业水准，电影级实时渲染与光线追踪质感，写实向东方人物建模，皮肤次表面散射的通透感、发丝逐缕解算、布料与织物随动，材质分层考究（丝绸的柔光、金属的锐反射、皮革的粗粝各不相同），体积光与大气透视，电影级布光与统一色彩管理，",
        promptEn:
            "top-tier Chinese 3D donghua rendering, flagship annual-series production value, cinematic real-time rendering with ray-traced quality, realistic East-Asian character modeling, subsurface-scattered skin, strand-based hair simulation and cloth dynamics, layered material definition (soft silk, sharp metal speculars, coarse leather), volumetric light and atmospheric perspective, cinematic lighting with unified color management, ",
    },
    {
        id: "anime_ldr",
        name: "爱死机",
        nameEn: "Love, Death & Robots",
        prompt: "爱死亡机器人式写实CG短片风格，Blur Studio 电影级3D渲染，超写实人物皮肤毛孔与瞳孔反光，硬表面科幻机械的磨损划痕与管线细节，体积光中悬浮的尘埃颗粒，低饱和冷峻电影调色，长焦浅景深电影镜头，成人向暗黑科幻氛围，",
        promptEn:
            "Love Death and Robots style hyper-realistic CG short film, Blur Studio grade cinematic 3D render, hyperreal skin pores and eye reflections, hard-surface sci-fi machinery with wear scratches and cable details, dust motes drifting in volumetric light, desaturated cold cinematic grade, long-lens shallow depth of field, dark adult sci-fi atmosphere, ",
    },
    {
        id: "photoreal3d",
        name: "写实CG",
        nameEn: "Photoreal CG",
        prompt: "电影视效级写实CG，与实拍难辨的照片级质感，数字人皮肤的毛孔汗毛与次表面散射通透感，动物针毛与绒毛分层的逐根毛发解算，定焦镜头浅景深与柔和边缘光，ACES电影调色与细腻胶片颗粒，",
        promptEn:
            "VFX-grade photorealistic CG indistinguishable from live-action footage, photoreal digital human skin with pores, vellus hair and subsurface scattering, strand-based animal groom with guard hairs over undercoat, prime-lens shallow depth of field with soft rim light, ACES cinematic grade with fine film grain, ",
    },
    {
        id: "virtual_production",
        name: "虚拟制片",
        nameEn: "Virtual production",
        prompt: "虚拟制片LED环幕影棚机内合成质感，CG环境与真实摄影机语言合一，环幕画面把场景色光真实地投射到人物与道具上形成交互式环境光与反射，实景灯具与烟雾在场，浅景深与轻微镜头畸变，ARRI电影摄影机的宽容度与胶片曲线，",
        promptEn:
            "virtual production LED volume in-camera VFX look, CG environment married to real cinema camera language, wall-cast interactive environment lighting and reflections on subjects and props, practical fixtures and atmospheric haze on set, shallow depth of field with subtle lens distortion, ARRI cinema camera latitude and film curve, ",
    },
    {
        id: "cg_noir",
        name: "黑色写实",
        nameEn: "Noir realism",
        prompt: "黑色电影质感的写实CG画面，大面积暗部里单一硬光源的伦勃朗式布光，光比极大而暗部仍有层次，空气中的薄雾与尘埃分离前后景，皮肤高光克制、瞳孔里一点锐利眼神光，低饱和近单色调，长焦浅景深，",
        promptEn:
            "film-noir photoreal CG imagery, single hard key light with Rembrandt shaping against deep shadow, extreme lighting ratio with retained shadow detail, thin haze and dust separating foreground from background, restrained skin speculars with a sharp catchlight in the eye, desaturated near-monochrome palette, long lens shallow depth of field, ",
    },
    {
        id: "game_sim",
        name: "实况HUD",
        nameEn: "Simulation HUD",
        prompt: "3D 游戏引擎实时渲染画面，第三人称视角，屏幕带 HUD 抬头显示元素，赛博质感，",
        promptEn: "3D game-engine real-time rendered frame, third-person view, on-screen HUD interface elements, cyber aesthetic, ",
    },
    {
        id: "hd2d",
        name: "HD-2D",
        nameEn: "HD-2D",
        prompt: "HD-2D 游戏美术风格，2D 像素精灵角色置于 3D 立体透视微缩布景中，tilt-shift 移轴景深虚化，柔和 bloom 泛光，体积光与暖色氛围光，细腻粒子效果，复古 JRPG 电子游戏过场画面，八方旅人 Octopath Traveler 风格，",
        promptEn:
            "HD-2D game art style, 2D pixel sprite characters in 3D perspective diorama sets, tilt-shift depth-of-field blur, soft bloom glow, volumetric and warm ambient light, delicate particles, retro JRPG video game cutscene, Octopath Traveler style, ",
    },
    {
        id: "gba",
        name: "GBA",
        nameEn: "GBA",
        prompt: "GBA 复古 16-bit 像素 RPG 游戏画面，有限调色板，硬边像素点阵，俯视/侧视角，Game Boy Advance 时代 JRPG 美术，",
        promptEn: "GBA retro 16-bit pixel RPG frame, limited palette, hard-edged pixel dot art, top-down and side views, Game Boy Advance era JRPG artwork, ",
    },
    {
        id: "snes",
        name: "SNES",
        nameEn: "SNES",
        prompt: "SNES 超任 16-bit 像素 RPG 游戏画面，丰富饱和调色板，细腻像素美术，Mode7 伪 3D 透视，超级任天堂时代 JRPG 过场，",
        promptEn: "SNES 16-bit pixel RPG frame, rich saturated palette, delicate pixel artwork, Mode7 pseudo-3D perspective, Super Nintendo era JRPG cutscene, ",
    },
    {
        id: "dark_fantasy",
        name: "暗黑奇幻",
        nameEn: "Dark fantasy",
        prompt: "暗黑哥特像素美术，压抑低饱和冷色调，高对比明暗，火把幽光，血色点缀，恐怖氛围 JRPG 画面，黑暗奇幻，",
        promptEn: "dark gothic pixel art, oppressive desaturated cold tones, high-contrast chiaroscuro, torch glow, blood-red accents, horror-atmosphere JRPG frame, dark fantasy, ",
    },
    {
        id: "game_ps1",
        name: "PS1低模",
        nameEn: "PS1 low-poly",
        prompt: "PS1时代复古低多边形3D游戏画面，粗糙低模角色与硬直棱角轮廓，低分辨率贴图的扭曲与颗粒感，仿射纹理抖动，浓雾与黑暗吞没的有限视距，固定机位的诡异取景角度，顶点光照的生硬明暗，1990年代末生存恐怖游戏的低保真质感，",
        promptEn:
            "PS1-era retro low-poly 3D game frame, crude low-poly characters with rigid angular silhouettes, warped grainy low-resolution textures, affine texture wobble, limited draw distance swallowed by thick fog and darkness, eerie fixed-camera angles, harsh vertex lighting, late-1990s survival-horror lo-fi aesthetic, ",
    },
    {
        id: "game_voxel",
        name: "体素方块",
        nameEn: "Voxel blocks",
        prompt: "体素艺术游戏画面，一切由立方体方块搭建的世界，方块地形分层与体素树木云朵，清晰的立方体像素颗粒，明快高饱和的方块色板，柔和的方向光与方块投影，数字乐高般的建造美学，无任何游戏UI界面元素，",
        promptEn:
            "voxel art game frame, a world built entirely of cubes, layered blocky terrain with voxel trees and clouds, crisp cubic pixels, bright high-saturation block palette, soft directional light with blocky shadows, digital-LEGO construction aesthetic, no game UI elements, ",
    },
    {
        id: "game_isometric",
        name: "等距CRPG",
        nameEn: "Isometric CRPG",
        prompt: "等距视角CRPG游戏画面，45度俯视的等距投影构图，手绘质感的精细地城与城镇俯瞰，戏剧性的火光与法术光源投射长影，暗色调厚重油画质感，暗黑破坏神与博德之门级的等距美术，无任何游戏UI界面元素，",
        promptEn:
            "isometric CRPG game frame, 45-degree isometric projection composition, hand-painted detailed dungeon and town overviews, dramatic torch and spell light casting long shadows, dark heavy oil-painting texture, Diablo and Baldur's Gate grade isometric art, no game UI elements, ",
    },
    {
        id: "game_celshade",
        name: "卡通渲染",
        nameEn: "Cel shading",
        prompt: "卡通渲染3D游戏画面，cel-shading赛璐璐着色与清晰描边轮廓，平涂色阶的立体角色，广袤明亮的开放世界草原与远山，风格化的云与体积光，清新高饱和的自然色板，塞尔达旷野之息级的卡通渲染美学，无任何游戏UI界面元素，",
        promptEn:
            "cel-shaded 3D game frame, toon shading with clean outline strokes, flat-toned stylized characters, vast bright open-world grasslands and distant mountains, stylized clouds and volumetric light, fresh high-saturation natural palette, Breath of the Wild grade cel-shaded aesthetic, no game UI elements, ",
    },
    {
        id: "game_vn",
        name: "视觉小说",
        nameEn: "Visual novel",
        prompt: "日式视觉小说游戏画面，动漫立绘美术，逆光暖调、高光散成圆形光斑的场景背景，柔和的背景景深与氛围光斑，Galgame级的立绘精度与情绪表现，无任何游戏UI界面元素，",
        promptEn:
            "Japanese visual novel game frame, anime tachie artwork, backlit warm-toned scenic backgrounds with circular bokeh highlights, soft background bokeh and ambient light spots, galgame-grade sprite detail and emotional expression, no game UI elements, ",
    },
    {
        id: "game_arcade",
        name: "街机像素",
        nameEn: "Arcade pixels",
        prompt: "街机横版游戏像素画面，粗壮有力的大型像素精灵角色，高对比霓虹街头背景（涂鸦墙/夜市招牌/机厅灯光），饱满浓烈的街机调色板，侧视横版卷轴构图，拳皇街霸时代的格斗游戏像素美术，动作定格的打击感姿态，",
        promptEn:
            "arcade side-scrolling pixel game frame, bold chunky large pixel sprite fighters, high-contrast neon street backdrops of graffiti walls, night-market signs and arcade lights, rich intense arcade palette, side-view horizontal scrolling composition, King of Fighters and Street Fighter era fighting-game pixel art, freeze-frame impactful action poses, ",
    },
    {
        id: "book",
        name: "图书",
        nameEn: "Book",
        prompt: "实拍摄影的编辑影像质感，柔和窗光与低对比漫射布光，暖纸与亚麻本白的低饱和色板，油墨印刷般的哑光暗部与克制高光，中焦浅景深与细腻胶片颗粒，",
        promptEn:
            "editorial photographic image quality, soft window light with low-contrast diffuse fill, desaturated palette of warm paper and linen white, matte shadows and restrained highlights as in ink printing, medium focal length with shallow depth of field and fine film grain, ",
    },
    {
        id: "explainer",
        name: "解说",
        nameEn: "Explainer",
        prompt: "简洁现代信息图与编辑插画风格，清晰构图，高可读性，知识科普视觉，",
        promptEn: "clean modern infographic and editorial illustration style, clear composition, high readability, educational visual, ",
    },
    {
        id: "quote",
        name: "语录",
        nameEn: "Quotes",
        prompt: "实拍摄影质感，浅景深自然光，极简氛围背景，柔和光影，大面积留白，低对比，适合叠加文字，",
        promptEn: "live-action photographic look, shallow depth of field in natural light, minimalist ambient background, soft light and shadow, generous negative space, low contrast, suitable for text overlay, ",
    },
    {
        id: "ranking",
        name: "榜单",
        nameEn: "Rankings",
        prompt: "实拍摄影质感，棚拍布光，干净醒目的视觉，鲜明高对比，适合叠加榜单序号，",
        promptEn: "live-action photographic look, studio lighting, clean eye-catching visual, bold high contrast, suitable for ranking badge overlay, ",
    },
    {
        id: "cyberpunk",
        name: "赛博朋克",
        nameEn: "Cyberpunk",
        prompt: "写实 3D CG 渲染，实拍电影摄影质感，照片级材质与真实光照，赛博朋克风格，雨夜霓虹都市，青色与品红霓虹光污染，湿润街道镜面反光，全息投影广告牌，高对比电影级构图，未来科技质感，",
        promptEn:
            "photorealistic 3D CG render, live-action cinematic photography look, photographic materials and physically based lighting, cyberpunk style, rainy neon night city, cyan and magenta neon light pollution, wet mirror-like street reflections, holographic billboard projections, high-contrast cinematic composition, futuristic tech texture, ",
    },
    {
        id: "cyberpunk_2d",
        name: "赛博朋克·2D",
        nameEn: "Cyberpunk 2D",
        prompt: "2D 手绘动画，赛璐璐平涂上色，清晰描边线，日式动画赛博朋克风格，雨夜霓虹都市，青色与品红霓虹光污染，湿润街道镜面反光，全息投影广告牌，高对比构图，未来科技质感，",
        promptEn:
            "2D hand-drawn animation, cel-shaded flat colors, clean ink outlines, Japanese anime cyberpunk style, rainy neon night city, cyan and magenta neon light pollution, wet mirror-like street reflections, holographic billboard projections, high-contrast composition, futuristic tech texture, ",
    },
    {
        id: "clay",
        name: "粘土定格",
        nameEn: "Clay stop motion",
        prompt: "粘土定格动画风格，手工黏土材质带细微指纹与瑕疵，圆润厚实造型，定格动画影棚布光，微距浅景深，阿德曼动画质感，",
        promptEn: "claymation stop-motion style, handmade clay material with subtle fingerprints and imperfections, rounded chunky sculpts, stop-motion studio lighting, macro shallow depth of field, Aardman animation texture, ",
    },
    {
        id: "gunpla",
        name: "高达定格",
        nameEn: "Gunpla stop motion",
        prompt: "高达塑料模型定格动画风格，机甲模型的注塑塑料质感与刻线渗线细节，可动关节与分件色块，微缩实景布景的手作质感与实物特效材质，战损涂装与掉漆做旧，影棚微距布光，浅景深，玩具比例却按真实尺度打光，",
        promptEn:
            "Gunpla model-kit stop-motion style, injection-molded plastic texture with panel-line inking, articulated joints and separated color parts, handcrafted miniature-set feel with practical-effect materials, battle-damage weathering and chipped paint, studio macro lighting, shallow depth of field, toy scale lit at real-world scale, ",
    },
    {
        id: "figure",
        name: "手办定格",
        nameEn: "Figure stop motion",
        prompt: "手办定格动画风格，PVC 手办的光泽塑胶质感与分色涂装（渐变喷涂、眼膜贴纸、边缘无溢色），粘土人比例的大头可动造型，可见的球形关节，桌面微缩场景与日常道具，环形灯影棚布光，微距浅景深，玩具在桌面上演戏的既视感，",
        promptEn:
            "PVC figure stop-motion style, glossy PVC texture with masked two-tone spray, decal eyes and no paint bleed at edges, nendoroid-proportion big-head articulated design, visible ball joints, desktop miniature scenes with everyday props, ring-light studio setup, macro shallow depth of field, toys acting on a desk, ",
    },
    {
        id: "brick",
        name: "积木定格",
        nameEn: "Brick stop motion",
        prompt: "拼装积木定格动画风格，塑料积木颗粒的锐利棱角与标志性圆凸点，积木小人的圆柱头与卡扣手，全场景由积木颗粒拼成（连火焰和水花都是积木件），高饱和纯色块，影棚均匀布光，微距景深，",
        promptEn:
            "brick-built stop-motion style, sharp-edged plastic bricks with signature round studs, minifigure characters with cylinder heads and clip hands, entire scene assembled from bricks including flames and water splashes, high-saturation solid color blocks, even studio lighting, macro depth of field, ",
    },
    {
        id: "miniature",
        name: "微缩世界",
        nameEn: "Miniature world",
        prompt: "微缩模型世界风格，tilt-shift 移轴摄影，玩具般的微型场景，可见胶合缝、笔刷纹与草粉颗粒，强烈浅景深虚化，斜俯视角，人造暖光布光，超写实微距细节，",
        promptEn:
            "miniature world style, tilt-shift photography, toy-like miniature scenes with visible glue seams, brush strokes and scatter-grass grain, strong shallow depth-of-field blur, oblique high angle, warm artificial lighting, hyper-real macro detail, ",
    },
    {
        id: "storybook",
        name: "绘本",
        nameEn: "Storybook",
        prompt: "温暖手绘绘本插画风格，柔和水彩质感，圆润造型，童话氛围，",
        promptEn: "warm hand-drawn picture-book illustration style, soft watercolor texture, rounded shapes, fairy-tale atmosphere, ",
    },
];
