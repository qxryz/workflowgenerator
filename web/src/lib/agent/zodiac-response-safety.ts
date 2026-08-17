/**
 * Detects a reply that presents a canvas mutation as the next/current action but
 * did not include an executable proposal. This is intentionally narrow so normal
 * product explanations remain untouched.
 */
export function claimsUnexecutedCanvasAction(text: string) {
    const compact = text.replace(/\s+/gu, " ").trim();
    if (!compact) return false;
    return /(?:我(?:现在|马上|这就|接下来)?(?:会|将|把|来)?|现在|接下来|下面).{0,32}(?:添加|加入|创建|新建|搭建|连接|放到|写入|生成).{0,20}(?:画布|节点|工作流)|(?:已|已经|刚刚).{0,12}(?:添加|加入|创建|新建|搭建|连接|放到|写入).{0,20}(?:画布|节点|工作流)|(?:开始搭建|开始创建|开始添加).{0,12}(?:画布|节点|工作流)|操作指令\s*(?:如下|[:：↓])/u.test(compact);
}
