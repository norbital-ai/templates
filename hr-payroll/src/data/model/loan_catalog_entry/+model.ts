import {
	model,
	type WriteCtx,
	type CreateRow,
	type UpdateSet,
	type StoredRow,
	type Id
} from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { buildLoanSchedule, validateLoanRepayments } from '../../../lib/loan_schedule.js';
import { loanAmount, loanCalendar, loanRuleFacts } from '../../../lib/loan_values.js';
import {
	admitEntry,
	entrySettlementLocks,
	entryLocksFrom,
	loadEntry
} from '../../../lib/payroll_engine/admit.js';
import { runEngine } from '../../../lib/payroll_engine/foundation.js';
import { moved, tap } from '../../../lib/payroll_engine/taps.js';

const columns = [
	'catalog_id',
	'employment_id',
	'principal_amount',
	'repayment_period',
	'repayment_frequency',
	'advance_made_on',
	'facts'
] as const;

/** A create's repayment rows enter as the update's `{ create }` changes, so both verbs plan one schedule shape. */
type WriteInput = Omit<UpdateSet<'loan_catalog_entry'>, 'id'> &
	Partial<Omit<CreateRow<'loan_catalog_entry'>, 'id' | 'repayments'>> & {
		readonly id?: Id<'loan_catalog_entry'>;
		readonly $delete?: true;
	};

type RepaymentWrites = NonNullable<UpdateSet<'loan_catalog_entry'>['repayments']>;
type RepaymentCreate = NonNullable<RepaymentWrites['create']>[number];
type ScheduleRepayment = {
	readonly occurred_on: PlainDate;
	readonly amount: Decimal;
	readonly activity: 'AWARD';
};
type LoanPlan = {
	readonly index: number;
	readonly principal_amount: Decimal;
	readonly catalog_id: StoredRow<'loan_catalog_entry'>['catalog_id'];
	readonly employment_id: Id<'employment_contract'>;
	readonly occurred_on: string;
	readonly facts: ReturnType<typeof loanRuleFacts>;
	readonly drafts: readonly { readonly occurred_on: PlainDate }[];
	readonly generated: readonly ScheduleRepayment[];
	readonly updates: NonNullable<RepaymentWrites['update']>;
	readonly removed: NonNullable<RepaymentWrites['delete']>;
};

