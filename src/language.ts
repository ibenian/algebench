// The language the AI talks to the user in: one setting for the chat, every AI call and the voice.
//
// The server keeps no state for it. This module keeps the choice in localStorage and adds it to every same-origin
// /api/ request as the X-AlgeBench-Language header (backend/util/reply_language.py reads it). The language is for
// communication only: the server leaves code, tool calls, refs and saved content in English.
//
// It changes from the Settings popover in the chat toolbar, or when the user asks the chat agent (its set_language
// tool lands in setLanguage).

export const DEFAULT_LANGUAGE = 'English (US)';
export const LANGUAGE_MAX_CHARS = 20;
const HEADER = 'X-AlgeBench-Language';
const STORAGE_KEY = 'algebench.language';

// The most spoken languages and a few more, named in English as the prompts use them; any other can be typed.
export const LANGUAGES: readonly string[] = [
    'English (US)', 'English (UK)', 'Spanish', 'Chinese (Simplified)', 'Hindi', 'Arabic', 'French', 'Bengali',
    'Portuguese', 'Russian', 'Urdu', 'Indonesian', 'German', 'Japanese', 'Turkish', 'Korean', 'Vietnamese',
    'Italian', 'Persian', 'Polish', 'Dutch', 'Swedish', 'Norwegian', 'Finnish', 'Hungarian', 'Hebrew',
];

/** ``raw`` as a language name: trimmed, single-spaced, at most LANGUAGE_MAX_CHARS characters; the default if empty. */
export function cleanLanguage(raw: string | null | undefined): string {
    const text = (raw ?? '').replace(/[^\p{L}\p{N}\s().,'-]/gu, '').replace(/\s+/g, ' ').trim()
        .slice(0, LANGUAGE_MAX_CHARS).trim();
    if (!text) return DEFAULT_LANGUAGE;
    // A typed name that matches a listed one takes its spelling ("turkish" -> "Turkish").
    return LANGUAGES.find(l => l.toLowerCase() === text.toLowerCase()) ?? text;
}

let current = DEFAULT_LANGUAGE;
try { current = cleanLanguage(localStorage.getItem(STORAGE_KEY)); } catch { /* storage blocked: the default */ }
const listeners = new Set<(lang: string) => void>();

export function getLanguage(): string { return current; }

/** Make ``raw`` the language (saved, and sent from the next request on); returns the cleaned name. */
export function setLanguage(raw: string): string {
    const lang = cleanLanguage(raw);
    if (lang === current) return lang;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* not saved; this page still uses it */ }
    listeners.forEach(fn => fn(lang));
    return lang;
}

export function onLanguageChange(fn: (lang: string) => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function isApiRequest(url: string): boolean {
    try {
        const u = new URL(url, location.href);
        return u.origin === location.origin && u.pathname.startsWith('/api/');
    } catch { return false; }
}

// Every API call carries the language, whichever module makes it, so nothing can forget it.
function installLanguageHeader(): void {
    const w = window as Window & { __algebenchLanguageFetch?: boolean };
    if (w.__algebenchLanguageFetch) return;
    w.__algebenchLanguageFetch = true;
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!isApiRequest(url)) return original(input, init);
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        // Header values are Latin-1: a name in another script goes percent-encoded (the server decodes it).
        headers.set(HEADER, encodeURIComponent(current));
        return original(input, { ...init, headers });
    };
}

if (typeof window !== 'undefined' && typeof window.fetch === 'function') installLanguageHeader();
