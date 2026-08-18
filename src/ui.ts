// ============================================================
// UI — Built-in Scenes Dropdown, Drag and Drop, File Picker,
// Scenes Dropdown Toggle, and Video Export Controls.
// ============================================================

import { state } from '/state.js';
import { loadLesson, loadScene, stopAutoPlay, showSceneDockScenesTab } from '/scene-loader.js';
import { parseViewState } from '/view-state.js';
import type { LessonSpec } from '/scene-loader.js';

/** `GET /api/scenes` — the built-in scene names, without the .json suffix. */
interface ScenesListResponse {
    scenes?: string[];
}

/** `GET /api/scene_file` — one scene read off disk, plus where it came from. */
interface SceneFileResponse {
    spec?: LessonSpec;
    label?: string;
    path?: string;
}

/** A dropped or picked file. `path` is not a browser File field — it is read
 *  here (and falls back) because the code has always read it. */
type PickedFile = File & { path?: string };

/**
 * getDisplayMedia options. `cursor` and `preferCurrentTab` are non-standard
 * Chromium extensions the DOM lib does not declare, and `preferCurrentTab` is
 * what makes the picker default to this tab — so the bag is typed here rather
 * than dropped.
 */
type TabCaptureOptions = DisplayMediaStreamOptions & {
    video: MediaTrackConstraints & { displaySurface?: string; cursor?: string };
    preferCurrentTab?: boolean;
};

/** One entry of the recorder-format preference list. */
interface RecorderFormat {
    mimeType: string;
    containerMime: string;
    ext: string;
}

// ----- Scene Loading Indicator -----
// Shown while a scene is fetched + parsed. The server derives a semantic
// graph per proof step on load, which can take a few seconds for a large
// lesson, so we surface progress instead of leaving the UI frozen-looking.
// Ref-counted so overlapping loads don't hide it early.
let _sceneLoadingCount = 0;

export function showSceneLoading(): void {
    _sceneLoadingCount++;
    const el = document.getElementById('scene-loading');
    if (el) {
        el.classList.add('active');
        el.setAttribute('aria-busy', 'true');
    }
}

export function hideSceneLoading(): void {
    _sceneLoadingCount = Math.max(0, _sceneLoadingCount - 1);
    if (_sceneLoadingCount > 0) return;
    const el = document.getElementById('scene-loading');
    if (el) {
        el.classList.remove('active');
        el.setAttribute('aria-busy', 'false');
    }
}

// ----- Built-in Scenes Dropdown -----

export async function loadBuiltinScenesList(): Promise<void> {
    try {
        const resp = await fetch('/api/scenes', { cache: 'no-store' });
        const data = await resp.json() as ScenesListResponse;
        // Non-null: #scenes-menu is in index.html; a missing one threw here before.
        const menu = document.getElementById('scenes-menu')!;
        menu.innerHTML = '';
        if (data.scenes && data.scenes.length > 0) {
            for (const name of data.scenes) {
                const item = document.createElement('div');
                item.className = 'scene-item';
                item.textContent = name.replace(/-/g, ' ');
                item.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const ok = await loadBuiltinScene(name);
                    if (ok) showSceneDockScenesTab();
                });
                menu.appendChild(item);
            }
        } else {
            const item = document.createElement('div');
            item.className = 'scene-item';
            item.textContent = '(no scenes available)';
            item.style.opacity = '0.5';
            menu.appendChild(item);
        }
    } catch (e) {
        console.error('Failed to load scenes list:', e);
    }
}

