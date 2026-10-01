import { collection } from '@norbital-ai/bolt';
import {
	catalogueCodes,
	refuseUnknownAssessedOnMentions,
	schemeFault
} from '../../../lib/catalogue_rules.js';
import { refuseUnlessDraftOnBoth, versionsById } from '../../../lib/settings_seal.js';
import { readAll } from '../../../lib/reads.js';
import { plain } from '../../../lib/wire.js';
import {
	orderSchemes,
	producedMentions,
	producedMentionsOf
} from '../../../lib/payroll/run/mentions.js';
import { compileExpression, type DeclaredKey } from '../../../lib/expressions/compile.js';
import type { ContributionRule } from '../../../lib/datatypes/contribution_rules.js';
import { getErrorMessage } from '../../../lib/refuse.js';

/**
 * Statutory schemes are rows of one jurisdiction settings version and are sealed with it: a scheme of a sealed
 * version refuses create and update, because a rule a paid run was charged under cannot be rewritten. A change
 * of law is a new version. While the version is a draft the transform also holds the dependency contract: every
 * expression compiles, every `code(...)` names a catalogue row of the version, every `produced.<code>` names a
 * scheme of it, and the mentions close no loop. A scheme another scheme still reads stays (the delete guard);
 * deleting under a seal is refused by the grant (`DRAFT_SETTINGS_ROW`).
 */
const c = collection('statutory_contributions', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'settings_id',
				'code',
				'name',
				'authority',
				'assessment_period',
				'late_line_month',
				'assessment_scope',
				'remittance_rounding',
				'remittance_rounding_when',
				'unregistered_action',
				'registration_subject',
				'opening_scope',
				'elections',
				'employee_share_annual_cap',
				'shared_cap_group',
				'project_relief_annually',
				'rules',
				'assessed_on',
				'base_when',
				'ordinary_on',
				'history_trigger',
				'deduction_categories',
				'child_claims_hint',
				'parts',
				'short_name',
				'listing_order',
				'listing_group'
			]
		}
	},
	update: {
		input: {
			columns: [
				'code',
				'name',
				'authority',
				'assessment_period',
				'late_line_month',
				'assessment_scope',
				'remittance_rounding',
				'remittance_rounding_when',
				'unregistered_action',
				'registration_subject',
				'opening_scope',
				'elections',
				'employee_share_annual_cap',
				'shared_cap_group',
				'project_relief_annually',
				'rules',
				'assessed_on',
				'base_when',
				'ordinary_on',
				'history_trigger',
				'deduction_categories',
				'child_claims_hint',
				'parts',
				'short_name',
				'listing_order',
				'listing_group'
			]
		}
	},
	delete: { transform: true }
});

type Scheme = {
	readonly id?: string;
	readonly settings_id?: string;
	readonly code?: string;
	readonly rules?: readonly ContributionRule[];
	readonly assessment_period?: string;
	readonly assessment_scope?: string;
	readonly remittance_rounding?: string;
	readonly remittance_rounding_when?: string;
	readonly assessed_on?: string;
	readonly base_when?:
		readonly { readonly when: string; readonly base: string; readonly authority: string }[] | null;
	readonly ordinary_on?: string;
	readonly history_trigger?: {
		readonly less_employee_of: readonly string[];
		readonly ordinary_threshold: Readonly<Record<'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY', number>>;
		readonly authority: string;
	} | null;
	readonly elections?: readonly DeclaredKey[];
	readonly parts?: readonly string[];
};
type CodeRow = {
	readonly settings_id: string;
	readonly code: string;
	readonly name: string | null;
};

