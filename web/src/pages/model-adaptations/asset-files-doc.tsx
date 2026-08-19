const PREVIEW_TYPES = [
    { label: "图片", formats: "JPG、PNG、WebP、GIF、AVIF", behavior: "显示为图片节点，可直接预览并用于现有图片工作流。" },
    { label: "视频", formats: "MP4、WebM、MOV", behavior: "显示为视频节点，可直接播放并用于现有视频工作流。" },
    { label: "音频", formats: "MP3、M4A、WAV、OGG、FLAC", behavior: "显示为音频节点，可直接播放并用于现有音频工作流。" },
    { label: "其他文件", formats: "不限扩展名", behavior: "显示为文件节点，可保存、下载、导出和交给终端处理。" },
];

const COMMON_FILES = [
    { label: "文档", examples: "PDF、Word、PowerPoint、RTF、OpenDocument、EPUB" },
    { label: "表格与数据", examples: "Excel、CSV、TSV、JSON、JSONL、YAML、XML、TOML、数据库文件" },
    { label: "文本与代码", examples: "TXT、Markdown、日志，以及常见前端、Python、Rust、Go、Java 等源码" },
    { label: "压缩包", examples: "ZIP、7Z、RAR、TAR、GZ 等" },
    { label: "3D 与设计", examples: "OBJ、FBX、STL、GLTF、GLB、Blend、PSD、AI、Figma、Sketch 等" },
    { label: "未知格式", examples: "没有扩展名或尚未识别的文件也会作为普通文件保留" },
];

export function AssetFilesDoc() {
    return (
        <article className="mb-10 max-w-[820px]" aria-label="资产与文件">
            <div className="mb-7 border-b border-[#e7eaed] pb-6 dark:border-slate-700">
                <div className="mb-3 text-[12px] text-[#7d8790] dark:text-slate-400">参考 / 资产与文件</div>
                <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-[#182027] dark:text-white">资产与文件</h2>
                <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[#65717a] dark:text-slate-300">
                    文件不需要先转换格式。把它导入“我的资产”、拖进画布，或交给终端节点即可；应用会按能力选择原生媒体节点或通用文件节点。
                </p>
            </div>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">可以导入什么</h3>
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b border-[#e0e5e8] text-left dark:border-slate-700">
                                <th className="py-2.5 pr-4 font-semibold text-[#45525b] dark:text-slate-300">类型</th>
                                <th className="py-2.5 pr-4 font-semibold text-[#45525b] dark:text-slate-300">应用内预览格式</th>
                                <th className="py-2.5 font-semibold text-[#45525b] dark:text-slate-300">导入后</th>
                            </tr>
                        </thead>
                        <tbody>
                            {PREVIEW_TYPES.map((item) => (
                                <tr key={item.label} className="border-b border-[#edf0f2] align-top dark:border-slate-800">
                                    <td className="w-28 py-3 pr-4 font-medium text-[#34414a] dark:text-slate-200">{item.label}</td>
                                    <td className="w-56 py-3 pr-4 text-[#52616a] dark:text-slate-300">{item.formats}</td>
                                    <td className="py-3 leading-6 text-[#52616a] dark:text-slate-300">{item.behavior}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="mt-3 text-[13px] leading-6 text-[#65717a] dark:text-slate-300">
                    “可以导入”不等于“已经能在应用内预览或理解内容”。不在原生媒体清单中的格式会完整保留，但当前只显示文件信息，不自动解析正文、表格、压缩包或模型结构。
                </p>
            </section>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">常见文件范围</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {COMMON_FILES.map((item) => (
                        <div key={item.label} className="rounded-lg border border-[#e0e5e8] bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                            <div className="text-[14px] font-semibold text-[#24313a] dark:text-slate-100">{item.label}</div>
                            <p className="mt-1.5 text-[13px] leading-6 text-[#52616a] dark:text-slate-300">{item.examples}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="mb-9">
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">三种使用方式</h3>
                <ol className="mt-4 space-y-3 text-[14px] leading-7 text-[#52616a] dark:text-slate-300">
                    <li><span className="font-semibold text-[#24313a] dark:text-slate-100">我的资产：</span>点击“导入 → 导入文件”可一次选择多个文件；资产包的导入与导出仍在同一个菜单中。</li>
                    <li><span className="font-semibold text-[#24313a] dark:text-slate-100">工作流画布：</span>从文件选择器导入，或直接把文件拖到画布。受支持的媒体使用对应节点，其他格式自动成为文件节点。</li>
                    <li><span className="font-semibold text-[#24313a] dark:text-slate-100">终端节点：</span>把文件节点连到终端后，输入副本位于 <code className="rounded bg-[#f1f4f6] px-1.5 py-0.5 font-mono text-[12px] dark:bg-slate-800">$WG_INPUT_DIR</code>。终端写入 <code className="rounded bg-[#f1f4f6] px-1.5 py-0.5 font-mono text-[12px] dark:bg-slate-800">$WG_OUTPUT_DIR</code> 的文件会回到画布；写在工作目录时，用 <code className="rounded bg-[#f1f4f6] px-1.5 py-0.5 font-mono text-[12px] dark:bg-slate-800">wg-output "./文件名"</code> 明确交付。</li>
                </ol>
            </section>

            <section>
                <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#1b2730] dark:text-white">保存与安全</h3>
                <ul className="mt-4 space-y-2 text-[14px] leading-7 text-[#52616a] dark:text-slate-300">
                    <li>导入后使用应用自己的本机副本；移动或删除原文件不会让已保存的资产失效。</li>
                    <li>文件节点不会自动运行脚本、网页或可执行文件。下载或交给终端处理前，文件仍保持原始内容。</li>
                    <li>终端只接收与它直接相连的文件；普通工作目录中的未知文件不会被自动收进画布，除非放入输出目录或使用 wg-output 明确交付。</li>
                    <li>资产包、画布导出与 WebDAV 同步会在容量限制内一并携带文件内容；当前资产包导入的包体上限、WebDAV 的单文件上限均为 256 MB。</li>
                </ul>
            </section>
        </article>
    );
}