const transformRows = Effect.fnUntraced(function* (
	inputs: readonly WriteInput[],
	existing: readonly (StoredRow<'loan_catalog_entry'> | undefined)[],
	ctx: WriteCtx<'loan_catalog_entry'>
) {
	const ids = existing.flatMap((row) => (row === undefined ? [] : [row.id]));
	const catalogIds = [
		...new Set(
			inputs.flatMap((input, i) => {
				const id =
					('catalog_id' in input ? input.catalog_id : undefined) ?? existing[i]?.catalog_id;
				return id == null ? [] : [id];
			})
		)
	];
	// the schedule's money and calendar come from the version governing each loan class
	const { loan_repayment_entry: stored, loan_catalog: classes } = yield* ctx.db.query({
		loan_repayment_entry: { where: { loan_id: { in: ids } } },
		loan_catalog: { where: { id: { in: catalogIds } }, fields: ['settings_id'] }
	});
	const { jurisdiction_settings: versions } = yield* ctx.db.query({
		jurisdiction_settings: {
			where: { id: { in: [...new Set(classes.rows.map((row) => row.settings_id))] } },
			fields: ['payroll']
		}
	});
	const children = stored.rows;
	const calendarOf = (catalogId: string) =>
		loanCalendar(
			versions.rows.find(
				(version) => version.id === classes.rows.find((row) => row.id === catalogId)?.settings_id
			)?.payroll
		);
	const plans: LoanPlan[] = [];
	for (const [i, input] of inputs.entries()) {
		const before = existing[i];
		const stored = children.filter((child) => child.loan_id === before?.id);
		if ('$delete' in input) {
			if (stored.some((child) => child.payslip_id != null))
				return yield* ctx.refuse('A loan with repayments on a payslip cannot be deleted.');
			continue;
		}
		const row = { ...before, ...input };
		const changed =
			before === undefined ||
			input.catalog_id !== undefined ||
			input.employment_id !== undefined ||
			input.principal_amount !== undefined ||
			input.repayment_period !== undefined ||
			input.repayment_frequency !== undefined ||
			input.advance_made_on !== undefined ||
			input.facts !== undefined ||
			input.repayments !== undefined;
		if (!changed) continue;
		if (row.catalog_id == null) return yield* ctx.refuse('Choose the loan type.');
		const calendar = calendarOf(row.catalog_id);
		if (calendar === null)
			return yield* ctx.refuse(
				'The loan class’s jurisdiction version states no currency or semi-monthly split.'
			);
		if (row.employment_id == null) return yield* ctx.refuse('Choose the employee’s employment.');
		if (row.principal_amount == null)
			return yield* ctx.refuse('Enter the principal actually lent.');
		if (row.repayment_period == null) return yield* ctx.refuse('Enter the repayment period.');
		if (row.repayment_period.to == null) return yield* ctx.refuse('Enter the last repayment date.');
		const principal_amount = loanAmount(row.principal_amount);
		const repayment_period = {
			from: PlainDate(row.repayment_period.from),
			to: PlainDate(row.repayment_period.to)
		};
		if (
			stored.some((child) => child.payslip_id != null) &&
			(row.employment_id !== before?.employment_id || row.catalog_id !== before?.catalog_id)
		)
			return yield* ctx.refuse(
				'A loan with repayments on a payslip cannot move to another employee or loan type.'
			);
		const removed = input.repayments?.delete ?? [];
		const updates = input.repayments?.update ?? [];
		const drafts = stored.flatMap((child) => {
			if (removed.includes(child.id)) return [];
			const edit = updates.find((update) => update.target === child.id);
			const draft = { ...child, ...edit?.set };
			return [
				{
					...draft,
					occurred_on: PlainDate(draft.occurred_on),
					amount: loanAmount(draft.amount)
				}
			];
		});
		for (const id of removed) {
			const child = stored.find((child) => child.id === id);
			if (child == null) return yield* ctx.refuse('Choose a repayment belonging to this loan.');
			if (child.payslip_id != null)
				return yield* ctx.refuse('A repayment on a payslip cannot be deleted.');
		}
		if (new Set(updates.map((update) => update.target)).size !== updates.length)
			return yield* ctx.refuse('Each repayment can be edited only once in a schedule.');
		for (const update of updates) {
			if (removed.includes(update.target))
				return yield* ctx.refuse('A repayment cannot be edited and deleted together.');
			const child = stored.find((child) => child.id === update.target);
			if (child == null) return yield* ctx.refuse('Choose a repayment belonging to this loan.');
			if (
				child.payslip_id != null &&
				((update.set.occurred_on !== undefined && update.set.occurred_on !== child.occurred_on) ||
					(update.set.amount !== undefined && !loanAmount(update.set.amount).eq(child.amount)))
			)
				return yield* ctx.refuse('A repayment on a payslip cannot be changed.');
		}
		const created = input.repayments?.create ?? [];
		let generated: readonly {
			occurred_on: PlainDate;
			amount: Decimal;
			activity: 'AWARD';
		}[] = created.map((child) => ({
			occurred_on: PlainDate(child.occurred_on),
			amount: loanAmount(child.amount),
			activity: 'AWARD'
		}));
		if (stored.length === 0 && created.length === 0) {
			const schedule = buildLoanSchedule({
				principal_amount,
				repayment_period,
				repayment_frequency: row.repayment_frequency ?? 'MONTHLY',
				...calendar
			});
			if (!schedule.ok) return yield* ctx.refuse(schedule.message);
			generated = schedule.repayments.map((child) => ({
				occurred_on: child.occurred_on,
				amount: child.amount,
				activity: 'AWARD' as const
			}));
		}
		const checked = validateLoanRepayments({
			principal_amount,
			repayment_period,
			repayments: [...drafts, ...generated],
			...calendar
		});
		if (!checked.ok) return yield* ctx.refuse(checked.message);
		plans.push({
			index: i,
			principal_amount,
			catalog_id: row.catalog_id,
			employment_id: row.employment_id,
			occurred_on: row.repayment_period.from,
			facts: loanRuleFacts({ ...row, principal_amount }),
			drafts,
			generated,
			updates,
			removed
		});
	}
	const admissionRequests = plans.flatMap((plan) =>
		[
			plan.occurred_on,
			...plan.drafts.map((child) => child.occurred_on),
			...plan.generated.map((child) => child.occurred_on)
		].map((occurred_on) => ({
			catalog_id: plan.catalog_id,
			employment_id: plan.employment_id,
			occurred_on
		}))
	);
	const candidates = children.map(({ id, employment_id }) => ({ id, employment_id }));
	const prefetched =
		plans.length === 0
			? undefined
			: yield* loadEntry(
					ctx.db.query,
					'loan_repayment_entry',
					admissionRequests,
					{ loan_repayment_entry: plans.map((plan) => plan.catalog_id) },
					candidates
				).pipe(Effect.catchTag('Refusal', (error) => ctx.refuse(error.message)));
	const locked =
		prefetched === undefined
			? yield* entrySettlementLocks(ctx.db.query, 'loan_repayment_entry', candidates)
			: entryLocksFrom(
					'loan_repayment_entry',
					candidates,
					prefetched.lockRuns,
					prefetched.lockSlips
				);
	for (const [index, input] of inputs.entries()) {
		const before = existing[index];
		const captured = children.filter(
			(child) => child.loan_id === before?.id && locked.has(child.id)
		);
		if (captured.length === 0) continue;
		if ('$delete' in input)
			return yield* ctx.refuse('A loan with repayments captured by payroll cannot be deleted.');
		if (
			(input.employment_id !== undefined && input.employment_id !== before?.employment_id) ||
			(input.catalog_id !== undefined && input.catalog_id !== before?.catalog_id)
		)
			return yield* ctx.refuse(
				'A loan with repayments captured by payroll cannot move to another employee or loan type.'
			);
		for (const child of captured) {
			if (input.repayments?.delete?.includes(child.id))
				return yield* ctx.refuse('A repayment captured by payroll cannot be deleted.');
			const update = input.repayments?.update?.find((update) => update.target === child.id);
			if (
				update !== undefined &&
				((update.set.occurred_on !== undefined && update.set.occurred_on !== child.occurred_on) ||
					(update.set.amount !== undefined && !loanAmount(update.set.amount).eq(child.amount)))
			)
				return yield* ctx.refuse('A repayment captured by payroll cannot be changed.');
		}
	}
	if (plans.length === 0) return inputs;
	if (prefetched === undefined || !('loanCatalogues' in prefetched))
		return yield* ctx.refuse('The loan types could not be read.');
	const out: WriteInput[] = [];
	for (const [i, input] of inputs.entries()) {
		const plan = plans.find((plan) => plan.index === i);
		if ('$delete' in input || plan === undefined) {
			out.push(input);
			continue;
		}
		const admitted = yield* runEngine(
			admitEntry({
				collection: 'loan_repayment_entry',
				catalog_id: plan.catalog_id,
				employment_id: plan.employment_id,
				occurred_on: plan.occurred_on,
				values: { amount: plan.principal_amount, facts: plan.facts },
				prefetched
			}),
			ctx.db.query,
			ctx.refuse
		);
		const catalog = prefetched.loanCatalogues.find((row) => row.id === admitted.catalog_id);
		if (catalog == null) return yield* ctx.refuse('Choose an available loan type.');
		const stored = children.filter((child) => child.loan_id === existing[i]?.id);
		const bindRepayment = Effect.fnUntraced(function* (repayment: {
			readonly id?: string;
			readonly occurred_on: string;
			readonly amount: Decimal;
			readonly activity?: string | null;
		}) {
			const admitted = yield* runEngine(
				admitEntry({
					collection: 'loan_repayment_entry',
					...(repayment.id === undefined ? {} : { id: repayment.id }),
					catalog_id: plan.catalog_id,
					employment_id: plan.employment_id,
					occurred_on: repayment.occurred_on,
					activity: repayment.activity ?? 'AWARD',
					values: { amount: repayment.amount, facts: plan.facts },
					prefetched
				}),
				ctx.db.query,
				ctx.refuse
			);
			const catalog = (prefetched.loanCatalogues ?? []).find(
				(row) => row.id === admitted.catalog_id
			);
			if (catalog == null) return yield* ctx.refuse('Choose an available loan type.');
			return {
				catalog_id: catalog.id,
				company_id: admitted.company_id,
				employment_id: plan.employment_id
			};
		});
		const updates: NonNullable<RepaymentWrites['update']>[number][] = [];
		for (const update of plan.updates) {
			const child = stored.find((child) => child.id === update.target);
			if (child == null) return yield* ctx.refuse('Choose a repayment belonging to this loan.');
			updates.push(
				child.payslip_id != null || locked.has(child.id)
					? update
					: {
							...update,
							set: {
								...update.set,
								...(yield* bindRepayment({
									...child,
									occurred_on: update.set.occurred_on ?? child.occurred_on,
									amount: loanAmount(update.set.amount ?? child.amount)
								}))
							}
						}
			);
		}
		for (const child of stored) {
			if (
				child.payslip_id != null ||
				locked.has(child.id) ||
				plan.removed.includes(child.id) ||
				plan.updates.some((update) => update.target === child.id)
			)
				continue;
			updates.push({
				target: child.id,
				set: { occurred_on: child.occurred_on, ...(yield* bindRepayment(child)) }
			});
		}
		const created: RepaymentCreate[] = [];
		for (const repayment of plan.generated)
			created.push({
				...repayment,
				...(yield* bindRepayment(repayment))
			});
		out.push({
			...input,
			company_id: admitted.company_id,
			catalog_id: catalog.id,
			repayments: {
				...(existing[i] === undefined
					? {}
					: {
							delete: plan.removed,
							update: updates
						}),
				create: created
			}
		});
	}
	return out;
});

