interface SceneLinkedStep {
    sceneStep?: number | string;
}

interface SceneLinkedProofEntry {
    sceneIndex?: number;
    proof: SceneLinkedStep & { steps?: SceneLinkedStep[] };
}

export interface ProofSceneStepMatch {
    proofIndex: number;
    stepIndex: number;
}

function matchesSceneStep(
    entry: SceneLinkedProofEntry,
    target: number | string | undefined,
    sceneIndex: number,
    stepIndex: number,
): boolean {
    if (target == null) return false;
    if (typeof target === 'string' && target.includes(':')) {
        const [sceneToken, stepToken] = target.split(':');
        const targetScene = Number(sceneToken);
        const targetStep = Number(stepToken);
        return !Number.isNaN(targetScene) && !Number.isNaN(targetStep)
            && targetScene === sceneIndex && targetStep === stepIndex;
    }
    const targetStep = Number(target);
    return !Number.isNaN(targetStep)
        && (entry.sceneIndex == null || entry.sceneIndex === sceneIndex)
        && targetStep === stepIndex;
}

/** Find the proof position linked to a scene step, preferring the active proof. */
export function findProofSceneStepMatch(
    entries: SceneLinkedProofEntry[],
    activeProofIndex: number,
    sceneIndex: number,
    stepIndex: number,
): ProofSceneStepMatch | null {
    const orderedIndexes = entries.map((_, index) => index);
    if (activeProofIndex >= 0 && activeProofIndex < entries.length) {
        orderedIndexes.splice(activeProofIndex, 1);
        orderedIndexes.unshift(activeProofIndex);
    }

    // A proof-step link is the most precise match.
    for (const proofIndex of orderedIndexes) {
        const steps = entries[proofIndex]!.proof.steps || [];
        const matchedStep = steps.findIndex(step =>
            matchesSceneStep(entries[proofIndex]!, step.sceneStep, sceneIndex, stepIndex));
        if (matchedStep >= 0) return { proofIndex, stepIndex: matchedStep };
    }

    // Proof-level links land on the goal when no individual step is linked.
    for (const proofIndex of orderedIndexes) {
        if (matchesSceneStep(
            entries[proofIndex]!,
            entries[proofIndex]!.proof.sceneStep,
            sceneIndex,
            stepIndex,
        )) {
            return { proofIndex, stepIndex: -1 };
        }
    }

    return null;
}
