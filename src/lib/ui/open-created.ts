import { openRecord, type Outcome } from '@norbital-ai/ui';
/** A record view's `onOutcome`: a create opens the record it committed or submitted for approval; an update stays where it is. */
export const openCreated =
	(view: { readonly collection: string; readonly mode: 'create' | 'update' }) =>
	(outcome: Outcome): void => {
		const created =
			outcome.kind === 'committed' || outcome.kind === 'pendingApproval'
				? outcome.records.find((r) => r.collection === view.collection)
				: undefined;
		if (view.mode === 'create' && created != null) openRecord(view.collection, created.id);
	};
