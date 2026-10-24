/**
 * A stable id for the lesson open now, for what the reader keeps per lesson (watches, Type along attempts): the
 * lesson file's path under scenes/ without `.json` (`draft/graph-algorithms`, `conditional-probability`), else its
 * title (an uploaded lesson with no path). The title is shown to people; the id survives a retitle.
 */
import { state } from '/state.js';

export function lessonIdFrom(path: string, title: string): string {
    const id = path.replace(/\\/g, '/').replace(/^(.*\/)?scenes\//, '').replace(/^\/+/, '').replace(/\.json$/i, '');
    return id || title;
}

export function lessonId(): string {
    return lessonIdFrom(state.currentSceneSourcePath || '', lessonTitle());
}

/** Keys the lesson's records may still be under, oldest schemes first: its title, and its path before `scenes/` was
 *  stripped from relative paths. Read to move them to lessonId(). */
export function formerLessonKeys(): string[] {
    const id = lessonId();
    return [lessonTitle(), `scenes/${id}`].filter(k => k && k !== id);
}

/** The lesson's title: how records were keyed before they had ids. */
export function lessonTitle(): string {
    return String((state.lessonSpec as {title?: string} | null)?.title ?? '');
}
