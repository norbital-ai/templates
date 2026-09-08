import { refuse } from '@norbital-ai/bolt/authoring';
import { leaveRules, type LeaveContext } from './context.js';
import { leaveWindowOf } from './entitlement.js';
import { leaveBalanceAt } from './balance.js';
import { settingsInForce } from '../jurisdiction_settings.js';
import { dateKey } from '../iso-day.js';

/** Current catalogue rules plus dated manual activity; nothing is materialised for a new year. */
export function leaveBalanceSummaries(context: LeaveContext, employmentId: string, asOf: string) {
	const employment = context.employments.find((row) => row.id === employmentId);
	if (!employment) refuse('Leave balances require an approved employment.');
	const company = context.companies.find((row) => row.id === employment.company_id);
	if (!company) refuse('The employing company is not available.');
	const through =
		employment.exit_date == null ? asOf : [asOf, dateKey(employment.exit_date)].toSorted()[0]!;
	const version = settingsInForce(context.versions, company.settings_code, through);
	if (!version) refuse(`No sealed settings cover ${through}.`);
	return context.catalogues
		.filter((row) => row.settings_id === version.id)
		.toSorted((a, b) => a.code.localeCompare(b.code))
		.map((catalogue) => {
			const rules = leaveRules(context, employmentId, catalogue.id);
			const window = leaveWindowOf(through, catalogue.entitlement.year_start_month);
			const entries = context.entries.filter(
				(row) => row.employment_id === employmentId && row.leave_code === catalogue.code
			);
			const entitlement = rules.entitlementAt(window, asOf);
			const summary = leaveBalanceAt({
				entries,
				window,
				date: asOf,
				entitlementAt: rules.entitlementAt
			});
			return {
				catalogue_id: catalogue.id,
				code: catalogue.code,
				name: catalogue.name,
				window,
				entitlement: entitlement.entitlement,
				earned: entitlement.earned,
				...summary
			};
		});
}
export type LeaveBalanceSummaries = ReturnType<typeof leaveBalanceSummaries>;
