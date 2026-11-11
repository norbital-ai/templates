<script lang="ts">
	import { changesBetween, versionOn } from '../../../../lib/payroll_engine/contract_change.js';
	import { accountsOf, latestLeft } from '../../../../lib/ledger/core.js';
	import {
		Button,
		Combobox,
		Editor,
		Field,
		Form,
		isJsonSchema,
		notifyOutcome,
		openRecord,
		RecordShell,
		Sheet,
		Textarea,
		toast,
		valueObject,
		type FieldEditor,
		type Kind,
		type RecordView,
		type Value
	} from '@norbital-ai/ui';
	import { Cluster, Columns, Stack } from '@norbital-ai/ui/layout';
	import { fork, run } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { addDays, addMonths, monthOf, PlainDate } from '@norbital-ai/std/date';
	import {
		buildLoanSchedule,
		FINAL_SETTLEMENT,
		loanDisposition,
		loanRecovery,
		monthlyEquivalent
	} from '../../../../lib/payroll_engine/loan_schedule.js';
	import { isJsonObject, type JsonObject } from '../../../../lib/payroll_engine/foundation.js';
	import type { Id } from '@norbital-ai/bolt';
	import { bolt } from '$bolt';
	import { contractCategories } from '../../../../lib/ui/person/contract_categories.js';
	import ContractTermsEditor from '../../../../lib/ui/person/contract_terms_editor.svelte';
	import VersionFacts from '../../../../lib/ui/person/version_facts.svelte';

	type ChangeAction = 'PROMOTION' | 'LIFE_EVENT' | 'TRANSFER' | 'TERMINATE';
	const RELATIONS = ['CHILD', 'SPOUSE', 'PARENT'] as const;
	/** The contract's `exit_ground`, for the termination sheet's editor. */
	const EXIT_GROUNDS = [
		'RETRENCHMENT',
		'RETIREMENT',
		'RESIGNATION',
		'DISMISSAL',
		'MISCONDUCT_DISMISSAL',
		'END_OF_CONTRACT',
		'MUTUAL',
		'DEATH',
		'UNILATERAL',
		'BREACH_BY_EMPLOYER'
	] as const;
	const EXIT_GROUND: Kind = { kind: 'enum', values: [...EXIT_GROUNDS], optional: true };
	/** The contract's dated `events`, for the life-event sheet's editor. */
	const EVENTS: Kind = {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				kind: { kind: 'text' },
				on: { kind: 'date' },
				opened_on: { kind: 'date', optional: true },
				ended_on: { kind: 'date', optional: true },
				allocated_days: { kind: 'int', optional: true }
			}
		}
	};
	/** The contract's `family` list, for the life-event sheet's editor. */
	const FAMILY: Kind = {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				relation: { kind: 'enum', values: RELATIONS },
				born_on: { kind: 'date', optional: true },
				expected_on: { kind: 'date', optional: true },
				has_income: { kind: 'bool', optional: true },
				disabled: { kind: 'bool', optional: true },
				studying: { kind: 'bool', optional: true },
				allocations: { kind: 'record', optional: true, of: { kind: 'number', min: 0 } }
			}
		}
	};
	type SalaryUnit = 'MONTHLY' | 'DAILY' | 'HOURLY';
	type Engagement =
		'EMPLOYEE' | 'PART_TIME' | 'CONTRACTOR' | 'INTERN' | 'APPRENTICE' | 'CONSULTANT' | 'PAYEE';

	let { view }: { view: RecordView<'employee_contract'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const t = bolt.t;
	const today = bolt.clock('day').today;

	let action = $state<ChangeAction | null>(null);
	let step = $state<1 | 2>(1);
	let changeSaving = $state(false);
	let changeError = $state<string | null>(null);
	let targetEntity = $state<Id<'entity'> | null>(null);
	let lastDay = $state<PlainDate | null>(null);
	let finalPayDueOn = $state<PlainDate | null>(null);
	let exitGround = $state<(typeof EXIT_GROUNDS)[number] | null>(null);
	let jobTitle = $state('');
	let department = $state('');
	let salaryAmount = $state<number | null>(null);
	let salaryUnit = $state<SalaryUnit>('MONTHLY');
	let engagement = $state<Engagement>('EMPLOYEE');
	let categoryEdits = $state<Readonly<Record<string, string>>>({});
	let extensionEdits = $state<JsonObject | null>(null);
	let eventsEdit = $state<Value | null>(null);
	let familyEdit = $state<Value | null>(null);
	let expectedPayEdit = $state<number | null>(null);
	let note = $state('');
	let settleLoans = $state(false);

	let voiding = $state(false);
	let voidReason = $state('');
	let voidSaving = $state(false);

	const siblings = $derived(
		record == null
			? null
			: bolt.query({
					employee_contract: {
						where: {
							employee_id: { eq: record.employee_id }
						},
						fields: [
							'employee_number',
							'effective_range',
							'status',
							'entity_id',
							'employee_extension_data'
						],
						limit: 10000
					}
				})
	);
	const entities = bolt.query({
		entity: {
			fields: ['id', 'name', 'settings_code'],
			orderBy: { name: 'asc' },
			limit: 1000
		}
	});
	const settings = bolt.query({
		jurisdiction_settings: {
			where: { status: { eq: 'SEALED' } },
			fields: ['id', 'code', 'name', 'effective_range', 'currency'],
			limit: 2000
		}
	});
	const codeOf = (entity: unknown) =>
		(entities.current?.entity.rows ?? []).find((row) => row.id === entity)?.settings_code;
	/** A contract names no version: the law is its entity's lineage in force on a day. */
	const lawOn = (entity: unknown, day: string) =>
		versionOn(settings.current?.jurisdiction_settings.rows ?? [], codeOf(entity), day);
	/** The law a contract form answers to: in force on the first day it states. */
	const formLaw = (values: { readonly [name: string]: Value }) => {
		const range = values['effective_range'];
		const from = valueObject(range) && typeof range['from'] === 'string' ? range['from'] : today;
		return lawOn(values['entity_id'], String(from))?.id ?? null;
	};
	const nextDay = $derived(lastDay === null ? null : addDays(lastDay, 1));
	/** The new version's law: the target entity's lineage in force on the day it starts. */
	const targetSettings = $derived(
		targetEntity === null ? null : (lawOn(targetEntity, nextDay ?? today)?.id ?? null)
	);
	const targetConfiguration = $derived(
		targetSettings === null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: { id: { eq: targetSettings } },
						fields: ['lookup', 'employee_extension_schema'],
						limit: 1
					},
					registered_rule: {
						where: { settings_id: { eq: targetSettings }, code: { eq: 'CONTRACT_CATEGORIES' } },
						fields: ['lookup'],
						limit: 1
					}
				})
	);
	const balance = $derived(
		record == null
			? null
			: bolt.query({
					employee_balance: {
						where: { employee_id: { eq: record.employee_id } },
						fields: ['account'],
						limit: 1
					}
				})
	);
	const loans = $derived(
		record == null
			? null
			: bolt.query({
					loan_catalog_entry: {
						where: { employment_id: { eq: record.id } },
						fields: ['id', 'quantity'],
						limit: 10000
					},
					loan_catalog_entry_repayment: {
						where: { employment_id: { eq: record.id } },
						fields: ['loan_id', 'amount', 'reverses', 'payroll_run_id'],
						limit: 10000
					},
					payslip: {
						where: { employment_id: { eq: record.id } },
						fields: ['net_pay', 'period'],
						limit: 10000
					},
					entity_profile_version: {
						where: { entity_id: { eq: record.entity_id }, status: { eq: 'SEALED' } },
						fields: ['effective_range', 'final_pay_loan_floor_percent'],
						limit: 1000
					}
				})
	);

	const stateBadge = $derived(
		record === null
			? undefined
			: record.status === 'DRAFT'
				? t('contract.open')
				: record.status === 'VOID'
					? t('contract.voided')
					: record.effective_range.to != null
						? t('contract.ended')
						: undefined
	);
	const currentSettings = $derived(
		record === null ? undefined : lawOn(record.entity_id, record.effective_range.from)
	);
	const entityOptions = $derived(
		(entities.current?.entity.rows ?? []).map((row) => ({
			value: row.id,
			label: row.name
		}))
	);
	const targetEntityRow = $derived(
		(entities.current?.entity.rows ?? []).find((row) => row.id === targetEntity)
	);
	const sameJurisdiction = $derived(
		record !== null &&
			targetEntity !== null &&
			codeOf(targetEntity) !== undefined &&
			codeOf(targetEntity) === codeOf(record.entity_id)
	);
	/** The months a contract change can start: this one, if no run has taken it, and the year ahead. */
	const months = $derived(
		Array.from({ length: 13 }, (_, index) => {
			const first = addMonths(monthOf(today).from, index);
			return { value: first, label: first.slice(0, 7) };
		})
	);
	const lastDayInvalid = $derived(
		lastDay === null || (record !== null && lastDay < record.effective_range.from)
	);
	function amountOf(value: unknown): number {
		if (typeof value === 'number') return value;
		if (typeof value === 'string') return Number(value);
		if (value !== null && typeof value === 'object') {
			const decimal = Reflect.get(value, '$dec');
			if (typeof decimal === 'string') return Number(decimal);
			const text = String(value);
			if (text !== '[object Object]') return Number(text);
		}
		return 0;
	}
	const leaveDays = $derived(
		latestLeft(
			accountsOf(balance?.current?.employee_balance.rows[0]?.account),
			'leave',
			'ANNUAL_LEAVE'
		)
	);
	/** Each loan less what payroll has already repaid; the open schedule does not count until a run seals it. */
	function outstandingOf<L extends { readonly id: unknown; readonly quantity: unknown }>(
		loanRows: readonly L[],
		repayments: readonly {
			readonly loan_id: unknown;
			readonly amount: unknown;
			readonly reverses?: string | null;
			readonly payroll_run_id?: unknown;
		}[]
	) {
		const paid = new Map<string, number>();
		for (const row of repayments) {
			if (row.payroll_run_id == null) continue;
			const key = String(row.loan_id);
			paid.set(key, (paid.get(key) ?? 0) + (row.reverses != null ? -1 : 1) * amountOf(row.amount));
		}
		return loanRows
			.map((row) => ({ row, amount: amountOf(row.quantity) - (paid.get(String(row.id)) ?? 0) }))
			.filter((item) => item.amount > 0.000001);
	}
	const outstandingLoans = $derived(
		outstandingOf(
			loans?.current?.loan_catalog_entry.rows ?? [],
			loans?.current?.loan_catalog_entry_repayment.rows ?? []
		)
	);
	const loanTotal = $derived(outstandingLoans.reduce((sum, item) => sum + item.amount, 0));
	const latestPayslip = $derived(
		(loans?.current?.payslip.rows ?? []).toSorted((left, right) =>
			String(right.period ?? '').localeCompare(String(left.period ?? ''))
		)[0]
	);
	const rateEquivalent = $derived(record === null ? null : monthlyEquivalent(record.terms));
	const expectedPay = $derived(
		expectedPayEdit ??
			(latestPayslip === undefined ? rateEquivalent : amountOf(latestPayslip.net_pay))
	);
	const recoveryBasis = $derived(
		expectedPayEdit !== null
			? t('contract.recovery_basis_manual')
			: latestPayslip !== undefined
				? t('contract.recovery_basis_payslip', { period: String(latestPayslip.period ?? '') })
				: rateEquivalent !== null
					? t('contract.recovery_basis_rate')
					: t('contract.recovery_basis_none')
	);
	const covers = (range: { from: unknown; to?: unknown }, day: PlainDate) =>
		String(range.from) <= day && (range.to == null || day <= String(range.to));
	const floorPercent = $derived(
		Number(
			(loans?.current?.entity_profile_version.rows ?? []).find((row) =>
				covers(row.effective_range, lastDay ?? today)
			)?.final_pay_loan_floor_percent ?? 10
		)
	);
	const decimals = (currency: unknown): number =>
		new Intl.NumberFormat('en', {
			style: 'currency',
			currency: String(currency ?? 'USD')
		}).resolvedOptions().maximumFractionDigits ?? 2;
	const recovery = $derived(
		expectedPay === null
			? null
			: loanRecovery({
					loans: outstandingLoans.map((item) => ({
						id: String(item.row.id),
						outstanding: item.amount
					})),
					expectedPay,
					floorPercent,
					decimals: decimals(currentSettings?.currency)
				})
	);

	/** The target's allowed values; a value the old jurisdiction used is dropped, never submitted. */
	const targetCategories = $derived(
		contractCategories(
			targetConfiguration?.current?.jurisdiction_settings.rows[0]?.lookup,
			targetConfiguration?.current?.registered_rule.rows[0]?.lookup
		)
	);
	const categoryFields = $derived(
		[
			{
				name: 'statutory_work_category',
				label: t('contract.statutory_work_category'),
				values: targetCategories.statutory
			},
			{
				name: 'residency_status',
				label: t('contract.residency_status'),
				values: targetCategories.residency
			},
			{
				name: 'work_classification',
				label: t('contract.work_classification'),
				values: targetCategories.classification
			},
			...(targetCategories.pass === undefined
				? []
				: [
						{
							name: 'work_authorisation_category',
							label: t('contract.work_authorisation_category'),
							values: targetCategories.pass
						}
					])
		].map((field) => {
			const held = categoryEdits[field.name] ?? '';
			return {
				...field,
				value: field.values === undefined || field.values.includes(held) ? held : ''
			};
		})
	);
	const targetExtensionSchema = $derived.by(() => {
		const stored =
			targetConfiguration?.current?.jurisdiction_settings.rows[0]?.employee_extension_schema;
		return stored != null && isJsonSchema(stored) ? stored : null;
	});
	/** The person's facts from their latest contract in the target jurisdiction; another jurisdiction's never carry over. */
	const priorExtension = $derived(
		(siblings?.current?.employee_contract.rows ?? [])
			.filter(
				(row) =>
					row.status === 'SEALED' &&
					targetEntity !== null &&
					codeOf(row.entity_id) === codeOf(targetEntity)
			)
			.toSorted((left, right) =>
				String(right.effective_range.from).localeCompare(String(left.effective_range.from))
			)[0]?.employee_extension_data
	);
	/** An exit states its answers on the version it ends; any other change starts from the person's latest facts. */
	const targetExtension = $derived<JsonObject>(
		extensionEdits ??
			(action === 'TERMINATE' ? record?.employee_extension_data : priorExtension) ??
			{}
	);
	/** The life events as the contract stores them: the editor answers plain values. */
	const targetEvents = $derived(
		eventsEdit === null
			? (record?.events ?? [])
			: (Array.isArray(eventsEdit) ? eventsEdit : []).flatMap((item) =>
					valueObject(item) && typeof item.kind === 'string' && typeof item.on === 'string'
						? [
								{
									kind: item.kind,
									on: PlainDate(item.on),
									...(typeof item.opened_on === 'string'
										? { opened_on: PlainDate(item.opened_on) }
										: {}),
									...(typeof item.ended_on === 'string'
										? { ended_on: PlainDate(item.ended_on) }
										: {}),
									...(typeof item.allocated_days === 'number'
										? { allocated_days: item.allocated_days }
										: {})
								}
							]
						: []
				)
	);
	/** The family as the contract stores it; it carries into every new version. */
	const targetFamily = $derived(
		familyEdit === null
			? (record?.family ?? [])
			: (Array.isArray(familyEdit) ? familyEdit : []).flatMap((item) => {
					const relation = valueObject(item)
						? RELATIONS.find((known) => known === item.relation)
						: undefined;
					return valueObject(item) && relation !== undefined
						? [
								{
									relation,
									...(typeof item.born_on === 'string' ? { born_on: PlainDate(item.born_on) } : {}),
									...(typeof item.expected_on === 'string'
										? { expected_on: PlainDate(item.expected_on) }
										: {}),
									...(typeof item.has_income === 'boolean' ? { has_income: item.has_income } : {}),
									...(typeof item.disabled === 'boolean' ? { disabled: item.disabled } : {}),
									...(typeof item.studying === 'boolean' ? { studying: item.studying } : {}),
									...(valueObject(item.allocations)
										? {
												allocations: Object.fromEntries(
													Object.entries(item.allocations).flatMap(([code, days]) =>
														typeof days === 'number' ? [[code, days] as const] : []
													)
												)
											}
										: {})
								}
							]
						: [];
				})
	);
	const transferring = $derived(action === 'TRANSFER' && !sameJurisdiction);
	const detailsValid = $derived(
		action === 'TERMINATE'
			? note.trim() !== '' &&
					!lastDayInvalid &&
					(outstandingLoans.length === 0 || recovery !== null)
			: action === 'LIFE_EVENT'
				? !lastDayInvalid
				: !lastDayInvalid &&
					targetEntity !== null &&
					targetSettings !== null &&
					jobTitle.trim() !== '' &&
					salaryAmount !== null &&
					salaryAmount >= 0 &&
					(!transferring ||
						(targetConfiguration?.current != null &&
							categoryFields.every((field) => field.values === undefined || field.value !== '')))
	);

	function beginChange(kind: ChangeAction) {
		if (record === null) return;
		action = kind;
		step = 1;
		changeError = null;
		// only an exit keeps its own day: every other change starts on the first of a month
		lastDay = kind === 'TERMINATE' ? today : monthOf(today).to;
		finalPayDueOn = null;
		exitGround = record.exit_ground ?? null;
		note = '';
		settleLoans = false;
		expectedPayEdit = null;
		extensionEdits = null;
		eventsEdit = null;
		familyEdit = null;
		jobTitle = String(record.terms.job_title ?? '');
		department = String(record.terms.department ?? '');
		salaryAmount = record.terms.rate?.amount ?? null;
		salaryUnit = (record.terms.rate?.unit ?? 'MONTHLY') as SalaryUnit;
		engagement = record.engagement as Engagement;
		categoryEdits = Object.fromEntries(
			[
				'statutory_work_category',
				'residency_status',
				'work_classification',
				'work_authorisation_category'
			].map((name) => [name, String(Reflect.get(record.terms, name) ?? '')])
		);
		targetEntity = record.entity_id;
	}
	function chooseEntity(next: Id<'entity'> | null) {
		targetEntity = next;
		extensionEdits = null;
	}
	function closeChange() {
		if (changeSaving) return;
		action = null;
		step = 1;
		changeError = null;
	}
	async function readLoans(current: NonNullable<typeof record>) {
		const held = await bolt.query({
			loan_catalog_entry: {
				where: { employment_id: { eq: current.id } },
				fields: ['id', 'catalog_id', 'quantity', 'repayment_period'],
				limit: 10000
			},
			loan_catalog_entry_repayment: {
				where: { employment_id: { eq: current.id } },
				fields: ['id', 'loan_id', 'amount', 'reverses', 'payroll_run_id'],
				limit: 10000
			}
		});
		return {
			held,
			outstanding: outstandingOf(
				held.loan_catalog_entry.rows,
				held.loan_catalog_entry_repayment.rows
			)
		};
	}
	async function clearOpenSchedule({ held, outstanding }: Awaited<ReturnType<typeof readLoans>>) {
		const loanIds = new Set(outstanding.map((item) => String(item.row.id)));
		const open = held.loan_catalog_entry_repayment.rows
			.filter((row) => loanIds.has(String(row.loan_id)) && row.payroll_run_id == null)
			.map((row) => ({ target: row.id }));
		if (open.length === 0) return;
		const cleared = await run(bolt.act('loan_catalog_entry_repayment.delete', open));
		if (cleared.kind !== 'committed')
			throw new Error('The open loan schedule could not be cleared.');
	}
	async function catalogCodes(outstanding: Awaited<ReturnType<typeof readLoans>>['outstanding']) {
		const ids = [...new Set(outstanding.map((item) => item.row.catalog_id as Id<'loan_catalog'>))];
		if (ids.length === 0) return new Map<string, string>();
		const { loan_catalog } = await bolt.query({
			loan_catalog: { where: { id: { in: ids } }, fields: ['id', 'code'], limit: 10000 }
		});
		return new Map(
			loan_catalog.rows.flatMap((row) =>
				typeof row.code === 'string' ? [[String(row.id), row.code] as const] : []
			)
		);
	}
	/**
	 * A leaver's loans: final pay repays what `recovery` allows, the rest stays open on a recalibrated schedule from
	 * the month after the last day, and HR gets a task and a notice to chase it.
	 */
	async function recoverLoans(current: NonNullable<typeof record>, day: PlainDate) {
		const position = await readLoans(current);
		const { held, outstanding } = position;
		if (outstanding.length === 0 || expectedPay === null) return;
		const plan = loanRecovery({
			loans: outstanding.map((item) => ({ id: String(item.row.id), outstanding: item.amount })),
			expectedPay,
			floorPercent,
			decimals: decimals(currentSettings?.currency)
		});
		await clearOpenSchedule(position);
		const nextMonth = addMonths(PlainDate(`${String(day).slice(0, 7)}-01`), 1);
		for (const item of outstanding) {
			const share = plan.allocations.find((row) => row.id === String(item.row.id));
			if (share === undefined) continue;
			if (share.final > 0) {
				const settled = await run(
					bolt.act('loan_catalog_entry_repayment.create', [
						{
							entity_id: current.entity_id,
							employment_id: current.id,
							loan_id: item.row.id,
							amount: share.final,
							paid_on: day,
							payment_reference:
								share.remaining > 0 ? `${FINAL_SETTLEMENT} (partial)` : FINAL_SETTLEMENT
						}
					])
				);
				if (settled.kind !== 'committed')
					throw new Error('The final loan repayment could not be recorded.');
			}
			if (share.remaining <= 0) continue;
			const period = item.row.repayment_period;
			const oldEnd = isJsonObject(period) && typeof period.to === 'string' ? period.to : '';
			const end =
				oldEnd.slice(0, 7) >= String(nextMonth).slice(0, 7)
					? PlainDate(oldEnd)
					: addMonths(nextMonth, 11);
			const moved = await run(
				bolt.act('loan_catalog_entry.update', [
					{ target: item.row.id, set: { repayment_period: { from: addDays(day, 1), to: end } } }
				])
			);
			if (moved.kind !== 'committed')
				throw new Error('The remaining loan period could not be updated.');
			const schedule = buildLoanSchedule({
				principal: share.remaining,
				from: String(nextMonth),
				to: String(end),
				repayments: []
			}).create;
			const scheduled = await run(
				bolt.act(
					'loan_catalog_entry_repayment.create',
					schedule.map((row) => ({
						entity_id: current.entity_id,
						employment_id: current.id,
						loan_id: item.row.id,
						amount: row.amount,
						paid_on: PlainDate(row.paid_on)
					}))
				)
			);
			if (scheduled.kind !== 'committed')
				throw new Error('The remaining loan schedule could not be created.');
		}
		if (plan.remaining <= 0) return;
		const task = await run(
			bolt.act('obligation.create', [
				{
					entity_id: current.entity_id,
					employee_id: current.employee_id,
					employment_id: current.id,
					title: t('contract.loan_recovery_task', {
						number: current.employee_number ?? '',
						amount: plan.remaining
					}),
					due_on: nextMonth,
					occurrence_key: `LOAN_RECOVERY:${current.id}:exit:${day}`
				}
			])
		);
		if (task.kind !== 'committed') throw new Error('The loan recovery task could not be raised.');
	}
	async function transferOrSettleLoans(
		current: NonNullable<typeof record>,
		target: {
			id: Id<'employee_contract'>;
			entityId: Id<'entity'>;
			settingsId: Id<'jurisdiction_settings'>;
		},
		day: PlainDate,
		carry: boolean
	) {
		const position = await readLoans(current);
		const { held, outstanding } = position;
		if (outstanding.length === 0) return;
		if (carry) {
			const moved = await run(
				bolt.act(
					'loan_catalog_entry.update',
					outstanding.map((item) => ({
						target: item.row.id,
						set: { entity_id: target.entityId, employment_id: target.id }
					}))
				)
			);
			if (moved.kind !== 'committed')
				throw new Error('The carried loan could not be moved to the replacement contract.');
			const loanIds = new Set(outstanding.map((item) => String(item.row.id)));
			const open = held.loan_catalog_entry_repayment.rows
				.filter((row) => loanIds.has(String(row.loan_id)) && row.payroll_run_id == null)
				.map((row) => ({
					target: row.id,
					set: { entity_id: target.entityId, employment_id: target.id }
				}));
			if (open.length > 0) {
				const movedSchedule = await run(bolt.act('loan_catalog_entry_repayment.update', open));
				if (movedSchedule.kind !== 'committed')
					throw new Error(
						'The carried loan schedule could not be moved to the replacement contract.'
					);
			}
			return;
		}
		await clearOpenSchedule(position);
		const oldCodes = await catalogCodes(outstanding);
		const targetCatalogs = (
			await bolt.query({
				loan_catalog: {
					where: { settings_id: { eq: target.settingsId } },
					fields: ['id', 'code'],
					limit: 10000
				}
			})
		).loan_catalog.rows;
		const targetByCode = new Map(
			targetCatalogs.flatMap((row) =>
				typeof row.code === 'string' ? [[row.code, row.id as Id<'loan_catalog'>] as const] : []
			)
		);
		for (const item of outstanding) {
			const oldCode = oldCodes.get(String(item.row.catalog_id)) ?? 'LOAN';
			const targetCatalogId = targetByCode.get(oldCode);
			const disposition = loanDisposition({
				carry,
				settle: settleLoans,
				targetCatalog: targetCatalogId !== undefined
			});
			if (disposition === 'CARRY') continue;
			if (disposition === 'SETTLE') {
				const settled = await run(
					bolt.act('loan_catalog_entry_repayment.create', [
						{
							entity_id: current.entity_id,
							employment_id: current.id,
							loan_id: item.row.id,
							amount: item.amount,
							paid_on: day,
							payment_reference: 'Transfer settlement'
						}
					])
				);
				if (settled.kind !== 'committed')
					throw new Error('The outstanding loan could not be settled.');
				continue;
			}
			if (targetCatalogId === undefined)
				throw new Error('The target jurisdiction has no matching loan catalogue.');
			const period = item.row.repayment_period;
			const start = addDays(day, 1);
			const oldEnd =
				period !== null && typeof period === 'object' && !Array.isArray(period)
					? String(Reflect.get(period, 'to') ?? '')
					: '';
			const end =
				oldEnd !== '' && oldEnd > String(start) ? PlainDate(oldEnd) : addMonths(start, 12);
			const created = await run(
				bolt.act('loan_catalog_entry.create', [
					{
						entity_id: target.entityId,
						employment_id: target.id,
						catalog_id: targetCatalogId,
						quantity: item.amount,
						repayment_period: { from: start, to: end }
					}
				])
			);
			if (created.kind !== 'committed')
				throw new Error('The replacement loan could not be created.');
			const newLoanId = created.records.find((row) => row.model === 'loan_catalog_entry')?.id;
			if (newLoanId === undefined) throw new Error('The replacement loan has no id.');
			const months = Math.max(
				1,
				Math.min(
					120,
					(Number(String(end).slice(0, 4)) - Number(String(start).slice(0, 4))) * 12 +
						Number(String(end).slice(5, 7)) -
						Number(String(start).slice(5, 7)) +
						1
				)
			);
			const base = Math.floor((item.amount / months) * 100) / 100;
			const schedule = Array.from({ length: months }, (_, index) => ({
				entity_id: target.entityId,
				employment_id: target.id,
				loan_id: newLoanId,
				amount:
					index === months - 1 ? Math.round((item.amount - base * (months - 1)) * 100) / 100 : base,
				paid_on: addMonths(start, index)
			}));
			const scheduled = await run(bolt.act('loan_catalog_entry_repayment.create', schedule));
			if (scheduled.kind !== 'committed')
				throw new Error('The replacement loan schedule could not be created.');
		}
	}
	async function commitChange() {
		if (record === null || action === null || !detailsValid || changeSaving) return;
		const current = record;
		const kind = action;
		const day = lastDay;
		if (day === null) return;
		const changeNote = note.trim();
		changeSaving = true;
		changeError = null;
		try {
			if (kind === 'TERMINATE') {
				await recoverLoans(current, day);
				const outcome = await run(
					bolt.act('employee_contract.update', [
						{
							target: current.id,
							set: {
								effective_range: { from: current.effective_range.from, to: day },
								reason: changeNote,
								...(finalPayDueOn === null ? {} : { final_pay_due_on: finalPayDueOn }),
								...(exitGround === null ? {} : { exit_ground: exitGround }),
								// the exit answers the jurisdiction reads (a termination cause) go in the save that ends it
								...(extensionEdits === null ? {} : { employee_extension_data: extensionEdits })
							}
						}
					])
				);
				notifyOutcome(bolt, outcome);
				if (outcome.kind === 'committed') {
					changeSaving = false;
					closeChange();
					openRecord('employee_contract', current.id);
				}
				return;
			}
			const target = targetSettings;
			if (target === null)
				throw new Error(
					'No sealed law of the target company is in force when this version starts.'
				);
			const baseTerms = { ...current.terms };
			if (!sameJurisdiction) {
				for (const field of categoryFields) Reflect.deleteProperty(baseTerms, field.name);
				Reflect.deleteProperty(baseTerms, 'work_authorisation_category');
			}
			const terms = {
				...baseTerms,
				job_title: jobTitle.trim(),
				department: department.trim(),
				rate: {
					...(current.terms.rate ?? {}),
					amount: salaryAmount ?? 0,
					unit: salaryUnit
				},
				...(sameJurisdiction
					? {}
					: Object.fromEntries(
							categoryFields.flatMap((field) =>
								field.value.trim() === '' ? [] : [[field.name, field.value.trim()]]
							)
						))
			};
			const label =
				kind === 'PROMOTION'
					? t('contract.promotion')
					: kind === 'LIFE_EVENT'
						? t('contract.life_event')
						: t('contract.transfer');
			const startsOn = nextDay ?? day;
			if (kind !== 'TRANSFER' && startsOn > today) {
				const filed = await run(
					bolt.act(
						'contract_change.create',
						[
							...changesBetween(current.engagement, engagement, 'engagement'),
							...changesBetween(current.terms, terms, 'terms'),
							...(kind === 'LIFE_EVENT'
								? [
										...changesBetween(current.events, targetEvents, 'events'),
										...changesBetween(current.family, targetFamily, 'family'),
										...changesBetween(
											current.employee_extension_data,
											targetExtension,
											'employee_extension_data'
										)
									]
								: [])
						].map((change) => ({
							...change,
							employee_id: current.employee_id,
							effective_from: startsOn,
							notes: `${label}${changeNote === '' ? '' : ` · ${changeNote}`}`
						}))
					)
				);
				notifyOutcome(bolt, filed);
				if (filed.kind === 'committed') {
					changeSaving = false;
					closeChange();
				}
				return;
			}
			const created = await run(
				bolt.act('employee_contract.create', [
					{
						employee_id: current.employee_id,
						entity_id: targetEntity ?? current.entity_id,
						// the same company keeps its pay group; another company's is its only one, or HR's choice before sealing
						...((targetEntity ?? current.entity_id) === current.entity_id &&
						current.pay_group_id != null
							? { pay_group_id: current.pay_group_id }
							: {}),
						engagement,
						employee_number: current.employee_number,
						terms,
						payroll: current.payroll,
						bank: current.bank,
						employee_extension_data:
							(transferring || kind === 'LIFE_EVENT') && targetExtensionSchema !== null
								? targetExtension
								: current.employee_extension_data,
						// the person's dated facts move with them inside one jurisdiction
						...(kind === 'LIFE_EVENT'
							? { events: targetEvents }
							: sameJurisdiction && current.events != null
								? { events: current.events }
								: {}),
						// the family is the person's, whatever the jurisdiction
						family: targetFamily,
						signed_contract_period: current.signed_contract_period,
						// credited service stays with the stint; worked-out service needs no copy
						service_started_on: sameJurisdiction ? (current.service_started_on ?? null) : null,
						effective_range: { from: nextDay ?? day, to: null },
						reason: `${label}${changeNote === '' ? '' : ` · ${changeNote}`}`,
						status: 'DRAFT'
					}
				])
			);
			if (created.kind !== 'committed') {
				notifyOutcome(bolt, created);
				return;
			}
			const createdId = created.records.find((row) => row.model === 'employee_contract')?.id;
			if (createdId === undefined) throw new Error('The replacement draft was not created.');
			await transferOrSettleLoans(
				current,
				{
					id: createdId,
					entityId: targetEntity ?? current.entity_id,
					settingsId: target
				},
				day,
				sameJurisdiction
			);
			const ended = await run(
				bolt.act('employee_contract.update', [
					{
						target: current.id,
						set: {
							effective_range: { from: current.effective_range.from, to: day },
							reason: `${label}${changeNote === '' ? '' : ` · ${changeNote}`}`
						}
					}
				])
			);
			if (ended.kind !== 'committed') {
				notifyOutcome(bolt, ended);
				return;
			}
			const sealed = await run(
				bolt.act('employee_contract.update', [{ target: createdId, set: { status: 'SEALED' } }])
			);
			notifyOutcome(bolt, sealed);
			if (sealed.kind === 'committed') {
				changeSaving = false;
				closeChange();
				openRecord('employee_contract', createdId);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : t('component.error');
			changeError = message;
			toast.error(message);
		} finally {
			changeSaving = false;
		}
	}
	function sealContract() {
		if (record === null || changeSaving) return;
		changeSaving = true;
		fork(
			bolt.act('employee_contract.update', [{ target: record.id, set: { status: 'SEALED' } }]).pipe(
				Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (outcome.kind === 'committed') openRecord('employee_contract', record.id);
					})
				),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (changeSaving = false)))
			)
		);
	}
	function beginVoid() {
		voidReason = '';
		voiding = true;
	}
	function voidContract() {
		if (record === null || voidSaving || voidReason.trim() === '') return;
		const id = record.id;
		const note = voidReason.trim();
		voidSaving = true;
		fork(
			bolt
				.act('employee_contract.update', [{ target: id, set: { status: 'VOID', reason: note } }])
				.pipe(
					Effect.tap((outcome) => Effect.sync(() => notifyOutcome(bolt, outcome))),
					Effect.tap((outcome) =>
						Effect.sync(() => {
							if (outcome.kind !== 'committed') return;
							voiding = false;
							openRecord('employee_contract', id);
						})
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (voidSaving = false)))
				)
		);
	}

	const actionTitle = $derived(
		action === 'PROMOTION'
			? t('contract.promotion')
			: action === 'LIFE_EVENT'
				? t('contract.life_event')
				: action === 'TRANSFER'
					? t('contract.transfer')
					: t('contract.terminate')
	);
