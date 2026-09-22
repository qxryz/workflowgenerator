/** Keep the selected workspace and every workspace that still owns live work. */
export function retainedZodiacWorkspaces(current: string[], selected: string | null, work: Record<string, Record<string, boolean>>) {
    return [...new Set([...current, ...(selected ? [selected] : [])])].filter((id) => id === selected || Object.values(work[id] || {}).some(Boolean));
}
