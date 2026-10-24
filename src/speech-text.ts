/**
 * Text for speech. Chat replies are markdown with LaTeX; read aloud verbatim, the voice pronounces the markup
 * ("asterisk asterisk", "dollar"), so speech gets the words only. The model also sometimes writes a tool call
 * into its reply as a processing-instruction tag (`<?set_preset_prompts prompts=[...] ?>`) instead of calling
 * the tool: the chat bubble hides it as HTML, but speech would read it, so it is removed (and can be honoured).
 */

// Both spellings the model has used: `<?name args ?>` and `<call:name args />`.
const INLINE_TOOL = /<\?\s*([a-z_]+)\b([\s\S]*?)\?>|<call:([a-z_]+)\b([\s\S]*?)\/?>/gi;

/** A tool call the model wrote into its text, and the text without it. */
export interface InlineToolCall { name: string; args: Record<string, unknown> }

/** Pull `<?name key=json ...?>` tags out of a reply. Arguments that are not valid JSON are dropped. */
export function extractInlineToolCalls(text: string): {text: string; calls: InlineToolCall[]} {
    const calls: InlineToolCall[] = [];
    const cleaned = text.replace(INLINE_TOOL, (_, piName: string | undefined, piBody: string | undefined, callName: string | undefined, callBody: string | undefined) => {
        const name = (piName ?? callName)!, body = piBody ?? callBody ?? '';
        const args: Record<string, unknown> = {};
        for (const m of body.matchAll(/([a-z_]+)\s*=\s*(\[[\s\S]*?\](?=\s*(?:[a-z_]+\s*=|$))|"(?:[^"\\]|\\.)*"|[^\s]+)/gi)) {
            try { args[m[1]!] = JSON.parse(m[2]!); } catch { /* not JSON: leave it out */ }
        }
        calls.push({name, args});
        return '';
    });
    return {text: cleaned.replace(/[ \t]+\n/g, '\n').trim(), calls};
}

/** Plain words for a markdown + LaTeX reply. */
export function speechText(text: string): string {
    return extractInlineToolCalls(text).text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')                  // links: their label
        .replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g, (_, a, b, c) => speechMath(a ?? b ?? c))
        .replace(/`([^`]+)`/g, '$1')                               // inline code: its text
        .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\W)[*_]([^*_\n]+)[*_](?=\W|$)/g, '$1$2')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*>\s?/gm, '')
        .replace(/[📍🤖👤]/gu, '')
        // A line break is a pause: end an unpunctuated line (a heading, a list item) with a full stop.
        .replace(/([^.!?:;,\s])[ \t]*\n+\s*/g, '$1. ').replace(/\s*\n+\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

const MATH_WORDS: Record<string, string> = {
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', times: '×', cdot: '·', to: '→', rightarrow: '→',
    approx: '≈', infty: 'infinity', pm: '±', ldots: '…', dots: '…', cdots: '…',
};
/** Inline math as readable symbols: `74 > 73`, `\text{total} = 18` → `total = 18`. */
function speechMath(tex: string): string {
    return tex
        .replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^}]*)\}/g, '$1')
        .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1 over $2')
        .replace(/\\([a-zA-Z]+)/g, (_, w: string) => MATH_WORDS[w] ?? w)
        .replace(/[{}]/g, '')
        .trim();
}
