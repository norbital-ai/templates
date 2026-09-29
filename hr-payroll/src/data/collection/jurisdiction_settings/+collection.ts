import { collection, type Id } from '@norbital-ai/bolt';
import { compileExpression, type DeclaredKey } from '../../../lib/expressions/compile.js';
import { openKeyMentions } from '../../../lib/expressions/contexts.js';
import {
	assessedOnMentionFault,
	catalogueCodes,
	membershipFault,
	schemeFault
} from '../../../lib/catalogue_rules.js';
import {
	describeVersion,
	governed,
	periodsOverlap,
	stableJson,
	type Governed
} from '../../../lib/jurisdiction_settings.js';
import {
	createSettingsDraft,
	readSettingsVersionTree,
	settingsDraftWrite
} from '../../../lib/settings_clone.js';

/** Settings versions. A version is created with its schemes and catalogues in one write (a clone); sealing and voiding are the reviewed writes (the policies' approval routes). */
const settings = collection('jurisdiction_settings', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'code',
				'jurisdiction_code',
				'name',
				'sealed_at',
				'voided_at',
				'void_reason',
				'cloned_from_id',
				'payroll',
				'sources',
				'work_rules',
				'facts',
				'exit_facts',
				'obligations',
				'change_summary',
				'effective_range'
			],
			with: {
				claim_catalogue: {
					create: {
						columns: [
							'code',
							'name',
							'authority',
							'destination',
							'direction',
							'bands',
							'eligibility',
							'qualifies_when',
							'evidence',
							'counts_toward'
						]
					}
				},
				adhoc_catalogue: {
					create: {
						columns: [
							'code',
							'name',
							'authority',
							'destination',
							'direction',
							'bands',
							'eligibility',
							'evidence',
							'raised_by',
							'counts_toward'
						]
					}
				},
				allowance_catalogue: {
					create: {
						columns: [
							'code',
							'name',
							'authority',
							'destination',
							'direction',
							'bands',
							'eligibility',
							'counts_toward',
							'npl_prorates',
							'outpatient_sick_pay',
							'owed'
						]
					}
				},
				loan_catalogue: {
					create: {
						columns: [
							'code',
							'name',
							'destination',
							'direction',
							'bands',
							'loan_type',
							'minimum_repayment',
							'eligibility',
							'evidence'
						]
					}
				},
				leave_catalogue: {
					create: {
						columns: [
							'code',
							'name',
							'authority',
							'eligibility',
							'evidence',
							'is_npl',
							'can_encash',
							'encash_on_exit',
							'pay_fraction',
							'paid_by',
							'consumes_code',
							'unit',
							'evidence_after_days',
							'entitlement'
						]
					}
				},
				statutory_contributions: {
					create: {
						columns: [
							'code',
							'name',
							'authority',
							'assessment_period',
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
							'ordinary_on',
							'parts',
							'short_name',
							'listing_order',
							'listing_group'
						]
					}
				}
			}
		}
	},
	update: {
		input: {
			columns: [
				'code',
				'jurisdiction_code',
				'name',
				'sealed_at',
				'voided_at',
				'void_reason',
				'cloned_from_id',
				'payroll',
				'sources',
				'work_rules',
				'facts',
				'exit_facts',
				'obligations',
				'change_summary',
				'effective_range'
			]
		}
	},
	delete: {},
	actions: {
		new_settings_version: {
			description:
				'Clones one jurisdiction settings version and every row under it (schemes, rules, leave catalogue entries, components) into a draft of the same lineage starting on a given day.',
			input: {
				settings_id: { kind: 'id', of: 'jurisdiction_settings' },
				/** The first day the new version governs. */
				starts_on: { kind: 'date' },
				name: { kind: 'text', optional: true }
			},
			output: { kind: 'id', of: 'jurisdiction_settings' }
		}
	}
});
export default settings;

/** The two columns a sealed version may still take: the void, once. */
const VOID_COLUMNS = new Set(['voided_at', 'void_reason']);