c.transform(async (inputs, ctx) => {
	const stored = ctx.existing.map((row) => (row == null ? undefined : (plain(row) as Scheme)));
	const settingsIds = [
		...new Set(
			[
				...inputs.map((input) => ('$delete' in input ? undefined : input.settings_id)),
				...stored.map((row) => row?.settings_id)
			].filter((id): id is string => id != null && id !== '')
		)
	];
	const settled = { settings_id: { in: settingsIds }, approval_id: { isNull: true } };
	// One wave: the versions, their money catalogues and their stored schemes together.
	const [versions, siblings, allowances, adhoc, claims, loans, leaves] = await Promise.all([
		versionsById(ctx.db, settingsIds),
		readAll<Scheme & { readonly id: string; readonly settings_id: string; readonly code: string }>(
			ctx.db,
			'statutory_contributions',
			settled
		),
		readAll<CodeRow>(ctx.db, 'allowance_catalogue', settled),
		readAll<CodeRow>(ctx.db, 'adhoc_catalogue', settled),
		readAll<CodeRow>(ctx.db, 'claim_catalogue', settled),
		readAll<CodeRow>(ctx.db, 'loan_catalogue', settled),
		readAll<CodeRow>(ctx.db, 'leave_catalogue', settled)
	]);

	// Delete guard: a scheme another scheme of its version still reads as `produced.<code>` stays.
	if (inputs.some((input) => '$delete' in input)) {
		const gone = new Set(stored.flatMap((row) => (row?.id == null ? [] : [row.id])));
		for (const scheme of stored) {
			if (scheme == null) continue;
			const reader = siblings.find(
				(other) =>
					other.settings_id === scheme.settings_id &&
					!gone.has(other.id) &&
					producedMentions(other.rules ?? []).includes(String(scheme.code))
			);
			if (reader != null)
				ctx.refuse(
					`Scheme ${reader.code} reads produced.${scheme.code}; remove that mention before deleting ${scheme.code}.`
				);
		}
		return inputs;
	}

	// A batch is one verb: past the delete guard every input is a create or an update.
	const writes = inputs.flatMap((input) => ('$delete' in input ? [] : [input]));
	const catalogues = catalogueCodes({ allowances, adhoc, claims, loans, leaves });
	const pending = writes.map((input, index) => ({ ...stored[index], ...input }));
	return writes.map((input, index) => {
		const row = pending[index]!;
		const what = `Scheme ${row.code ?? ''}`;
		refuseUnlessDraftOnBoth(versions, stored[index]?.settings_id, input.settings_id, what);
		const rules = row.rules ?? [];
		if (
			row.remittance_rounding === 'FLOOR_MAJOR_UNIT' &&
			((row.assessment_scope ?? 'EMPLOYMENT') !== 'EMPLOYMENT' || row.assessment_period !== 'MONTH')
		)
			ctx.refuse(
				`${what}: aggregate remittance rounding requires an employment-scoped monthly scheme.`
			);
		const roundedWhen = row.remittance_rounding_when ?? '';
		if (roundedWhen.trim() !== '') {
			if (row.remittance_rounding !== 'FLOOR_MAJOR_UNIT')
				ctx.refuse(`${what}: a remittance-rounding condition requires a remittance rounding.`);
			const fault = compileExpression({
				expression: roundedWhen,
				site: 'scheme',
				type: 'boolean',
				elections: row.elections ?? []
			});
			if (fault != null) ctx.refuse(`${what} remittance-rounding condition: ${fault}`);
		}
		const trigger = row.history_trigger;
		if (trigger != null) {
			if (trigger.authority.trim() === '')
				ctx.refuse(`${what}: a history trigger cites the law that states it.`);
			if (
				!Object.values(trigger.ordinary_threshold).every(
					(value) => Number.isFinite(value) && value >= 0
				)
			)
				ctx.refuse(`${what}: a history trigger states a non-negative threshold for every cadence.`);
		}
		for (const [index, override] of (row.base_when ?? []).entries()) {
			const where = `${what} base override ${index + 1}`;
			if (override.authority.trim() === '') ctx.refuse(`${where}: cite the law that states it.`);
			if (producedMentionsOf(override.when).length + producedMentionsOf(override.base).length > 0)
				ctx.refuse(`${where} reads another scheme; write that dependency in assessed_on.`);
			for (const [expression, type] of [
				[override.when, 'boolean'],
				[override.base, 'money']
			] as const) {
				const fault = compileExpression({
					expression,
					site: 'assessment',
					type,
					elections: row.elections ?? [],
					parts: row.parts ?? []
				});
				if (fault != null) ctx.refuse(`${where}: ${fault}`);
			}
		}
		const assessedOn = row.assessed_on ?? '';
		const others = siblings.filter(
			(other) =>
				other.settings_id === row.settings_id && other.id !== row.id && other.code !== row.code
		);
		const schemeCodes = new Set([
			...others.map((other) => other.code),
			...pending.filter((other) => other.settings_id === row.settings_id).map((other) => other.code)
		]);
		for (const code of trigger?.less_employee_of ?? [])
			if (!schemeCodes.has(code))
				ctx.refuse(`${what}: the history trigger deducts ${code}, not a scheme of this version.`);
		const fault = schemeFault(
			{
				rules,
				assessment_period: row.assessment_period,
				assessment_scope: row.assessment_scope,
				assessed_on: assessedOn,
				ordinary_on: row.ordinary_on ?? '',
				elections: row.elections ?? [],
				parts: row.parts ?? []
			},
			Object.fromEntries([
				...others.map((other) => [other.code, other.elections ?? []]),
				...pending
					.filter((other) => other.settings_id === row.settings_id && other.code != null)
					.map((other) => [String(other.code), other.elections ?? []])
			])
		);
		if (fault != null) ctx.refuse(fault);
		if (row.settings_id != null && row.settings_id !== '') {
			for (const expression of [
				assessedOn,
				...(row.base_when ?? []).flatMap((override) => [override.when, override.base])
			])
				refuseUnknownAssessedOnMentions(catalogues, row.settings_id, expression, what);
			try {
				orderSchemes([
					...others.map((other) => ({ row: { ...other, rules: other.rules ?? [] } })),
					{
						row: {
							code: row.code ?? '',
							rules,
							assessed_on: assessedOn,
							ordinary_on: row.ordinary_on ?? null,
							elections: row.elections ?? []
						}
					}
				]);
			} catch (error) {
				ctx.refuse(getErrorMessage(error));
			}
		}
		// Lists are `[]` when a scheme has none.
		return stored[index] == null
			? {
					...input,
					elections: input.elections ?? [],
					rules: input.rules ?? [],
					parts: input.parts ?? []
				}
			: input;
	});
});

export default c;
