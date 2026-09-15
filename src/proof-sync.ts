interface SceneLinkedStep {
    sceneStep?: number | string;
}

interface SceneLinkedProofEntry {
    sceneIndex?: number;
    /** Where the proof is declared: mirrors ProofEntry in proof.ts. */
    level?: string;
    /** For a step-level entry, the step it is declared on. */
    stepIndex?: number;
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
    // The bare-number form is SCENE-SCOPED: it means "step N of the scene this
    // proof belongs to". A root-level entry has no scene, so a number on one
    // would mean "step N of any scene" -- and would take the active proof away
    // from the scene-scoped proof that actually links there, in every scene
    // that happens to reach the same step number. docs/proofs-model.md 6.1 is
    // explicit that a root-level link uses the "sceneIdx:stepIdx" form, which
    // is handled above; a number here is outside the contract, so it matches
    // nothing rather than matching everywhere.
    const targetStep = Number(target);
    return !Number.isNaN(targetStep)
        && entry.sceneIndex != null
        && entry.sceneIndex === sceneIndex
        && targetStep === stepIndex;
}

/**
 * Can the learner see this proof at this position? The same question
 * `_isProofInContext` asks in proof.ts, asked here because the sync matcher
 * gets the WHOLE spec: without it a proof declared on a later step could be
 * matched and switched to before the learner has reached it.
 *
 * An entry with no `level` is not judged -- the field is optional on this
 * interface, and a caller that does not supply it (a test fixture, an expert's
 * proof arriving unvalidated) should keep the old behaviour rather than have
 * every one of its proofs silently filtered out.
 */
export function isEntryVisible(entry: SceneLinkedProofEntry, sceneIndex: number, stepIndex: number): boolean {
    if (entry.level == null) return true;
    if (entry.level === 'file') return true;
    if (entry.level === 'scene') return entry.sceneIndex === sceneIndex;
    if (entry.level === 'step') {
        return entry.sceneIndex === sceneIndex && (entry.stepIndex ?? 0) <= stepIndex;
    }
    return false;
}

/** Find the proof position linked to a scene step, preferring the active proof. */
export function findProofSceneStepMatch(
    entries: SceneLinkedProofEntry[],
    activeProofIndex: number,
    sceneIndex: number,
    stepIndex: number,
): ProofSceneStepMatch | null {
    const orderedIndexes = entries
        .map((_, index) => index)
        .filter(index => isEntryVisible(entries[index]!, sceneIndex, stepIndex));
    const activePos = orderedIndexes.indexOf(activeProofIndex);
    if (activePos > 0) {
        orderedIndexes.splice(activePos, 1);
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