/** Whether an edit to a sealed version's period only ends it earlier: the same start, an end at or before the stored one. */
function onlyShortens(stored: Governed | null, next: Governed | null): boolean {
	if (stored == null || next == null || stored.from !== next.from) return false;
	if (next.to == null) return stored.to == null;
	return next.to >= next.from && (stored.to == null || next.to <= stored.to);
}

type WorkRules = {
	readonly ordinary_divisor_days: string;
	readonly overtime_when: string;
	readonly bands: readonly {
		readonly when: string;
		readonly take_hours: string;
		readonly price_amount: string;
		readonly funnel_above_hours?: string | null;
	}[];
	readonly breaks: readonly { readonly when: string; readonly owed_minutes: string }[];
};

/** Every expression a version's work rules carry, for the entity-fact key check. */
const workRuleExpressions = (work: WorkRules): string[] => [
	work.ordinary_divisor_days,
	work.overtime_when,
	...work.bands.flatMap((band) => [
		band.when,
		band.take_hours,
		band.price_amount,
		band.funnel_above_hours ?? ''
	]),
	...work.breaks.flatMap((brk) => [brk.when, brk.owed_minutes])
];

/**
 * The sealed, shareable root of a jurisdiction lineage. Validates the payroll scope; freezes every column of a sealed
 * version except a shortened period and a one-time void; never unseals; requires a reason to void a version a paid run
 * cites; refuses sealing a version whose period overlaps another sealed live version of its code unless that version is
 * ended in the same batch. A sealed version is never deleted, only voided: the delete grants admit drafts alone.
 */
