import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { Effect } from 'effect';
import { dateKey } from '../../lib/iso-day.js';
import { cents } from '../payroll_runs/lib/rounding.js';
import { settingsInForce } from '../../lib/jurisdiction_settings.js';
import model from './+model.js';

const columns = {
	employment_id: true,
	category: true,
	directive_reference: true,
	amount: true,
	held_on: true,
	released_on: true,
	released_amount: true,
	reconciliation_reference: true,
	evidence_file: true
} as const;
const LIMIT = 20_000;

/** A disbursement hold: validated against its employment's currency and its own release. */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const rows = inputs.map((input, index) => ({ ...existing[index], ...input }));
			const employmentIds = [
				...new Set(rows.flatMap((row) => (row.employment_id == null ? [] : [row.employment_id])))
			];
			const employments =
				employmentIds.length === 0
					? []
					: yield* db.employments.findMany({
							where: { id: { in: employmentIds } },
							columns: { id: true },
							with: { employment_company: { columns: { settings_code: true } } },
							limit: employmentIds.length
						});
			const employmentById = new Map(employments.map((row) => [row.id, row]));
			const settingsCodes = [
				...new Set(
					employments.flatMap((row) => {
						const code = row.employment_company?.settings_code;
						return code == null || code === '' ? [] : [code];
					})
				)
			];
			const versions =
				settingsCodes.length === 0
					? []
					: yield* db.jurisdiction_settings.findMany({
							where: {
								code: { in: settingsCodes },
								sealed_at: { isNotNull: true },
								voided_at: { isNull: true },
								approval_id: { isNull: true }
							},
							columns: {
								id: true,
								code: true,
								payroll: true,
								effective_range: true,
								sealed_at: true,
								voided_at: true
							},
							limit: LIMIT
						});
			for (const row of rows) {
				const employmentId = row.employment_id;
				if (employmentId == null || !employmentById.has(employmentId))
					refuse('A payment hold must reference an employment.');
				if (!String(row.directive_reference ?? '').trim())
					refuse('A payment hold requires the directive reference.');
				const held = dateKey(row.held_on);
				if (held === '') refuse('A payment hold requires the day it was placed.');
				const released = row.released_on == null ? null : dateKey(row.released_on) || null;
				if (row.released_on != null && released == null)
					refuse('A hold release requires a calendar day.');
				if (released != null && released < held)
					refuse('A hold cannot be released before it was placed.');
				const amount = row.amount == null ? null : decodeNumber(row.amount);
				const releasedAmount =
					row.released_amount == null ? null : decodeNumber(row.released_amount);
				for (const [label, value] of [
					['Hold amount', amount],
					['Released amount', releasedAmount]
				] as const) {
					if (value == null) continue;
					if (!Number.isFinite(value) || value < 0)
						refuse(`${label} must be finite and nonnegative.`);
				}
				if (released != null) {
					if (releasedAmount == null) refuse('Releasing a hold requires the amount released.');
					if (!String(row.reconciliation_reference ?? '').trim())
						refuse('Releasing a hold requires the directive that released it.');
					if (amount != null && releasedAmount > amount)
						refuse('The released amount cannot exceed the held amount.');
				} else if (releasedAmount != null || row.reconciliation_reference != null) {
					refuse('A release amount or reference applies only to a released hold.');
				}
				const employment = employmentById.get(employmentId)!;
				const settingsCode = employment.employment_company?.settings_code;
				const version = settingsCode == null ? null : settingsInForce(versions, settingsCode, held);
				const currency = version?.payroll.currency;
				if (currency == null)
					refuse('A payment hold requires sealed jurisdiction settings on the day it was placed.');
				for (const [label, value] of [
					['Hold amount', amount],
					['Released amount', releasedAmount]
				] as const) {
					if (value == null) continue;
					if (cents(value, currency) !== value)
						refuse(`${label} must use the jurisdiction currency precision.`);
				}
			}
			return inputs;
		})
});
