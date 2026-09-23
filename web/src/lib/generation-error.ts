/** Only explicit evidence may unlock a paid generation retry. Missing codes stay uncertain. */
export type GenerationFailureCode = "GENERATION_NOT_SUBMITTED" | "GENERATION_REJECTED";

export class GenerationError extends Error {
    readonly code: GenerationFailureCode;
    constructor(message: string, code: GenerationFailureCode = "GENERATION_NOT_SUBMITTED") {
        super(message);
        this.name = "GenerationError";
        this.code = code;
    }
}

export function generationFailureCode(error: unknown): GenerationFailureCode | undefined {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return code === "GENERATION_NOT_SUBMITTED" || code === "GENERATION_REJECTED" ? code : undefined;
}

/** Preserve proof when an adapter rewrites an error for display. */
export function generationErrorWithMessage(error: unknown, message: string): Error {
    const code = generationFailureCode(error);
    return code ? new GenerationError(message, code) : new Error(message);
}

/** A batch is definitive only when every failed request is definitive. */
export function generationBatchError(errors: readonly unknown[]): Error {
    const uncertain = errors.findIndex(error => !generationFailureCode(error));
    const first = errors[uncertain < 0 ? 0 : uncertain];
    return generationErrorWithMessage(first, first instanceof Error ? first.message : "生成失败");
}
