<script lang="ts">
	import {
		Button,
		Form,
		Icon,
		MoneyInput,
		RecordShell,
		Table,
		TimeInput,
		confirmAction,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Decimal } from '@norbital-ai/std/decimal';
	import { PlainDate } from '@norbital-ai/std/date';
	import { Effect } from 'effect';
	import { untrack } from 'svelte';
	import { fork } from '@norbital-ai/ui/effect';
	import { numberOf } from '../../../../../../../lib/payroll_engine/foundation.js';
	import LoanCreateFields from '../../../../../../../lib/ui/payroll/loan_create_fields.svelte';
	import {
		buildLoanSchedule,
		loanScheduleProblems,
		loanScheduleState,
		type LoanScheduleProblem
	} from '../../../../../../../lib/payroll_engine/loan_schedule.js';

	let { view }: { view: RecordView<'loan_catalog_entry'> } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	type Repayment = {
		readonly id: Id<'loan_catalog_entry_repayment'>;
		readonly amount: Decimal;
		readonly paid_on: string | null;
		readonly payroll_run_id: Id<'payroll_run'> | null;
	};
	let rows = $state<readonly Repayment[]>([]);
	let loaded = $state(false);
	let busy = $state(false);
	let reload = $state(0);

	/** A decimal arrives as a number, a numeric string, a Decimal or its `{ $dec }` wire form. */
	const numeric = (value: unknown): number => {
		if (typeof value === 'number') return value;
		if (typeof value === 'string') return Number(value);
		if (value !== null && typeof value === 'object') {
			const decimal = Reflect.get(value, '$dec');
			if (typeof decimal === 'string') return Number(decimal);
			const text = String(value);
			if (text !== '[object Object]') return Number(text);
		}
		return Number.NaN;
	};
	const day = (value: unknown): string => String(value ?? '').slice(0, 10);

	// One read when the record opens and after each write; a table's live query is not needed here.
	$effect(() => {
		const id = record?.id ?? null;
		void reload;
		if (id === null || view.mode === 'create') {
			rows = [];
			loaded = true;
			return;
		}
		loaded = false;
		untrack(() => {
			void (async () => {
				try {
					const answer = await bolt.query({
						loan_catalog_entry_repayment: {
							where: { loan_id: { eq: id } },
							fields: ['id', 'amount', 'paid_on', 'payroll_run_id'],
							orderBy: { paid_on: 'asc' },
							limit: 10000
						}
					});
					rows = answer.loan_catalog_entry_repayment.rows.map((row) => ({
						id: row.id,
						amount: Decimal.of(row.amount),
						paid_on: row.paid_on == null ? null : day(row.paid_on),
						payroll_run_id: row.payroll_run_id ?? null
					}));
				} finally {
					loaded = true;
				}
			})();
		});
	});

	const schedule = $derived(
		record === null
			? null
			: {
					principal: numeric(record.quantity),
					from: day(record.repayment_period.from),
					to: day(record.repayment_period.to),
					repayments: rows.map((row) => ({
						id: row.id,
						amount: numeric(row.amount),
						paid_on: day(row.paid_on),
						payroll_run_id: row.payroll_run_id
					}))
				}
	);
	const scheduleState = $derived(schedule === null ? 'NO_TERMS' : loanScheduleState(schedule));
	const problems = $derived(schedule === null ? [] : loanScheduleProblems(schedule));
	const isLocked = () => record === null || !loaded;
	const label = (problem: LoanScheduleProblem): string =>
		bolt.t(
			problem === 'principal'
				? 'loan.principal_required'
				: problem === 'period'
					? 'loan.period_required'
					: problem === 'amount'
						? 'loan.amount_invalid'
						: problem === 'duplicate'
							? 'loan.month_overlap'
							: problem === 'total'
								? 'loan.must_equal_principal'
								: problem === 'sealed_exceeds'
									? 'loan.sealed_exceeds'
									: problem === 'no_dates'
										? 'loan.no_months'
										: 'loan.invalid_dates'
		);
	const refresh = () => reload++;

	const edit = (row: Repayment, set: Record<string, unknown>) =>
		fork(
			bolt.act('loan_catalog_entry_repayment.update', [{ target: row.id, set }]).pipe(
				Effect.tap(() => Effect.sync(refresh)),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				)
			)
		);
	const remove = (row: Repayment) =>
		fork(
			bolt.act('loan_catalog_entry_repayment.delete', [{ target: row.id }]).pipe(
				Effect.tap(() => Effect.sync(refresh)),
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				)
			)
		);
	const add = () => {
		if (record === null || isLocked() || schedule === null) return;
		busy = true;
		fork(
			bolt
				.act('loan_catalog_entry_repayment.create', [
					{
						entity_id: record.entity_id,
						employment_id: record.employment_id,
						loan_id: record.id,
						amount: 0,
						paid_on: PlainDate(schedule.from)
					}
				])
				.pipe(
					Effect.tap(() => Effect.sync(refresh)),
					Effect.catch((error) =>
						Effect.sync(() =>
							toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
						)
					),
					Effect.ensuring(Effect.sync(() => (busy = false)))
				)
		);
	};

	const regenerate = () => {
		if (record === null || busy || isLocked() || schedule === null) return;
		busy = true;
		fork(
			Effect.gen(function* () {
				const proceed = yield* confirmAction({
					title: bolt.t('loan.generate_title'),
					body: bolt.t('loan.generate_body'),
					confirmLabel: bolt.t('loan.regenerate'),
					destructive: true
				});
				if (!proceed) return;
				let plan: ReturnType<typeof buildLoanSchedule>;
				try {
					plan = buildLoanSchedule(schedule);
				} catch (error) {
					toast.error(error instanceof Error ? error.message : bolt.t('component.error'));
					return;
				}
				if (plan.remove.length > 0)
					yield* bolt.act(
						'loan_catalog_entry_repayment.delete',
						plan.remove.map((target) => ({ target: target as Id<'loan_catalog_entry_repayment'> }))
					);
				if (plan.create.length > 0)
					yield* bolt.act(
						'loan_catalog_entry_repayment.create',
						plan.create.map((row) => ({
							entity_id: record.entity_id,
							employment_id: record.employment_id,
							loan_id: record.id,
							amount: row.amount,
							paid_on: PlainDate(row.paid_on)
						}))
					);
				toast.success(bolt.t('loan.generated'));
				refresh();
			}).pipe(
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (busy = false)))
			)
		);
	};

	const createRepayments = (outcome: {
		readonly kind: string;
		readonly records?: readonly { readonly model: string; readonly id: string }[];
	}) => {
		if (outcome.kind !== 'committed') return;
		const loanId = outcome.records?.find((row) => row.model === 'loan_catalog_entry')?.id;
		if (loanId === undefined) return;
		fork(
			Effect.gen(function* () {
				const answer = yield* bolt.query({
					loan_catalog_entry: {
						where: { id: { eq: loanId as Id<'loan_catalog_entry'> } },
						fields: ['quantity', 'repayment_period', 'entity_id', 'employment_id'],
						limit: 1
					}
				});
				const loan = answer.loan_catalog_entry.rows[0];
				if (loan === undefined) return;
				const plan = buildLoanSchedule({
					principal: numberOf(loan.quantity) ?? 0,
					from: String(loan.repayment_period.from),
					to: String(loan.repayment_period.to),
					repayments: []
				});
				if (plan.create.length === 0) return;
				yield* bolt.act(
					'loan_catalog_entry_repayment.create',
					plan.create.map((row) => ({
						entity_id: loan.entity_id,
						employment_id: loan.employment_id,
						loan_id: loanId as Id<'loan_catalog_entry'>,
						amount: row.amount,
						paid_on: PlainDate(row.paid_on)
					}))
				);
			}).pipe(Effect.ignore)
		);
	};

	const principalProblem = (values: Readonly<Record<string, unknown>>) => {
		const principal = numberOf(values.quantity) ?? 0;
		const paid = rows
			.filter((row) => row.payroll_run_id != null)
			.reduce((total, row) => total + numeric(row.amount), 0);
		return principal < paid
			? [
					{
						field: 'quantity',
						message: 'The principal cannot be less than repayments already included in payroll.'
					}
				]
			: [];
	};

	const rowLocked = (row: Repayment) => isLocked() || row.payroll_run_id != null;
