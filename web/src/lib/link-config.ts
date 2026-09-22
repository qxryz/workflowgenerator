import { normalizeCredentialUrl } from "@/lib/secure-url";

export type LinkedConfig = {
    hadParams: boolean;
    hadApiKey: boolean;
    baseUrl?: string;
    invalidBaseUrl: boolean;
    cleanedSearch: string;
};

export function readLinkedConfig(search: string): LinkedConfig {
    const params = new URLSearchParams(search);
    const rawBaseUrl = params.get("baseUrl") || params.get("baseurl") || "";
    const hadApiKey = params.has("apiKey") || params.has("apikey");
    const hadParams = Boolean(rawBaseUrl) || hadApiKey;

    params.delete("baseUrl");
    params.delete("baseurl");
    params.delete("apiKey");
    params.delete("apikey");

    let baseUrl: string | undefined;
    let invalidBaseUrl = false;
    if (rawBaseUrl) {
        try {
            baseUrl = normalizeCredentialUrl(rawBaseUrl);
        } catch {
            invalidBaseUrl = true;
        }
    }

    return { hadParams, hadApiKey, baseUrl, invalidBaseUrl, cleanedSearch: params.toString() };
}
