import { Clock, Effect } from 'effect';
import type { AutomationApi } from '@norbital-ai/bolt/authoring';
import type { WorkspaceRow } from '../collections/leave_requests/$types.js';
import { reconcileJurisdictionLeave } from '../lib/leave/reconcile.js';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../lib/iso-day.js';

/** Created and updated triggers share one statutory-profile eligibility and reconciliation path. */
export function reconcileStatutoryProfileChange(
	api: AutomationApi,
	profile: WorkspaceRow<'jurisdictions'>
) {
	if (profile.lifecycle !== 'SEALED' || profile.approval_id != null)
		return Effect.succeed({ skipped: true });
	return Effect.flatMap(Clock.currentTimeMillis, (now) =>
		reconcileJurisdictionLeave(
			api,
			profile.code,
			calendarDateInTimeZone(new Date(now), PAYROLL_TIME_ZONE)
		)
	);
}
