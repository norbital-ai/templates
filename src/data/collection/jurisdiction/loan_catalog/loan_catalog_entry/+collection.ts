import { collection, type TransformCtx } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { PlainDate } from '@norbital-ai/std/date';
import { Decimal } from '@norbital-ai/std/decimal';
import { buildLoanSchedule, validateLoanRepayments } from '../../../../../lib/loan_schedule.js';
import { loanAmount, loanCalendar, loanRuleFacts } from '../../../../../lib/loan_values.js';
import {
	admitEntry,
	entrySettlementLocks,
	loadEntry
} from '../../../../../lib/payroll_engine/admit.js';
import { runEngine } from '../../../../../lib/payroll_engine/foundation.js';

const columns = [
	'catalog_id',
	'employment_id',
	'principal_amount',
	'repayment_period',
	'repayment_frequency',
	'advance_made_on',
	'facts'
] as const;
const c = collection('loan_catalog_entry', {
	read: { fields: 'all', relations: 'all' },
	create: {
		input: {
			columns,
			filled: ['company_id'],
			with: {
				repayments: {
					create: {
						columns: ['occurred_on', 'amount'],
						filled: ['catalog_id', 'company_id', 'employment_id']
					}
				}
			}
		}
	},
	update: {
		input: {
			columns,
			with: {
				repayments: {
					create: {
						columns: ['occurred_on', 'amount'],
						filled: ['catalog_id', 'company_id', 'employment_id']
					},
					update: { columns: ['occurred_on', 'amount'] },
					delete: {}
				}
			}
		}
	},
	delete: { transform: true }
});
export default c;

c.transform(function* (inputs, ctx: TransformCtx<'loan_catalog_entry'>) {
	const ids = ctx.existing.flatMap((row) => (row === undefined ? [] : [row.id]));
	const catalogIds = [
		...new Set(
			inputs.flatMap((input, i) => {
				const id =
					('catalog_id' in input ? input.catalog_id : undefined) ?? ctx.existing[i]?.catalog_id;
				return id == null ? [] : [id];
			})
		)
	];
	// the schedule's money and calendar come from the version governing each loan class
	const {
		children: stored,
		classes,
		versions
	} = yield* ctx.db.read({
		children: { collection: 'loan_repayment_entry', where: { loan_id: { in: ids } }, all: true },
		classes: {
			collection: 'loan_catalog',
			where: { id: { in: catalogIds } },
			select: { id: true, settings_id: true },
			all: true
		},
		versions: {
			collection: 'jurisdiction_settings',
			where: { id: { in: { member: 'classes', field: 'settings_id' } } },
			select: { id: true, payroll: true },
			all: true
		}
	});
	const children = stored.rows;
	const calendarOf = (catalogId: string) =>
		loanCalendar(
			versions.rows.find(
				(version) => version.id === classes.rows.find((row) => row.id === catalogId)?.settings_id
			)?.payroll
		);
	const plans = [];
	for (const [i, input] of inputs.entries()) {
		const before = ctx.existing[i];
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
				{ ...draft, occurred_on: PlainDate(draft.occurred_on), amount: loanAmount(draft.amount) }
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
		let generated: readonly { occurred_on: PlainDate; amount: Decimal; activity: 'AWARD' }[] =
			created.map((child) => ({
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
			row,
			principal_amount,
			repayment_period,
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
	const [locked, prefetched] = yield* Effect.all(
		[
			entrySettlementLocks(
				ctx.db.read,
				'loan_repayment_entry',
				children.map((child) => child.id)
			),
			plans.length === 0
				? Effect.succeed(undefined)
				: loadEntry(ctx.db.read, 'loan_repayment_entry', admissionRequests, {
						loan_repayment_entry: plans.map((plan) => plan.catalog_id)
					})
		],
		{ concurrency: 'unbounded' }
	).pipe(Effect.catchTag('Refusal', (error) => ctx.refuse(error.message)));
	for (const [index, input] of inputs.entries()) {
		const before = ctx.existing[index];
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
	const out = [];
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
			ctx.db.read,
			ctx.refuse
		);
		const catalog = prefetched.loanCatalogues.find((row) => row.id === admitted.catalog_id);
		if (catalog == null) return yield* ctx.refuse('Choose an available loan type.');
		const stored = children.filter((child) => child.loan_id === ctx.existing[i]?.id);
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
				ctx.db.read,
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
		const updates = [];
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
			updates.push({ target: child.id, set: yield* bindRepayment(child) });
		}
		const created = [];
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
				...(ctx.existing[i] === undefined
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
