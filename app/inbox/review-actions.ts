'use server';

import { revalidatePath } from 'next/cache';
import { requireTrackerSession } from '../../lib/auth/session';

export type ReviewDecision = 'save' | 'reject';
export type ReviewMutationResult =
  | { ok: true; decisionId: string; previousDecision: ReviewDecision | null }
  | { ok: false; error: string };
export type ReviewInput = { id: string; revision: number; decision: ReviewDecision };
export type UndoReviewInput = {
  id: string;
  revision: number;
  expectedDecision: ReviewDecision;
  previousDecision: ReviewDecision | null;
  expectedDecisionId: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDecision = (value: unknown): value is ReviewDecision => value === 'save' || value === 'reject';
const validTarget = (input: { id?: unknown; revision?: unknown } | null | undefined) => Boolean(
  input && typeof input.id === 'string' && uuid.test(input.id)
  && typeof input.revision === 'number' && Number.isInteger(input.revision) && input.revision >= 1 && input.revision <= 2147483647,
);
const failure = (code?: string): ReviewMutationResult => ({
  ok: false,
  error: code === '40001' ? 'This item changed. Refresh it before reviewing again.'
    : code === '42501' ? 'You don’t have access to review this item.'
    : 'That change couldn’t be saved. Please try again.',
});

export async function reviewOccurrence(input: ReviewInput): Promise<ReviewMutationResult> {
  if (!validTarget(input) || !isDecision(input?.decision)) return { ok: false, error: 'Choose an item and a valid review action.' };
  let session;
  try { session = await requireTrackerSession(); }
  catch { return { ok: false, error: 'Sign in again to keep reviewing.' }; }
  try {
    const { data, error } = await session.supabase.rpc('record_review_decision', {
      p_occurrence_id: input.id, p_action: input.decision, p_expected_revision: input.revision,
    });
    if (error) return failure(error.code);
    if (!data || typeof data.decision_id !== 'string' || !uuid.test(data.decision_id)
      || !(data.previous_decision === null || isDecision(data.previous_decision))) return failure();
    revalidatePath('/inbox');
    return { ok: true, decisionId: data.decision_id, previousDecision: data.previous_decision };
  } catch { return failure(); }
}

export async function undoReviewOccurrence(input: UndoReviewInput): Promise<ReviewMutationResult> {
  if (!validTarget(input) || !isDecision(input?.expectedDecision)
    || !(input?.previousDecision === null || isDecision(input?.previousDecision))
    || typeof input?.expectedDecisionId !== 'string' || !uuid.test(input.expectedDecisionId)) {
    return { ok: false, error: 'This review can’t be undone. Refresh the item and try again.' };
  }
  let session;
  try { session = await requireTrackerSession(); }
  catch { return { ok: false, error: 'Sign in again to keep reviewing.' }; }
  try {
    const { data, error } = await session.supabase.rpc('restore_review_decision', {
      p_occurrence_id: input.id, p_expected_revision: input.revision,
      p_expected_action: input.expectedDecision, p_previous_action: input.previousDecision,
      p_expected_decision_id: input.expectedDecisionId,
    });
    if (error) return failure(error.code);
    if (typeof data !== 'string' || !uuid.test(data)) return failure();
    revalidatePath('/inbox');
    return { ok: true, decisionId: data, previousDecision: input.previousDecision };
  } catch { return failure(); }
}
