import { getContext, setContext } from 'svelte';

/**
 * The person-day a surface opened a CREATE sheet for.
 *
 * A `work_days` representation is handed a record and a close, and nothing else — which is exactly
 * right for a record that exists. A board cell with no stored row is a create, and the cell already
 * knows which person and which day it is describing; without this the sheet would open on an empty
 * employment picker for a day the operator just clicked.
 *
 * Getters, not values: the surface owns the state and may move to another cell while mounted, and a
 * context object captured once must read the current one. Same shape as `HR_CREATE_SCOPE`, and for
 * the same reason.
 */
interface DayDraft {
	readonly employmentId: () => string | null;
	readonly date: () => string | null;
}

const HR_DAY_DRAFT = Symbol('norbital_hr.day_draft');

export const setDayDraftContext = (draft: DayDraft): void => {
	setContext(HR_DAY_DRAFT, draft);
};

/** Read the draft. Must be called during component initialisation, like any context read. */
export const getDayDraft = (): DayDraft | undefined =>
	getContext<DayDraft | undefined>(HR_DAY_DRAFT);
