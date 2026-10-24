/**
 * A code file's teaching structure (codeFiles[].sections): consecutive line ranges, each a step of the idea
 * with a short title, an optional hint that stands without the code, and an optional tutor prompt. The Code
 * panel paints them (the structure modes in its title bar) and the tutor answers about a section rather than loose lines; a later
 * write-and-reveal mode will show the titles and hints first and the code one section at a time.
 */
import type { CodeFile } from '/types/lesson.js';
import type { CodePrompt } from '/code-prompts.js';

export type CodeSection = NonNullable<CodeFile['sections']>[number];

/** How the panel shows the code, from least structured to most: plain code, titles over the code, titles over
 *  blocks the size of the hidden code, or titles only. */
export type StructureMode = 'plain' | 'code' | 'blocks' | 'outline';
export const STRUCTURE_MODES: StructureMode[] = ['plain', 'code', 'blocks', 'outline'];

/**
 * The sections a file can show, in line order: ranges clipped to the file, and any that is inverted, outside
 * it, or overlapping the one before it left out (an author's slip should hide a section, not break the panel).
 */
export function codeSections(file: Pick<CodeFile, 'sections' | 'source'>): CodeSection[] {
    const count = file.source.split('\n').length;
    const out: CodeSection[] = [];
    for (const s of [...(file.sections ?? [])].sort((a, b) => a.from - b.from)) {
        const to = Math.min(s.to, count);
        if (!Number.isInteger(s.from) || !Number.isInteger(s.to) || s.from < 1 || s.from > to) continue;
        if (out.length && s.from <= out[out.length - 1]!.to) continue;
        out.push(to === s.to ? s : {...s, to});
    }
    return out;
}

/** The section holding a line, or null. */
export function sectionAt(sections: CodeSection[], line: number): CodeSection | null {
    return sections.find(s => line >= s.from && line <= s.to) ?? null;
}

/** The structure as the tutor reads it: one line per section, its range and title. */
export function sectionsOutline(sections: CodeSection[]): string {
    return sections.map(s => `${s.from === s.to ? `line ${s.from}` : `lines ${s.from}–${s.to}`}: ${s.title}`).join('\n');
}

/** What the tutor is asked about one section: its own prompt, else a general one built from its title. */
export function sectionPrompt(section: CodeSection): CodePrompt {
    return {label: section.title, prompt: section.prompt ?? `Explain the section "${section.title}" of this code: what it achieves, why the code needs it at this point, and how it does it, using the values on screen right now.`};
}
