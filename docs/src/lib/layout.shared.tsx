import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { appName, gitConfig } from "./shared";

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <img src="/logo.svg" alt={appName} className="h-6 w-6" />
          <span>{appName}</span>
        </span>
      ),
    },
    links: [
      {
        text: "文档导航",
        url: "/docs/overview/quick-start",
        on: "nav",
      },
      {
        type: "icon",
        text: "GitHub",
        label: "GitHub",
        url: githubUrl,
        external: true,
        on: "menu",
        icon: <img src="/github.svg" alt="" className="size-4" />,
      },
    ],
  };
}
