import { nanoid } from "nanoid";

export type PromptCollection = "public" | "author";

export type PromptSource = {
    id: string;
    name: string;
    url: string;
    fallbackUrl?: string;
    homepage: string;
    enabled: boolean;
    builtIn: boolean;
    origin: "wg" | "community";
    collection: PromptCollection;
};

export const PROMPT_REGISTRY_HOMEPAGE = "https://github.com/qxryz/workflowgenerator/tree/wg-prompt-sources/sources";
export const PROMPT_COMMUNITY_UPSTREAM = "https://github.com/yukkcat/image-prompts";
const PROMPT_REGISTRY_SOURCE_BASE = "https://raw.githubusercontent.com/qxryz/workflowgenerator/wg-prompt-sources/sources";

export function createPromptSource(source?: Partial<PromptSource>): PromptSource {
    return {
        id: source?.id?.trim() || nanoid(),
        name: source?.name?.trim() || "新来源",
        url: source?.url?.trim() || "",
        fallbackUrl: source?.fallbackUrl?.trim() || undefined,
        homepage: source?.homepage?.trim() || "",
        enabled: source?.enabled ?? true,
        builtIn: source?.builtIn ?? false,
        origin: source?.origin === "wg" ? "wg" : "community",
        collection: source?.collection === "author" ? "author" : "public",
    };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [
    registrySource("banana-prompt-quicker", "Banana Prompt Quicker", "https://glidea.github.io/banana-prompt-quicker/"),
    registrySource("davidwu-gpt-image2-prompts", "DavidWu GPT Image 2", "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts"),
    registrySource("awesome-gpt-image", "Awesome GPT Image", "https://github.com/ZeroLu/awesome-gpt-image"),
    registrySource("awesome-gpt4o-image-prompts", "Awesome GPT-4o", "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts"),
    registrySource("youmind-gpt-image-2", "YouMind GPT Image 2", "https://github.com/YouMind-OpenLab/awesome-gpt-image-2"),
    registrySource("youmind-nano-banana-pro", "YouMind Nano Banana Pro", "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts"),
];

function registrySource(id: string, name: string, homepage: string): PromptSource {
    return {
        id,
        name,
        url: `${PROMPT_REGISTRY_SOURCE_BASE}/${id}.json`,
        fallbackUrl: `/prompt-sources/${id}.json`,
        homepage,
        enabled: true,
        builtIn: true,
        origin: "wg",
        collection: "public",
    };
}