</script>

{#snippet extension(field: FieldEditor)}<VersionFacts
		{field}
		versionId={formLaw(field.form.values)}
		subject="EMPLOYEE"
	/>{/snippet}
{#snippet terms(field: FieldEditor)}<ContractTermsEditor
		{field}
		versionId={formLaw(field.form.values)}
	/>{/snippet}

{#snippet details()}
	<Form
		of="employee_contract"
		mode={view.mode === 'create' ? 'create' : 'update'}
		{...record === null
			? { values: view.mode === 'create' ? view.values : {} }
			: { id: record.id, record }}
	>
		{#snippet children()}<Columns count={2}
				>{#each ['entity_id', 'pay_group_id', 'employee_id', 'engagement', 'effective_range', 'terms', 'payroll', 'employee_extension_data', 'events', 'family', 'bank', 'signed_contract_period', 'final_pay_due_on', 'reason'] as name (name)}<Field
						{name}
						{...name === 'employee_extension_data'
							? { editor: extension }
							: name === 'terms'
								? { editor: terms }
								: {}}
					/>{/each}</Columns
			>{/snippet}
	</Form>
{/snippet}

{#snippet targetFacts()}
	{#if targetExtensionSchema !== null}
		<div class="grid gap-1" data-target-extension>
			<span class="text-xs font-medium text-muted-foreground"
				>{action === 'LIFE_EVENT'
					? t('contract.life_event_data')
					: action === 'TERMINATE'
						? t('contract.exit_answers')
						: t('contract.target_extension')}</span
			>
			<Editor
				id="contract-target-extension"
				name="employee_extension_data"
				kind={{ kind: 'json' }}
				jsonSchema={targetExtensionSchema}
				value={targetExtension}
				disabled={changeSaving}
				onChange={(next) => (extensionEdits = isJsonObject(next) ? next : null)}
			/>
		</div>
	{:else}
		<p class="text-xs text-muted-foreground">{t('contract.target_extension_none')}</p>
	{/if}
{/snippet}

{#snippet contractActions()}
	{#if record !== null}
		{#if record.status === 'DRAFT'}
			<Button disabled={changeSaving} onclick={sealContract}>{t('contract.seal')}</Button>
		{:else if record.status === 'SEALED' && record.effective_range.to == null}
			<Button variant="outline" onclick={() => beginChange('PROMOTION')}
				>{t('contract.promotion')}</Button
			>
			<Button variant="outline" onclick={() => beginChange('LIFE_EVENT')}
				>{t('contract.life_event')}</Button
			>
			<Button variant="outline" onclick={() => beginChange('TRANSFER')}
				>{t('contract.transfer')}</Button
			>
			<Button variant="outline" onclick={() => beginChange('TERMINATE')}
				>{t('contract.terminate')}</Button
			>
		{:else if record.status === 'SEALED'}
			<Button variant="destructive" onclick={beginVoid}>{t('contract.void')}</Button>
		{/if}
	{/if}
{/snippet}

{#if record !== null}
	<Sheet open={action !== null} onOpenChange={(open) => !open && closeChange()} title={actionTitle}>
		<Stack gap="md">
			{#if changeError !== null}
				<p class="text-sm text-destructive">{changeError}</p>
			{/if}
			{#if step === 1}
				<p class="text-muted-foreground text-sm">
					{action === 'TERMINATE'
						? t('contract.termination_help')
						: action === 'LIFE_EVENT'
							? t('contract.life_event_help')
							: t('contract.change_help')}
				</p>
				{#if action !== 'TERMINATE'}
					<label class="grid gap-1" for="contract-change-month">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.takes_effect')}</span
						>
						<Combobox
							id="contract-change-month"
							options={months}
							value={nextDay}
							disabled={changeSaving}
							aria-label={t('contract.takes_effect')}
							onChange={(next) => (lastDay = next === null ? null : addDays(PlainDate(next), -1))}
						/>
					</label>
				{:else}
					<label class="grid gap-1" for="contract-change-last-day">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.last_working_day')}</span
						>
						<Editor
							id="contract-change-last-day"
							name="last_day"
							kind={{ kind: 'date' }}
							value={lastDay}
							disabled={changeSaving}
							onChange={(next) => (lastDay = next == null ? null : PlainDate(String(next)))}
						/>
					</label>
				{/if}
				{#if lastDayInvalid}
					<p class="text-xs text-destructive">{t('contract.last_day_invalid')}</p>
				{/if}
				{#if action === 'TRANSFER'}
					<label class="grid gap-1" for="contract-target-entity">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.target_entity')}</span
						>
						<Combobox
							id="contract-target-entity"
							options={entityOptions}
							value={targetEntity}
							disabled={changeSaving}
							onChange={chooseEntity}
						/>
					</label>
				{/if}
				{#if action === 'LIFE_EVENT'}
					<div class="grid gap-1">
						<span class="text-xs font-medium text-muted-foreground">{t('contract.events')}</span>
						<Editor
							id="contract-events"
							name="events"
							kind={EVENTS}
							value={targetEvents}
							disabled={changeSaving}
							onChange={(next) => (eventsEdit = next)}
						/>
					</div>
					<div class="grid gap-1">
						<span class="text-xs font-medium text-muted-foreground">{t('contract.family')}</span>
						<Editor
							id="contract-family"
							name="family"
							kind={FAMILY}
							value={targetFamily}
							disabled={changeSaving}
							onChange={(next) => (familyEdit = next)}
						/>
					</div>
					{@render targetFacts()}
				{:else if action !== 'TERMINATE'}
					<label class="grid gap-1" for="contract-change-title">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.next_job_title')}</span
						>
						<Editor
							id="contract-change-title"
							name="job_title"
							kind={{ kind: 'text' }}
							value={jobTitle}
							disabled={changeSaving}
							onChange={(next) => (jobTitle = next == null ? '' : String(next))}
						/>
					</label>
					<label class="grid gap-1" for="contract-change-department">
						<span class="text-xs font-medium text-muted-foreground">{t('contract.department')}</span
						>
						<Editor
							id="contract-change-department"
							name="department"
							kind={{ kind: 'text' }}
							value={department}
							disabled={changeSaving}
							onChange={(next) => (department = next == null ? '' : String(next))}
						/>
					</label>
					<label class="grid gap-1" for="contract-change-salary">
						<span class="text-xs font-medium text-muted-foreground">{t('contract.salary')}</span>
						<Editor
							id="contract-change-salary"
							name="salary"
							kind={{ kind: 'number', min: 0 }}
							value={salaryAmount}
							disabled={changeSaving}
							onChange={(next) => (salaryAmount = typeof next === 'number' ? next : null)}
						/>
					</label>
					<label class="grid gap-1" for="contract-change-unit">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.salary_unit')}</span
						>
						<Combobox
							id="contract-change-unit"
							options={[
								{ value: 'MONTHLY', label: t('contract.unit_monthly') },
								{ value: 'DAILY', label: t('contract.unit_daily') },
								{ value: 'HOURLY', label: t('contract.unit_hourly') }
							]}
							value={salaryUnit}
							disabled={changeSaving}
							onChange={(next) => (salaryUnit = (next ?? 'MONTHLY') as SalaryUnit)}
						/>
					</label>
					<label class="grid gap-1" for="contract-change-engagement">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.engagement_type')}</span
						>
						<Combobox
							id="contract-change-engagement"
							options={[
								{ value: 'EMPLOYEE', label: t('contract.engagement_employee') },
								{ value: 'PART_TIME', label: t('contract.engagement_part_time') },
								{ value: 'CONTRACTOR', label: t('contract.engagement_contractor') },
								{ value: 'CONSULTANT', label: t('contract.engagement_consultant') },
								{ value: 'INTERN', label: t('contract.engagement_intern') }
							]}
							value={engagement}
							disabled={changeSaving}
							onChange={(next) => (engagement = (next ?? 'EMPLOYEE') as Engagement)}
						/>
					</label>
				{/if}
				{#if transferring}
					{#each categoryFields as field (field.name)}
						<label class="grid gap-1" for="contract-{field.name}">
							<span class="text-xs font-medium text-muted-foreground">{field.label}</span>
							{#if field.values === undefined}
								<Editor
									id="contract-{field.name}"
									name={field.name}
									kind={{ kind: 'text' }}
									value={field.value}
									disabled={changeSaving}
									onChange={(next) =>
										(categoryEdits = { ...categoryEdits, [field.name]: String(next ?? '') })}
								/>
							{:else}
								<Combobox
									id="contract-{field.name}"
									options={field.values.map((value) => ({ value, label: value }))}
									value={field.value === '' ? null : field.value}
									disabled={changeSaving}
									onChange={(next) =>
										(categoryEdits = { ...categoryEdits, [field.name]: String(next ?? '') })}
								/>
							{/if}
						</label>
					{/each}
					{@render targetFacts()}
				{/if}
				{#if loanTotal > 0 && action !== 'TERMINATE' && !sameJurisdiction}
					<label class="flex items-center gap-2 text-sm" for="contract-settle-loans">
						<Editor
							id="contract-settle-loans"
							name="settle_loans"
							kind={{ kind: 'bool' }}
							value={settleLoans}
							disabled={changeSaving}
							onChange={(next) => (settleLoans = next === true)}
						/>
						<span>{t('contract.settle_loan')}</span>
					</label>
				{/if}
				{#if action === 'TERMINATE' && outstandingLoans.length > 0}
					<Stack gap="sm">
						<h3 class="font-medium">{t('contract.loan_recovery')}</h3>
						{#each outstandingLoans as item (item.row.id)}
							<p class="text-sm">
								{t('contract.loan_outstanding', {
									amount: item.amount,
									final:
										recovery?.allocations.find((row) => row.id === String(item.row.id))?.final ?? 0
								})}
							</p>
						{/each}
						<label class="grid gap-1" for="contract-expected-pay">
							<span class="text-xs font-medium text-muted-foreground"
								>{t('contract.expected_final_pay')}</span
							>
							<Editor
								id="contract-expected-pay"
								name="expected_final_pay"
								kind={{ kind: 'number', min: 0 }}
								value={expectedPay}
								disabled={changeSaving}
								onChange={(next) => (expectedPayEdit = typeof next === 'number' ? next : null)}
							/>
							<span class="text-xs text-muted-foreground">{recoveryBasis}</span>
						</label>
						{#if recovery !== null}
							<p class="text-sm text-muted-foreground" data-recovery-summary>
								{t('contract.recovery_summary', {
									outstanding: outstandingLoans.reduce((sum, item) => sum + item.amount, 0),
									floor: floorPercent,
									maximum: recovery.maximum,
									proposed: recovery.proposed,
									remaining: recovery.remaining
								})}
							</p>
							{#if recovery.remaining > 0}
								<p class="text-sm text-amber-700 dark:text-amber-300" data-recovery-notice>
									{t('contract.recovery_notice', { remaining: recovery.remaining })}
								</p>
							{/if}
						{/if}
					</Stack>
				{/if}
				{#if action === 'TERMINATE'}
					<label class="grid gap-1" for="contract-exit-ground">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.exit_ground')}</span
						>
						<Editor
							id="contract-exit-ground"
							name="exit_ground"
							kind={EXIT_GROUND}
							value={exitGround}
							disabled={changeSaving}
							onChange={(next) =>
								(exitGround = EXIT_GROUNDS.find((ground) => ground === next) ?? null)}
						/>
					</label>
					{@render targetFacts()}
					<label class="grid gap-1" for="contract-final-pay-due">
						<span class="text-xs font-medium text-muted-foreground"
							>{t('contract.final_pay_due')}</span
						>
						<Editor
							id="contract-final-pay-due"
							name="final_pay_due_on"
							kind={{ kind: 'date' }}
							value={finalPayDueOn}
							disabled={changeSaving}
							onChange={(next) => (finalPayDueOn = next == null ? null : PlainDate(String(next)))}
						/>
					</label>
				{/if}
				<label class="grid gap-1" for="contract-change-note">
					<span class="text-xs font-medium text-muted-foreground">{t('contract.reason')}</span>
					<Editor
						id="contract-change-note"
						name="reason"
						kind={{ kind: 'text' }}
						value={note}
						disabled={changeSaving}
						onChange={(next) => (note = next == null ? '' : String(next))}
					/>
				</label>
				<Cluster gap="sm" justify="end">
					<Button variant="outline" disabled={changeSaving} onclick={closeChange}
						>{t('component.cancel')}</Button
					>
					<Button disabled={changeSaving || !detailsValid} onclick={() => (step = 2)}
						>{t('contract.continue')}</Button
					>
				</Cluster>
			{:else}
				<Stack gap="sm">
					<h3 class="font-medium">{t('contract.confirm_changes')}</h3>
					<p class="text-sm">{actionTitle} · {String(lastDay)}</p>
					{#if action === 'TERMINATE'}
						<p class="text-sm">{t('contract.reason')}: {note}</p>
						<p class="text-sm text-muted-foreground">
							{t('contract.leave_encash_preview', { days: leaveDays })}
						</p>
					{:else}
						<p class="text-sm">
							{t('contract.target_entity')}: {targetEntityRow?.name ?? '—'}
						</p>
						<p class="text-sm">{t('contract.next_job_title')}: {jobTitle}</p>
						<p class="text-sm">
							{t('contract.salary')}: {salaryAmount ?? 0}
							{salaryUnit}
						</p>
						{#if transferring}
							<p class="text-sm text-muted-foreground">
								{categoryFields.map((field) => `${field.label}: ${field.value || '—'}`).join(' · ')}
							</p>
						{/if}
						<p class="text-sm text-muted-foreground">
							{sameJurisdiction
								? t('contract.leave_carry_preview', { days: leaveDays })
								: t('contract.leave_settle_preview', { days: leaveDays })}
						</p>
					{/if}
					{#if action === 'TERMINATE' && recovery !== null && outstandingLoans.length > 0}
						<p class="text-sm text-muted-foreground">
							{t('contract.recovery_confirm', {
								proposed: recovery.proposed,
								remaining: recovery.remaining
							})}
						</p>
					{:else if loanTotal > 0 && action !== 'TERMINATE'}
						<p class="text-sm text-muted-foreground">
							{sameJurisdiction
								? t('contract.loan_carry_preview', { amount: loanTotal })
								: t('contract.loan_preview', { amount: loanTotal })}
						</p>
					{/if}
				</Stack>
				<Cluster gap="sm" justify="end">
					<Button variant="outline" disabled={changeSaving} onclick={() => (step = 1)}
						>{t('contract.back')}</Button
					>
					<Button disabled={changeSaving} onclick={commitChange}>{t('contract.confirm')}</Button>
				</Cluster>
			{/if}
		</Stack>
	</Sheet>
	<Sheet bind:open={voiding} title={t('contract.void_title')}>
		<Stack gap="md">
			<p class="text-muted-foreground text-sm">{t('contract.void_help')}</p>
			<label class="grid gap-1" for="contract-void-reason">
				<span class="text-xs font-medium text-muted-foreground">{t('contract.reason')}</span>
				<Textarea id="contract-void-reason" bind:value={voidReason} disabled={voidSaving} />
			</label>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={voidSaving} onclick={() => (voiding = false)}
					>{t('component.cancel')}</Button
				>
				<Button
					variant="destructive"
					disabled={voidSaving || voidReason.trim() === ''}
					onclick={voidContract}>{t('contract.void')}</Button
				>
			</Cluster>
		</Stack>
	</Sheet>
{/if}

<RecordShell
	of="employee_contract"
	mode={view.mode}
	badge={stateBadge}
	lock={record !== null && record.status !== 'DRAFT' ? t('contract.read_only') : undefined}
	footerActions={contractActions}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{@render details()}
</RecordShell>
