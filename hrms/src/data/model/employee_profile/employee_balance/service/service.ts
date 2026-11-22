/**
 * Public facade for the employee balance & ledger service.
 * Implementation is split by responsibility into:
 * - `ledger_store.ts` (atomic ledger settlement, inversion & manual adjustments)
 * - `posting_plans.ts` (pure wanted-movement plan builders)
 * - `entry_postings.ts` (entry & payroll run ledger posting orchestration)
 * - `guards.ts` (leave/claim/facts validation guards)
 * - `entitlement_sync.ts` (entitlement sync, late-posting carry sync & retirement)
 */
export { carry, manualAdjustments, settle, undone, type Plan } from './ledger_store.js';
export {
	adhocWanted,
	carriedFor,
	claimLeft,
	claimWanted,
	entitlementPlans,
	leaveWanted,
	payslipWanted,
	type Carried,
	type ClosingRule,
	type Subject
} from './posting_plans.js';
export {
	entriesUndone,
	entryPostings,
	entryRead,
	knownOf,
	runPostings,
	type Known
} from './entry_postings.js';
export {
	assertCashable,
	assertFactsHold,
	assertLeft,
	assertWorked,
	leaveOff,
	leaveShort,
	leaveTaken
} from './guards.js';
export {
	raiseFailure,
	retire,
	syncEntitlements,
	syncLate,
	syncLatePosted,
	writesLedger
} from './entitlement_sync.js';
