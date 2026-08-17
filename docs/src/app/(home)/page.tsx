import Link from "next/link";
import { BookOpen, Rocket } from "lucide-react";
import { appName, gitConfig } from "@/lib/shared";

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
const starHistoryUrl = `https://www.star-history.com/?repos=${gitConfig.user}%2F${gitConfig.repo}&type=date`;
const starHistoryChart = `https://api.star-history.com/chart?repos=${gitConfig.user}/${gitConfig.repo}&type=date&transparent=true`;
const darkStarHistoryChart = `${starHistoryChart}&theme=dark`;

const features = [
  ["工作流画布", "组合文本、媒体、模型与终端节点，保存并复用完整流程。"],
  ["创作工作台", "集中处理图片、视频、音频、Seedance 2.5 与 3D 分镜。"],
  ["Zodiac", "从目标生成可确认的工作流，并按节点运行、检查和继续调整。"],
  ["本地资产库", "统一保存提示词、Skills、生成结果和作者分享的私藏内容。"],
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-8 md:px-10 md:pt-14">
      <section className="grid min-h-[520px] items-center gap-12 border-b border-zinc-200 pb-12 dark:border-zinc-800 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Rocket className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            本地 AI 创作工具箱
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 md:text-6xl [font-family:var(--font-display)]">
            {appName}
            <span className="block text-zinc-500 dark:text-zinc-400">
              文档中心
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 dark:text-zinc-400">
            把工作流画布、AI 创作、Zodiac、提示词、Skills
            和本地资产放进同一个桌面工具箱。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs/overview/quick-start"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <BookOpen className="size-4" />
              快速开始
            </Link>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
            >
              <img src="/github.svg" alt="" className="size-4" />
              GitHub
            </a>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {features.map(([title, description]) => (
            <div
              key={title}
              className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50"
            >
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 w-full max-w-4xl text-center">
        <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
          开发贡献者
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          感谢所有为本项目做出贡献的开发者
        </p>
        <div className="mt-7 flex justify-center">
          <a
            href={`${githubUrl}/graphs/contributors`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex max-w-full"
          >
            <img
              src={`https://contrib.rocks/image?repo=${gitConfig.user}/${gitConfig.repo}`}
              alt="开发贡献者头像"
              loading="lazy"
              decoding="async"
              className="max-w-full"
            />
          </a>
        </div>
      </section>

      <section className="mx-auto mt-16 w-full max-w-5xl text-center">
        <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
          Star History
        </h2>
        <div className="mt-7 flex justify-center">
          <a
            href={starHistoryUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="block w-full max-w-4xl"
          >
            <picture>
              <source
                media="(prefers-color-scheme: dark)"
                srcSet={darkStarHistoryChart}
              />
              <source
                media="(prefers-color-scheme: light)"
                srcSet={starHistoryChart}
              />
              <img
                src={starHistoryChart}
                alt="Star History Chart"
                loading="lazy"
                decoding="async"
                className="mx-auto w-full"
              />
            </picture>
          </a>
        </div>
      </section>
    </main>
  );
}