export async function loadBuiltinScene(name: string): Promise<boolean> {
    showSceneLoading();
    try {
        const resp = await fetch('/scenes/' + encodeURIComponent(name), { cache: 'no-store' });
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} loading scene '${name}'`);
        }
        const spec = await resp.json() as LessonSpec;
        state.currentSceneSourceLabel = `${name}.json`;
        state.currentSceneSourcePath = `/scenes/${name}`;
        // Force a full re-init path so selecting from scenes always reloads.
        // Await the full load (importDomains + navigateTo(0,-1)) so callers —
        // notably the deeplink restore in loadInitialSceneFromQuery — don't race
        // a still-in-flight lesson load and get reset to scene 0.
        stopAutoPlay();
        await loadLesson(spec);
        updateSceneUrl({ builtin: name });
        // Non-null: same #scenes-menu the list above populates.
        document.getElementById('scenes-menu')!.classList.remove('open');
        return true;
    } catch (e) {
        console.error('Failed to load scene:', name, e);
        return false;
    } finally {
        hideSceneLoading();
    }
}

export async function loadSceneFromPath(path: string): Promise<void> {
    showSceneLoading();
    try {
        const resp = await fetch('/api/scene_file?path=' + encodeURIComponent(path), { cache: 'no-store' });
        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} loading scene file`);
        }
        const data = await resp.json() as SceneFileResponse | null;
        // `!data.spec` is load-bearing, not redundant with the typeof: `typeof
        // null === 'object'`, so a `{ spec: null }` response used to pass this
        // guard and fail later inside loadLesson() with a much less clear error.
        // This is the one DELIBERATE behaviour change in this PR — see the body.
        if (!data || !data.spec || typeof data.spec !== 'object') {
            throw new Error('Invalid scene payload');
        }
        state.currentSceneSourceLabel = data.label || path.split(/[\\/]/).pop() || path;
        state.currentSceneSourcePath = data.path || path;
        stopAutoPlay();
        await loadLesson(data.spec);
        updateSceneUrl({ path: state.currentSceneSourcePath });
    } finally {
        hideSceneLoading();
    }
}

export function updateSceneUrl(opts: { builtin?: string; path?: string } = {}): void {
    const url = new URL(window.location.href);
    if (opts.builtin) {
        url.searchParams.set('builtin', opts.builtin);
        url.searchParams.delete('scene');
    } else if (opts.path) {
        url.searchParams.set('scene', opts.path);
        url.searchParams.delete('builtin');
    } else {
        url.searchParams.delete('scene');
        url.searchParams.delete('builtin');
    }
    window.history.replaceState({}, '', url.toString());
}

export async function loadInitialSceneFromQuery(): Promise<void> {
    // Capture the FULL deeplink before loading the source — loadBuiltinScene /
    // loadSceneFromPath rewrite the URL (dropping sc/st/etc.) via updateSceneUrl.
    const vs = parseViewState(window.location.search);
    // Any restorable field beyond the source (builtin/scene) means we must
    // re-apply the captured ViewState after the source load rewrites the URL.
    const hasDeeplink = !!(
        vs.view || vs.panel || vs.pp || vs.sc || vs.st || vs.pf || vs.ps ||
        vs.nodes || vs.sliders || vs.cv || vs.proj || Number.isFinite(vs.oz) || vs.cam ||
        vs.aa ||          // a deeplinked auto-ask (e.g. from an embedded proof) must still apply
        vs.pa || Number.isFinite(vs.pas)   // a pre-baked proof to dock (?pa=/?pas=) even without other fields
    );
    const applyRest = async () => {
        if (hasDeeplink && typeof window.applyViewState === 'function') {
            try { await window.applyViewState(vs); } catch (e) { console.error('applyViewState failed:', e); }
        }
    };

    if (vs.builtin) {
        const loaded = await loadBuiltinScene(vs.builtin);
        if (loaded) { await applyRest(); return; }
    }
    if (!vs.scene) {
        showSceneLoading();
        try {
            const res = await fetch('/api/scene', { cache: 'no-store' });
            if (res.ok) {
                const spec = await res.json() as LessonSpec | null;
                if (spec && Array.isArray(spec.scenes) && spec.scenes.length) {
                    await loadLesson(spec);
                    await applyRest();   // apply panel/aa/etc. on the default scene too
                    return;
                }
            }
        } catch {} finally {
            hideSceneLoading();
        }
        loadScene(null);
        await applyRest();   // apply the deeplink even with no scene loaded
        return;
    }
    try {
        await loadSceneFromPath(vs.scene);
        await applyRest();
    } catch (e) {
        console.error('Failed to load initial scene:', vs.scene, e);
        loadScene(null);
    }
}

// ----- Drag and Drop -----