settings.transform(async (inputs, { existing, db, refuse }) => {
	const sealing: Id<'jurisdiction_settings'>[] = [];
	const voiding: Id<'jurisdiction_settings'>[] = [];
	for (const [index, input] of inputs.entries()) {
		const row = existing[index];
		if (row == null) continue;
		if (row.sealed_at == null && input.sealed_at != null) sealing.push(row.id);
		if (row.voided_at == null && input.voided_at != null) voiding.push(row.id);
	}
	const codes = [
		...new Set(inputs.flatMap((input, index) => [input.code ?? existing[index]?.code ?? []].flat()))
	];
	const held = { approval_id: { isNull: true } } as const;
	const under = { settings_id: { in: sealing }, ...held } as const;
	const none = { rows: [] as const, next: null };
	// One wave: every read is keyed by the inputs and their stored rows.
	const [paidRuns, schemes, allowances, adhoc, claims, loans, leaves, siblings] = await Promise.all(
		[
			voiding.length === 0
				? none
				: db.read('payroll_runs', {
						where: { settings_id: { in: voiding }, payslips: { some: { status: { eq: 'PAID' } } } },
						all: true
					}),
			sealing.length === 0 ? none : db.read('statutory_contributions', { where: under, all: true }),
			sealing.length === 0 ? none : db.read('allowance_catalogue', { where: under, all: true }),
			sealing.length === 0 ? none : db.read('adhoc_catalogue', { where: under, all: true }),
			sealing.length === 0 ? none : db.read('claim_catalogue', { where: under, all: true }),
			sealing.length === 0 ? none : db.read('loan_catalogue', { where: under, all: true }),
			sealing.length === 0 ? none : db.read('leave_catalogue', { where: under, all: true }),
			codes.length === 0
				? none
				: db.read('jurisdiction_settings', {
						where: {
							code: { in: codes },
							sealed_at: { isNull: false },
							voided_at: { isNull: true },
							...held
						},
						all: true
					})
		]
	);
	const catalogues = catalogueCodes({
		allowances: allowances.rows,
		adhoc: adhoc.rows,
		claims: claims.rows,
		loans: loans.rows,
		leaves: leaves.rows
	});
	const memberships = [
		...allowances.rows.map((row) => ({ ...row, noun: 'Allowance' })),
		...claims.rows.map((row) => ({ ...row, noun: 'Claim' })),
		...adhoc.rows.map((row) => ({ ...row, noun: 'Ad hoc' }))
	];
	// What the batch says about each version's period, so a predecessor ended in the same write counts.
	const periods = new Map<string, Governed>();
	for (const [index, input] of inputs.entries()) {
		const row = existing[index];
		const days =
			row == null || input.effective_range === undefined ? null : governed(input.effective_range);
		if (row != null && days != null) periods.set(row.id, days);
	}
	return inputs.map((input, index) => {
		const stored = existing[index];
		const row = { ...stored, ...input };
		if (stored != null && stored.sealed_at != null) {
			const version = describeVersion(stored);
			if (input.sealed_at === null)
				refuse(`${version} is never unsealed. Void it and seal a corrected version instead.`);
			for (const [column, value] of Object.entries(input)) {
				if (VOID_COLUMNS.has(column)) continue;
				if (stableJson(value) === stableJson(stored[column as keyof typeof stored])) continue;
				if (
					column === 'effective_range' &&
					onlyShortens(governed(stored.effective_range), governed(input.effective_range))
				)
					continue;
				refuse(
					`${version} is sealed, so ${column} cannot change. ` +
						'Enact a new version of the settings instead; a wrong seal is voided.'
				);
			}
			if (stored.voided_at != null && input.voided_at === null)
				refuse(`${version} is voided; a void is one action, never undone.`);
			if (
				stored.voided_at != null &&
				input.void_reason !== undefined &&
				input.void_reason !== stored.void_reason
			)
				refuse(`${version} is voided; its reason is part of the record.`);
			if (stored.voided_at == null && input.voided_at != null) {
				const paid = paidRuns.rows.find((run) => run.settings_id === stored.id);
				if (paid != null && (row.void_reason ?? '').trim() === '')
					refuse(
						`${version} priced the paid ${paid.period} payroll run, so voiding it states a reason.`
					);
			}
			return input;
		}
		// A draft, or a create: the whole row is checked, and a draft's defaults are filled.
		if (row.voided_at != null)
			refuse('Only a sealed version can be voided; delete a draft instead.');
		if (row.payroll?.currency == null || !(row.jurisdiction_code ?? '').trim())
			refuse('Settings require a currency and payroll jurisdiction.');
		// stored `fact_keys` values; the expression compiler's declared-key type spells absent members as missing
		const facts = (row.facts ?? []) as readonly DeclaredKey[];
		const exitFacts = (row.exit_facts ?? []) as readonly DeclaredKey[];
		for (const field of facts)
			for (const [kind, expression] of [
				['requirement', field.required_when],
				['validation', field.valid_when]
			] as const) {
				const fault = compileExpression({ expression, site: 'entity', type: 'boolean', facts });
				if (fault != null) refuse(`${field.key} ${kind}: ${fault}`);
			}
		for (const field of exitFacts)
			for (const [kind, expression] of [
				['requirement', field.required_when],
				['validation', field.valid_when]
			] as const) {
				const fault = compileExpression({ expression, site: 'person', type: 'boolean', exitFacts });
				if (fault != null) refuse(`${field.key} departure ${kind}: ${fault}`);
			}
		for (const [region, wage] of Object.entries(row.work_rules?.wages?.by_region ?? {}))
			if (!(wage > 0)) refuse(`The minimum wage of region ${region} must be a positive amount.`);
		const filled =
			stored == null
				? {
						...input,
						facts: row.facts ?? [],
						exit_facts: row.exit_facts ?? [],
						obligations: row.obligations ?? []
					}
				: input;
		if (row.sealed_at == null) return filled;
		// A sealing version's schemes each charge something: their formulas compile, and every code and catalogue one
		// names is a row of this version.
		if (stored != null) {
			const own = schemes.rows.filter((scheme) => scheme.settings_id === stored.id);
			const elections = Object.fromEntries(own.map((scheme) => [scheme.code, scheme.elections]));
			for (const scheme of own) {
				const fault = schemeFault(
					{
						rules: scheme.rules as Parameters<typeof schemeFault>[0]['rules'],
						assessment_period: scheme.assessment_period,
						assessment_scope: scheme.assessment_scope,
						assessed_on: scheme.assessed_on,
						ordinary_on: scheme.ordinary_on,
						elections: elections[scheme.code] ?? [],
						parts: scheme.parts
					},
					elections
				);
				if (fault != null) refuse(`Scheme ${scheme.code} ${fault}`);
				const mention = assessedOnMentionFault(
					catalogues,
					stored.id,
					scheme.assessed_on,
					`Scheme ${scheme.code}`
				);
				if (mention != null) refuse(mention);
			}
			for (const claim of claims.rows)
				if (claim.settings_id === stored.id && (claim.qualifies_when ?? '').trim() !== '') {
					if ((claim.authority ?? '').trim() === '')
						refuse(`Claim ${claim.code} must cite its qualification authority before sealing.`);
					const fault = compileExpression({
						expression: claim.qualifies_when,
						site: 'entry',
						type: 'boolean'
					});
					if (fault != null) refuse(`Claim ${claim.code} qualification: ${fault}`);
				}
			// Every class of the version counts toward schemes the version has, by the parts they declare — a membership
			// nothing honours would read as "no base" at payroll.
			const ownParts = new Map(own.map((scheme) => [scheme.code, scheme.parts]));
			for (const member of memberships)
				if (member.settings_id === stored.id) {
					const fault = membershipFault(
						ownParts,
						member.counts_toward,
						`${member.noun} ${member.code}`
					);
					if (fault != null) refuse(fault);
				}
			// A `person.company.facts.<key>` mention is legal only when this version declares the key and its type;
			// otherwise a typo reads zero at payroll.
			const declaredFacts = new Set(facts.map((fact) => fact.key));
			const expressions = [
				...(row.work_rules == null ? [] : workRuleExpressions(row.work_rules)),
				...own.flatMap((scheme) => [
					scheme.assessed_on,
					scheme.ordinary_on,
					...scheme.elections.map((field) => field.required_when ?? ''),
					...scheme.rules.flatMap((rule) => [
						rule.when,
						rule.employee,
						rule.employer,
						rule.rebate ?? '',
						rule.deduction ?? ''
					])
				])
			];
			for (const expression of expressions)
				for (const key of [
					...openKeyMentions(expression, 'person.company.facts'),
					...openKeyMentions(expression, 'company.facts')
				])
					if (!declaredFacts.has(key))
						refuse(
							`This settings version reads company.facts.${key}, which it does not declare. ` +
								'Declare the entity fact (its key and type) on the version first.'
						);
		}
		// Sealing. The sealed-only `noOverlap` holds the overlap too; the sentence is why it happens here, and the batch
		// is read so a predecessor ended in the same write counts.
		const days =
			governed(row.effective_range) ?? refuse('A sealed version states the period it governs.');
		for (const sibling of siblings.rows) {
			if (sibling.code !== row.code || sibling.id === stored?.id) continue;
			const other = periods.get(sibling.id) ?? governed(sibling.effective_range);
			if (other != null && periodsOverlap(days, other))
				refuse(
					`Sealed ${row.code} versions cannot overlap: ${sibling.name} already governs ` +
						`${other.from} to ${other.to ?? 'open'}. Seal from the Settings timeline, which ` +
						'ends the previous version the day before this one begins.'
				);
		}
		return filled;
	});
});

/** The Settings timeline's New version: the version and every row under it, cloned into a draft. */
settings.action('new_settings_version', async ({ settings_id, starts_on, name }, ctx) => {
	const tree = await readSettingsVersionTree(ctx, settings_id, ctx.refuse);
	const draft = settingsDraftWrite(tree, { starts_on: String(starts_on), name }, ctx.refuse);
	const created = await createSettingsDraft(ctx, tree, draft);
	return created.id as typeof settings_id;
});
