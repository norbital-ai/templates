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
	overlayFault,
	periodsOverlap,
	stableJson,
	type Governed,
	type LineageOverlay
} from '../../../lib/jurisdiction_settings.js';
import { checksOf } from '../../../lib/datatypes/checks.js';
import { returnsFault, returnsOf } from '../../../lib/datatypes/returns.js';
import {
	createSettingsDraft,
	readSettingsVersionTree,
	settingsDraftWrite
} from '../../../lib/settings_clone.js';
import {
	referenceCodes,
	referenceRowOf,
	referenceRowsFault,
	tableMentionFault
} from '../../../lib/expressions/functions/tables.js';
import type { ReferenceTable } from '../../../lib/datatypes/reference_tables.js';
import { DOCUMENT_TABLE } from '../../../lib/datatypes/fact_keys.js';
import { dutyTypesOf } from '../../../lib/obligations/materialise.js';
import { everyField } from '../../../lib/every-field.js';

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
				'terms_facts',
				'work_day_facts',
				'payment_facts',
				'settlement_facts',
				'worksite_facts',
				'person_facts',
				'history_kinds',
				'tables',
				'overlays',
				'obligations',
				'duty_types',
				'checks',
				'returns',
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
							'counts_toward',
							'request_requirements',
							'request_facts'
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
							'schedule',
							'counts_toward',
							'reduces_unpaid_salary',
							'request_requirements',
							'request_facts'
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
							'time_off_amount',
							'paid_by',
							'consumes_code',
							'unit',
							'evidence_after_days',
							'entitlement',
							'requires_no_pay_origin',
							'event_facts',
							'schedule'
						]
					}
				},
				reference_rows: {
					create: {
						columns: [
							'table',
							'code',
							'parent_code',
							'label',
							'effective_range',
							'range_from',
							'range_to',
							'values'
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
							'late_line_month',
							'assessment_scope',
							'base_when',
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
							'deduction_categories',
							'child_claims_hint',
							'parts',
							'short_name',
							'listing_order',
							'listing_group',
							'history_trigger'
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
				'terms_facts',
				'work_day_facts',
				'payment_facts',
				'settlement_facts',
				'worksite_facts',
				'person_facts',
				'history_kinds',
				'tables',
				'overlays',
				'obligations',
				'duty_types',
				'checks',
				'returns',
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
	readonly ordinary_rate?: { readonly hour: string; readonly day: string } | null;
	readonly overtime_when: string;
	readonly bands: readonly {
		readonly when: string;
		readonly take_hours: string;
		readonly price_amount: string;
		readonly funnel_above_hours?: string | null;
	}[];
	readonly breaks: readonly { readonly when: string; readonly owed_minutes: string }[];
	readonly overtime_consent?: { readonly required_when: string } | null;
	readonly day_rules?: readonly { readonly when: string }[] | null;
};

/** Every expression a version's work rules carry, for the entity-fact key check. */
const workRuleExpressions = (work: WorkRules): string[] => [
	work.ordinary_divisor_days,
	work.ordinary_rate?.hour ?? '',
	work.ordinary_rate?.day ?? '',
	work.overtime_when,
	...work.bands.flatMap((band) => [
		band.when,
		band.take_hours,
		band.price_amount,
		band.funnel_above_hours ?? ''
	]),
	...work.breaks.flatMap((brk) => [brk.when, brk.owed_minutes]),
	work.overtime_consent?.required_when ?? '',
	...(work.day_rules ?? []).map((rule) => rule.when)
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
	const [
		paidRuns,
		schemes,
		allowances,
		adhoc,
		claims,
		loans,
		leaves,
		siblings,
		references,
		lineages
	] = await Promise.all([
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
				}),
		sealing.length === 0
			? none
			: db.read('reference_rows', {
					where: under,
					select: everyField('reference_rows'),
					all: true
				}),
		// Every sealed live version: an overlay and the base it serves are judged together (E8).
		sealing.length === 0
			? none
			: db.read('jurisdiction_settings', {
					where: { sealed_at: { isNull: false }, voided_at: { isNull: true }, ...held },
					select: {
						id: true,
						code: true,
						name: true,
						work_rules: true,
						overlays: true,
						effective_range: true
					},
					all: true
				})
	]);
	// The overlay versions a sealing base names, and their schemes (an overlay states none).
	const overlaysOf = (version: { readonly overlays?: unknown }) =>
		(version.overlays ?? []) as readonly LineageOverlay[];
	const named = new Set(
		inputs.flatMap((input, index) =>
			sealing.includes(existing[index]?.id as Id<'jurisdiction_settings'>)
				? overlaysOf({ ...existing[index], ...input }).map((declaration) => declaration.lineage)
				: []
		)
	);
	const overlayIds = lineages.rows.filter((row) => named.has(row.code)).map((row) => row.id);
	const overlaySchemes =
		overlayIds.length === 0
			? none
			: await db.read('statutory_contributions', {
					where: { settings_id: { in: overlayIds }, ...held },
					select: { code: true, settings_id: true },
					all: true
				});
	const schemeCodesOf = (settingsId: string) =>
		[...overlaySchemes.rows, ...schemes.rows]
			.filter((scheme) => scheme.settings_id === settingsId)
			.map((scheme) => scheme.code);
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
				['validation', field.valid_when],
				['evidence', field.evidence?.when]
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
		// A subject's inputs are judged at the person site (terms, work days) or the payment site.
		const termsFacts = (row.terms_facts ?? []) as readonly DeclaredKey[];
		const workDayFacts = (row.work_day_facts ?? []) as readonly DeclaredKey[];
		const paymentFacts = (row.payment_facts ?? []) as readonly DeclaredKey[];
		const settlementFacts = (row.settlement_facts ?? []) as readonly DeclaredKey[];
		const personFacts = (row.person_facts ?? []) as readonly DeclaredKey[];
		for (const [noun, fields, site] of [
			['terms', termsFacts, 'person'],
			['person', personFacts, 'person'],
			['work-day', workDayFacts, 'person'],
			['payment', paymentFacts, 'payment'],
			['settlement', settlementFacts, 'payment']
		] as const)
			for (const field of fields)
				for (const [kind, expression] of [
					['requirement', field.required_when],
					['validation', field.valid_when],
					['evidence', field.evidence?.when]
				] as const) {
					const fault = compileExpression({
						expression,
						site,
						type: 'boolean',
						exitFacts,
						termsFacts,
						paymentFacts,
						settlementFacts
					});
					if (fault != null) refuse(`${field.key} ${noun} ${kind}: ${fault}`);
				}
		// A duty type's expressions are judged at the obligation site, with the version's entity facts.
		for (const duty of dutyTypesOf(row))
			for (const [kind, expression, type] of [
				['trigger', duty.trigger.when, 'boolean'],
				['due day', duty.due, 'date'],
				['amount', duty.amount, 'money'],
				['late charge', duty.late_charge, 'money'],
				['retention', duty.retain_years, 'number'],
				...(duty.evidence ?? []).flatMap((field) => [
					[`${field.key} requirement`, field.required_when, 'boolean'] as const,
					[`${field.key} validation`, field.valid_when, 'boolean'] as const
				])
			] as const) {
				const fault = compileExpression({ expression, site: 'obligation', type, facts });
				if (fault != null) refuse(`Duty ${duty.code} ${kind}: ${fault}`);
			}
		// A stored check is judged at the check site, with the version's declared inputs (E9).
		for (const check of checksOf(row)) {
			const fault = compileExpression({
				expression: check.when,
				site: 'check',
				type: 'boolean',
				facts,
				exitFacts,
				termsFacts,
				personFacts
			});
			if (fault != null) refuse(`Check ${check.code}: ${fault}`);
		}
		// Returns and bank files are judged with the version's tables (L2).
		const returnFault = returnsFault(
			returnsOf(row),
			(row.tables ?? []) as readonly ReferenceTable[]
		);
		if (returnFault != null) refuse(returnFault);
		for (const [region, wage] of Object.entries(row.work_rules?.wages?.by_region ?? {}))
			if (!(wage > 0)) refuse(`The minimum wage of region ${region} must be a positive amount.`);
		const filled =
			stored == null
				? {
						...input,
						facts: row.facts ?? [],
						exit_facts: row.exit_facts ?? [],
						obligations: row.obligations ?? [],
						duty_types: row.duty_types ?? [],
						checks: row.checks ?? [],
						returns: row.returns ?? [],
						overlays: row.overlays ?? []
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
			// otherwise a typo reads zero at payroll. So is a `terms.facts.<key>` or `day_facts.<key>` one.
			const declaredFacts = new Set(facts.map((fact) => fact.key));
			const declaredTerms = new Set(termsFacts.map((fact) => fact.key));
			const declaredDays = new Set(workDayFacts.map((fact) => fact.key));
			const exceptionFact = row.work_rules?.overtime_consent?.exception_fact;
			if (exceptionFact != null && !declaredDays.has(exceptionFact))
				refuse(
					`This settings version excuses overtime consent by day_facts.${exceptionFact}, which it does not declare.`
				);
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
			for (const expression of expressions) {
				for (const key of openKeyMentions(expression, 'terms.facts'))
					if (!declaredTerms.has(key))
						refuse(
							`This settings version reads terms.facts.${key}, which it does not declare. ` +
								'Declare the terms input (its key and type) on the version first.'
						);
				for (const key of openKeyMentions(expression, 'day_facts'))
					if (!declaredDays.has(key))
						refuse(
							`This settings version reads day_facts.${key}, which it does not declare. ` +
								'Declare the work-day input (its key and type) on the version first.'
						);
			}
			// The version's tables: its rows fit their declarations, every table an expression reads is
			// declared for that lookup, and every `code` input picks from a declared table.
			const tables = (row.tables ?? []) as readonly ReferenceTable[];
			const ownRows = references.rows
				.filter((reference) => reference.settings_id === stored.id)
				.map(referenceRowOf);
			const rowsFault = referenceRowsFault(tables, ownRows);
			if (rowsFault != null) refuse(rowsFault);
			for (const expression of expressions) {
				const fault = tableMentionFault(tables, expression);
				if (fault != null) refuse(`This settings version: ${fault}`);
			}
			const codes = referenceCodes(ownRows, governed(row.effective_range)?.from ?? '');
			const declarations = [
				...facts,
				...exitFacts,
				...termsFacts,
				...workDayFacts,
				...paymentFacts,
				...settlementFacts,
				...personFacts,
				...((row.worksite_facts ?? []) as readonly DeclaredKey[]),
				...(row.history_kinds ?? []).flatMap((kind) => kind.facts as readonly DeclaredKey[]),
				...(row.duty_types ?? []).flatMap((duty) => (duty.evidence ?? []) as readonly DeclaredKey[])
			];
			for (const field of declarations) {
				const document = field.evidence?.document;
				if (document != null && codes(DOCUMENT_TABLE, document) == null)
					refuse(
						`${field.key}: its evidence names document ${document}, which is not a ${DOCUMENT_TABLE} ` +
							'row of this settings version when it begins.'
					);
			}
			for (const field of declarations)
				if (field.type === 'code') {
					if (!tables.some((table) => table.name === field.table))
						refuse(
							`${field.key} picks its codes from table ${field.table}, which this settings version does not declare.`
						);
					for (const value of [field.default_value, ...(field.options ?? [])])
						if (value != null && codes(field.table!, String(value)) == null)
							refuse(
								`${field.key}: ${String(value)} is not a code of table ${field.table} when this version begins.`
							);
				}
		}
		// An overlay never replaces a scheme, never routes further, and states what its base says it
		// replaces: judged from both sides, sealing the base or sealing the overlay (E8).
		const days0 = governed(row.effective_range);
		const overlapping = (other: { readonly effective_range: unknown }) => {
			const span = governed(other.effective_range);
			return days0 != null && span != null && periodsOverlap(days0, span);
		};
		const code = row.code ?? '';
		for (const declaration of overlaysOf(row)) {
			const self = overlayFault(code, declaration, { code: '', work_rules: {} }, []);
			if (self != null) refuse(self);
			for (const overlay of lineages.rows)
				if (overlay.code === declaration.lineage && overlapping(overlay)) {
					const fault = overlayFault(code, declaration, overlay, schemeCodesOf(overlay.id));
					if (fault != null) refuse(fault);
				}
		}
		if (stored != null)
			for (const base of lineages.rows)
				if (base.code !== code && overlapping(base))
					for (const declaration of overlaysOf(base))
						if (declaration.lineage === code) {
							const fault = overlayFault(
								base.code,
								declaration,
								{ ...row, code, work_rules: row.work_rules },
								schemeCodesOf(stored.id)
							);
							if (fault != null) refuse(fault);
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