export function setupDragDrop(): void {
    // Non-null: both are in index.html; a missing one threw on addEventListener.
    const viewport = document.getElementById('viewport')!;
    const overlay = document.getElementById('drop-overlay')!;

    viewport.addEventListener('dragover', (e) => {
        e.preventDefault();
        overlay.classList.add('active');
    });

    viewport.addEventListener('dragleave', (e) => {
        // `as Node`: contains() takes a Node and relatedTarget is a typed
        // EventTarget; the truthiness check above is the original guard.
        if (e.relatedTarget && viewport.contains(e.relatedTarget as Node)) return;
        overlay.classList.remove('active');
    });

    viewport.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('active');
        // Non-null: a drop event always carries a dataTransfer.
        const file = e.dataTransfer!.files[0] as PickedFile | undefined;
        if (file && file.name.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    // Non-null + cast: `target` is the reader that fired, and
                    // readAsText below always yields a string result.
                    const spec = JSON.parse(ev.target!.result as string) as LessonSpec;
                    state.currentSceneSourceLabel = file.name || '';
                    state.currentSceneSourcePath = file.path || file.webkitRelativePath || file.name || '';
                    await loadLesson(spec);
                    if (state.currentSceneSourcePath) updateSceneUrl({ path: state.currentSceneSourcePath });
                    showSceneDockScenesTab();
                } catch (err) {
                    console.error('Invalid JSON:', err);
                }
            };
            reader.readAsText(file);
        }
    });
}

// ----- File Picker -----

export function setupFilePicker(): void {
    // Non-null: both are in index.html; a missing one threw on addEventListener.
    const btn = document.getElementById('btn-load')!;
    const input = document.getElementById('file-input') as HTMLInputElement;

    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        // Non-null: `target` is the file input above, so `files` is a list.
        const file = (e.target as HTMLInputElement).files![0] as PickedFile | undefined;
        if (file) {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    // Non-null + cast: as in setupDragDrop above.
                    const spec = JSON.parse(ev.target!.result as string) as LessonSpec;
                    state.currentSceneSourceLabel = file.name || '';
                    state.currentSceneSourcePath = file.path || file.webkitRelativePath || file.name || '';
                    await loadLesson(spec);
                    if (state.currentSceneSourcePath) updateSceneUrl({ path: state.currentSceneSourcePath });
                    showSceneDockScenesTab();
                } catch (err) {
                    console.error('Invalid JSON:', err);
                }
            };
            reader.readAsText(file);
        }
        input.value = '';
    });
}

// ----- Scenes Dropdown Toggle -----

export function setupScenesDropdown(): void {
    // Non-null: both are in index.html; a missing one threw on addEventListener.
    const btn = document.getElementById('btn-scenes')!;
    const menu = document.getElementById('scenes-menu')!;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('open');
    });

    document.addEventListener('click', () => {
        menu.classList.remove('open');
    });
}

// ----- Video Export -----

function pickVideoRecorderFormat(): RecorderFormat | null {
    const webmOptions = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
    ];

    const mp4Options = [
        'video/mp4;codecs=avc3,mp4a.40.2',
        'video/mp4;codecs=h264,aac',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4',
    ];

    const preference = state.videoExportFormatPreference;
    const candidates: { options: string[]; containerMime: string; ext: string }[] = [];
    if (preference === 'webm') {
        candidates.push({ options: webmOptions, containerMime: 'video/webm', ext: 'webm' });
    } else if (preference === 'mp4') {
        candidates.push({ options: mp4Options, containerMime: 'video/mp4', ext: 'mp4' });
    } else {
        candidates.push(
            { options: webmOptions, containerMime: 'video/webm', ext: 'webm' },
            { options: mp4Options, containerMime: 'video/mp4', ext: 'mp4' },
        );
    }

    for (const candidate of candidates) {
        for (const mimeType of candidate.options) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                return {
                    mimeType,
                    containerMime: candidate.containerMime,
                    ext: candidate.ext,
                };
            }
        }
    }
    return null;
}

function sanitizeFilename(name: string): string {
    return (name || 'algebench')
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'algebench';
}

function updateVideoExportFormatUI(): void {
    const selected = state.videoExportFormatPreference;
    const label = document.getElementById('video-export-format-label');
    if (label) label.textContent = `(${selected === 'auto' ? 'Auto' : selected.toUpperCase()})`;
    document.querySelectorAll<HTMLElement>('#video-export-format-menu .toolbar-menu-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.format === selected);
    });
}

