/** Camera-relative stack inspection; one pointer listener per canvas. */
import type { Camera, Mesh } from 'three';

export function stackCellOpacities(depths: number[], selected: number | null): number[] {
    if (selected === null || !Number.isInteger(selected) || selected < 0 || selected >= depths.length) return depths.map(() => 1);
    const depth = depths[selected]!;
    return depths.map(value => value < depth - 1e-6 ? 0.2 : 1);
}

type Entry = { mesh: Mesh; visible(): boolean; select(index: number | null): void };
const managers = new WeakMap<HTMLElement, { entries: Set<Entry>; dispose(): void }>();
export function registerStackHover(canvas: HTMLElement, camera: () => Camera | null, entry: Entry): () => void {
    let manager = managers.get(canvas);
    if (!manager) {
        const entries = new Set<Entry>(), controller = new AbortController();
        const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
        let pending = 0, last: { x: number; y: number } | null = null;
        const clear = () => { last = null; if (pending) cancelAnimationFrame(pending); pending = 0; for (const item of entries) item.select(null); };
        canvas.addEventListener('pointermove', event => {
            if (event.buttons) { clear(); return; }
            last = { x: event.clientX, y: event.clientY };
            if (pending) return;
            pending = requestAnimationFrame(() => {
                pending = 0;
                const view = camera();
                if (!last || !view) { clear(); return; }
                const rect = canvas.getBoundingClientRect();
                pointer.set((last.x - rect.left) / rect.width * 2 - 1, 1 - (last.y - rect.top) / rect.height * 2);
                raycaster.setFromCamera(pointer, view);
                const visible = [...entries].filter(item => item.visible());
                const hit = raycaster.intersectObjects(visible.map(item => item.mesh), false)[0];
                for (const item of entries) item.select(hit?.object === item.mesh && hit.faceIndex != null ? Math.floor(hit.faceIndex / 12) : null);
            });
        }, { passive: true, signal: controller.signal });
        canvas.addEventListener('pointerleave', clear, { passive: true, signal: controller.signal });
        canvas.addEventListener('pointerdown', clear, { passive: true, signal: controller.signal });
        manager = { entries, dispose() { clear(); controller.abort(); managers.delete(canvas); } };
        managers.set(canvas, manager);
    }
    manager.entries.add(entry);
    const owner = manager;
    return () => { entry.select(null); owner.entries.delete(entry); if (!owner.entries.size) owner.dispose(); };
}