</script>

{#snippet amountCell({ row }: { row: Repayment })}
	<div class="py-1.5">
		<MoneyInput
			scale={2}
			value={row.amount}
			readonly={rowLocked(row)}
			disabled={busy}
			onChange={(amount) => edit(row, { amount })}
		/>
	</div>
{/snippet}

{#snippet dateCell({ row }: { row: Repayment })}
	<div class="py-1.5">
		<TimeInput
			of="date"
			precision="month"
			value={row.paid_on == null ? null : day(row.paid_on)}
			readonly={rowLocked(row)}
			disabled={busy}
			onChange={(paid_on: string | null) =>
				edit(row, { paid_on: paid_on == null ? null : PlainDate(paid_on) })}
		/>
	</div>
{/snippet}

{#snippet removeControl(row: Repayment)}
	{#if row.payroll_run_id != null}<span
			role="img"
			title={bolt.t('loan.repayment_locked')}
			aria-label={bolt.t('loan.repayment_locked')}
			><Icon name="lucide:lock-keyhole" class="size-4 text-muted-foreground" /></span
		>{:else if !rowLocked(row)}<Button
			size="icon"
			variant="outline"
			aria-label={bolt.t('loan.remove_repayment')}
			hint={bolt.t('loan.remove_repayment')}
			onclick={() => remove(row)}
		>
			<Icon name="lucide:x" class="size-4" />
		</Button>{/if}
{/snippet}

{#snippet repaymentsEmpty()}
	<div class="grid grid-cols-2 gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
		<span>{bolt.t('loan.repayment_amount')}</span>
		<span>{bolt.t('loan.column_date')}</span>
	</div>
	<p class="px-3 py-3 text-sm text-muted-foreground">{bolt.t('loan.no_repayments')}</p>
{/snippet}

<RecordShell
	of="loan_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#if record === null}
		<Form
			of="loan_catalog_entry"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
			onOutcome={createRepayments}
			class="h-auto! shrink-0"
		>
			{#snippet children(form)}<LoanCreateFields {form} />{/snippet}
		</Form>
	{:else}
		<Form
			of="loan_catalog_entry"
			mode="update"
			id={record.id}
			{record}
			fields={['quantity', 'repayment_period', 'evidence_file']}
			validate={principalProblem}
			class="h-auto! shrink-0"
		/>
		<section class="mt-4 grid gap-3" data-loan-repayments>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h3 class="font-medium">{bolt.t('loan.repayments')}</h3>
				<div class="flex items-center gap-1">
					{#if !isLocked()}<Button
							size="icon"
							variant="outline"
							aria-label={bolt.t('loan.add_repayment')}
							hint={bolt.t('loan.add_repayment_hint')}
							disabled={busy}
							onclick={add}
						>
							<Icon name="lucide:plus" class="size-4" />
						</Button>{/if}
					<Button
						size="icon"
						variant="outline"
						aria-label={scheduleState === 'READY'
							? bolt.t('loan.recalculate')
							: bolt.t('loan.regenerate')}
						hint={bolt.t('loan.schedule_hint')}
						disabled={busy || isLocked() || scheduleState === 'NO_TERMS'}
						onclick={regenerate}
					>
						<Icon name="lucide:refresh-cw" class="size-4" />
					</Button>
				</div>
			</div>
			<div class="overflow-hidden rounded-md border">
				<Table
					of={rows}
					key="loan-repayments-matrix"
					layout="grid"
					embedded
					controlled
					rowTrailing={removeControl}
					empty={repaymentsEmpty}
					columns={[
						{ field: 'amount', label: bolt.t('loan.repayment_amount'), cell: amountCell },
						{ field: 'paid_on', label: bolt.t('loan.column_date'), cell: dateCell }
					]}
				/>
			</div>
			<div class="flex flex-wrap items-center gap-3">
				{#each problems as problem}<span class="text-xs text-amber-700">{label(problem)}</span
					>{/each}
			</div>
		</section>
	{/if}
</RecordShell>