export default model('loan_catalog_entry', {
	description: 'One principal loan and its agreed repayment terms for one employment.',
	icon: 'lucide:landmark',
	label: 'principal_amount',
	fields: {
		principal_amount: {
			kind: 'decimal',
			scale: 2,
			optional: true,
			help: 'The principal actually lent. Leave unknown legacy principal amounts blank.'
		},
		repayment_period: {
			kind: 'period',
			of: 'date',
			optional: true,
			help: 'The first and last permitted repayment dates. Both are required for a configured loan.'
		},
		repayment_frequency: {
			kind: 'enum',
			values: ['MONTHLY', 'SEMI_MONTHLY'],
			default: 'MONTHLY',
			help: 'The cadence used when recalculating the editable repayment schedule.'
		},
		advance_made_on: {
			kind: 'date',
			optional: true,
			help: 'The actual advance date, where the jurisdiction uses it for repayment timing or an emergency-payment deadline.'
		},
		facts: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			optional: true,
			help: 'Loan inputs the selected loan class reads as entry.facts (for example a permitted advance purpose or a written agreement).'
		},
		catalog_id: { kind: 'ref', to: 'loan_catalog', inverse: 'entry' },
		company_id: { kind: 'ref', to: 'entity', inverse: 'loan_catalog_entry' },
		employment_id: {
			kind: 'ref',
			to: 'employment_contract',
			inverse: 'loan_catalog_entry',
			optional: true
		}
	},
	read: {
		loan_catalog_entry: { fields: 'all' },
		'loan_catalog_entry.repayments': { fields: 'all' }
	},
	create: {
		columns: {
			loan_catalog_entry: columns,
			'loan_catalog_entry.repayments': ['occurred_on', 'amount']
		},
		transform: function* (rows, ctx) {
			const transformed = yield* transformRows(
				rows.map(({ repayments, ...row }) =>
					repayments === undefined ? row : { ...row, repayments: { create: repayments } }
				),
				rows.map(() => undefined),
				ctx
			);
			return rows.map(({ repayments: _given, ...row }, index) => {
				const { id: _id, $delete: _delete, repayments, ...set } = transformed[index] ?? {};
				return {
					...row,
					...set,
					...(repayments?.create === undefined ? {} : { repayments: repayments.create })
				};
			});
		}
	},
	update: {
		columns: {
			loan_catalog_entry: columns,
			'loan_catalog_entry.repayments': ['occurred_on', 'amount']
		},
		transform: function* (changes, ctx) {
			const transformed = yield* transformRows(
				changes.map(({ set }) => set),
				changes.map(({ before }) => before),
				ctx
			);
			return changes.map(({ set: original }, index) => {
				const { id: _id, $delete: _delete, ...set } = transformed[index] ?? {};
				return { ...original, ...set };
			});
		}
	},
	delete: {
		check: function* (rows, ctx) {
			yield* transformRows(
				rows.map(({ id }) => ({ id, $delete: true })),
				rows,
				ctx
			);
		}
	},
	// The jurisdiction behaviour rules for this model's writes (`behaviour_taps`), started as the writer.
	effect: {
		created: function* (rows, ctx) {
			yield* tap(ctx, 'created', { model: 'loan_catalog_entry', ids: rows.map((row) => row.id) });
		},
		updated: function* (changes, ctx) {
			const ids = moved(changes, [
				'principal_amount',
				'repayment_period',
				'repayment_frequency',
				'advance_made_on',
				'facts'
			]);
			yield* tap(ctx, 'updated', { model: 'loan_catalog_entry', ids });
		}
	}
});