function getExportBaseName(): string {
    const title = (state.lessonSpec && state.lessonSpec.title)
        || (state.currentSpec && state.currentSpec.title)
        || 'algebench-export';
    return sanitizeFilename(title);
}

function cleanupVideoRecording(): void {
    if (state.videoRecordingStream) {
        state.videoRecordingStream.getTracks().forEach(track => track.stop());
        state.videoRecordingStream = null;
    }
}

function updateVideoRecordButtonUI(): void {
    const btn = document.getElementById('btn-video-record');
    if (!btn) return;
    updateVideoExportFormatUI();
    if (state.videoRecorder && state.videoRecorder.state === 'recording') {
        btn.classList.add('active');
        btn.title = 'Stop recording';
    } else {
        btn.classList.remove('active');
        btn.title = 'Record current tab video with TTS audio';
    }
}

async function startVideoExport(): Promise<void> {
    const btn = document.getElementById('btn-video-record');
    if (!btn) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || typeof MediaRecorder === 'undefined') {
        alert('Screen recording is not supported in this browser.');
        return;
    }

    try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                displaySurface: 'browser',
                cursor: 'never',
            },
            audio: true,
            preferCurrentTab: true,
        } as TabCaptureOptions);

        const tracks = [...displayStream.getTracks()];
        const getTTSStream = window.algebenchGetTTSAudioStream;
        if (typeof getTTSStream === 'function' && displayStream.getAudioTracks().length === 0) {
            const ttsStream = getTTSStream();
            if (ttsStream) tracks.push(...ttsStream.getAudioTracks());
        }
        const combinedStream = new MediaStream(tracks);
        state.videoRecordingStream = displayStream;

        const selected = pickVideoRecorderFormat();
        if (!selected) throw new Error('No supported recorder format');
        state.videoRecordingMime = selected.containerMime;
        state.videoRecordingExt = selected.ext;

        state.videoRecordedChunks = [];
        state.videoRecorder = new MediaRecorder(combinedStream, {
            mimeType: selected.mimeType,
            videoBitsPerSecond: 3000000,
        });

        state.videoRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) state.videoRecordedChunks.push(event.data);
        };

        state.videoRecorder.onerror = (event) => {
            // `?.` is the ORIGINAL guard, kept verbatim; the cast only reaches
            // the non-standard `error` field MediaRecorder puts on the event.
            const error = (event as Event & { error?: unknown })?.error || event;
            console.error('Video recorder error:', error);
        };

        state.videoRecorder.onstop = () => {
            const blob = new Blob(state.videoRecordedChunks, { type: state.videoRecordingMime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${getExportBaseName()}_${Date.now()}.${state.videoRecordingExt}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            cleanupVideoRecording();
            state.videoRecorder = null;
            updateVideoRecordButtonUI();
        };

        // Non-null: a display-capture stream always carries a video track.
        displayStream.getVideoTracks()[0]!.onended = () => {
            if (state.videoRecorder && state.videoRecorder.state === 'recording') state.videoRecorder.stop();
        };

        state.videoRecorder.start(150);
        updateVideoRecordButtonUI();
    } catch (err) {
        cleanupVideoRecording();
        state.videoRecorder = null;
        updateVideoRecordButtonUI();
        console.error('Video export failed:', err);
        alert('Failed to start video export. Select the current browser tab when prompted.');
    }
}

export function setupVideoExportControls(): void {
    const btn = document.getElementById('btn-video-record');
    const menu = document.getElementById('video-export-format-menu');
    if (!btn || !menu) return;

    updateVideoRecordButtonUI();

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.videoRecorder && state.videoRecorder.state === 'recording') {
            state.videoRecorder.stop();
            return;
        }
        menu.classList.toggle('open');
    });

    menu.querySelectorAll<HTMLElement>('.toolbar-menu-item').forEach((item) => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            state.videoExportFormatPreference = item.dataset.format || 'auto';
            updateVideoRecordButtonUI();
            menu.classList.remove('open');
            await startVideoExport();
        });
    });

    document.addEventListener('click', () => {
        menu.classList.remove('open');
    });
}
