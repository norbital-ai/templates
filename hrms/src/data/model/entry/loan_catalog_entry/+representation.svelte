<script lang="ts">
	import {
		Field,
		Button,
		Form,
		Icon,
		MoneyInput,
		RecordShell,
		Table,
		TimeInput,
		confirm_action,
		toast,
		type FormState,
		type RecordView,
		type Value
	} from '@norbital-ai/ui';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Bound, Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Effect } from 'effect';
	import { untrack } from 'svelte';
	import { fork } from '@norbital-ai/ui/effect';
	import { isJsonObject } from '../../../../lib/foundation.js';
	import LoanCreateFields from '../../../../lib/ui/payroll/loan_create_fields.svelte';
	import CatalogField from '../../../../lib/ui/settings/catalog_field.svelte';
	import {
		buildLoanSchedule,
		loanScheduleProblems,
		loanScheduleState,
		type LoanScheduleProblem
	} from './service/loan_schedule.js';

	let { view, ctx }: { view: RecordView<'loan_catalog_entry'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	type Repayment = {
		readonly key: string;
		readonly id: Id<'loan_catalog_entry_repayment'> | null;
		readonly revision: number | null;
		readonly amount: string;
		readonly paid_on: string | null;
		readonly payroll_run_id: Id<'payroll_run'> | null;
	};
	let rows = $state<readonly Repayment[]>([]);
	let draft = $state<readonly Repayment[] | null>(null);
	let loaded = $state(false);
	let reload = $state(0);
	let nextLocal = 0;

	// One read when the record opens and after each committed save; edits stay in draft until Save.
	$effect(() => {
		const id = record?.id ?? null;
		void reload;
		if (id === null || view.mode === 'create') {
			rows = [];
			draft = null;
			loaded = true;
			return;
		}
		loaded = false;
		untrack(() => {
			void (async () => {
				try {
					const answer = await ctx.query({
						loan_catalog_entry_repayment: {
							where: { loan_id: { eq: id } },
							fields: ['id', 'revision', 'amount', 'paid_on', 'payroll_run_id'],
							order_by: { paid_on: 'asc' },
							limit: 10000
						}
					});
					rows = answer.loan_catalog_entry_repayment.rows.map((row) => ({
						key: String(row.id),
						id: row.id,
						revision: row.revision,
						amount: row.amount,
						paid_on: row.paid_on ?? null,
						payroll_run_id: row.payroll_run_id ?? null
					}));
					draft = null;
				} finally {
					loaded = true;
				}
			})();
		});
	});

	const shown = $derived(draft ?? rows);
	const scheduleFor = (form: FormState) => {
		if (record === null) return null;
		const quantityVal = form.get('quantity') ?? record.quantity;
		const periodVal = form.get('repayment_period') ?? record.repayment_period;
		const periodObj = isJsonObject(periodVal) ? periodVal : record.repayment_period;
		return {
			principal: Number(quantityVal),
			from: typeof periodObj.from === 'string' ? periodObj.from : record.repayment_period.from,
			to: typeof periodObj.to === 'string' ? periodObj.to : (record.repayment_period.to ?? ''),
			repayments: shown.map((row) => ({
				id: row.key,
				amount: Number(row.amount),
				paid_on: row.paid_on ?? '',
				payroll_run_id: row.payroll_run_id
			}))
		};
	};
	const label = (problem: LoanScheduleProblem): string =>
		ctx.t(
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

	const updateRow = (key: string, patch: { amount?: string; paid_on?: string | null }) => {
		draft = shown.map((row) => (row.key === key ? { ...row, ...patch } : row));
	};
	const removeRow = (key: string) => {
		draft = shown.filter((row) => row.key !== key);
	};
	const addRow = (form: FormState) => {
		const schedule = scheduleFor(form);
		if (record === null || !loaded || schedule === null) return;
		nextLocal += 1;
		draft = [
			...shown,
			{
				key: `new:${nextLocal}`,
				id: null,
				revision: null,
				amount: '0',
				paid_on: schedule.from,
				payroll_run_id: null
			}
		];
	};
	const regenerate = (form: FormState) => {
		const schedule = scheduleFor(form);
		if (record === null || !loaded || schedule === null) return;
		fork(
			Effect.gen(function* () {
				const proceed = yield* confirm_action({
					title: ctx.t('loan.generate_title'),
					body: ctx.t('loan.generate_body'),
					confirm_label: ctx.t('loan.regenerate'),
					destructive: true
				});
				if (!proceed) return;
				let plan: ReturnType<typeof buildLoanSchedule>;
				try {
					plan = buildLoanSchedule(schedule);
				} catch (error) {
					toast.error(error instanceof Error ? error.message : ctx.t('component.error'));
					return;
				}
				const removed = new Set(plan.remove);
				const kept = shown.filter((row) => !removed.has(row.key));
				const added: Repayment[] = plan.create.map((row) => {
					nextLocal += 1;
					return {
						key: `new:${nextLocal}`,
						id: null,
						revision: null,
						amount: new Intl.NumberFormat('en', {
							useGrouping: false,
							maximumFractionDigits: 20
						}).format(row.amount),
						paid_on: row.paid_on,
						payroll_run_id: null
					};
				});
				draft = [...kept, ...added];
			})
		);
	};

	// Commit every repayment create/update/delete atomically in the loan Form's single Save.
	const repaymentActs = (): Readonly<Record<string, readonly Value[]>> => {
		if (record === null || draft === null) return {};
		const storedById = new Map(
			rows.flatMap((row) => (row.id === null ? [] : [[String(row.id), row] as const]))
		);
		const keptIds = new Set(draft.flatMap((row) => (row.id === null ? [] : [String(row.id)])));
		const deletes: Value[] = rows.flatMap((row) =>
			row.id !== null && row.revision !== null && !keptIds.has(String(row.id))
				? [{ target: { id: row.id, revision: row.revision } }]
				: []
		);
		const updates: Value[] = draft.flatMap((row) => {
			if (row.id === null || row.revision === null) return [];
			const before = storedById.get(String(row.id));
			if (before === undefined) return [];
			const set: Record<string, Value> = {};
			if (row.amount !== before.amount) set['amount'] = row.amount;
			if (row.paid_on !== before.paid_on) set['paid_on'] = row.paid_on;
			return Object.keys(set).length === 0
				? []
				: [{ target: { id: row.id, revision: row.revision }, set }];
		});
		const creates: Value[] = draft.flatMap((row) =>
			row.id === null
				? [
						{
							entity_id: record.entity_id,
							employment_id: record.employment_id,
							loan_id: record.id,
							amount: row.amount,
							paid_on: row.paid_on
						}
					]
				: []
		);
		return {
			...(deletes.length === 0 ? {} : { 'loan_catalog_entry_repayment.delete': deletes }),
			...(updates.length === 0 ? {} : { 'loan_catalog_entry_repayment.update': updates }),
			...(creates.length === 0 ? {} : { 'loan_catalog_entry_repayment.create': creates })
		};
	};
</script>

{#snippet repaymentsEmpty()}
	<div class="grid grid-cols-2 gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
		<span>{ctx.t('loan.repayment_amount')}</span>
		<span>{ctx.t('loan.column_date')}</span>
	</div>
	<p class="px-3 py-3 text-sm text-muted-foreground">{ctx.t('loan.no_repayments')}</p>
{/snippet}

<RecordShell
	{ctx}
	of="loan_catalog_entry"
	mode={view.mode}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
	on_done={(outcome) => {
		if (outcome.kind === 'committed') {
			draft = null;
			reload += 1;
		}
	}}
>
	{#if record === null}
		<Form
			{ctx}
			of="loan_catalog_entry"
			mode="create"
			values={view.mode === 'create' ? view.values : {}}
			size="content"
		>
			{#snippet children(form)}<LoanCreateFields {ctx} {form} />{/snippet}
		</Form>
	{:else}
		<Form
			{ctx}
			of="loan_catalog_entry"
			mode="update"
			id={record.id}
			{record}
			size="content"
			acts={repaymentActs}
			on_reset={() => {
				draft = null;
			}}
		>
			{#snippet children(form)}
				{@const viewing = form.mode === 'view'}
				{@const locked = !loaded || viewing}
				{@const schedule = scheduleFor(form)}
				{@const scheduleState = schedule === null ? 'NO_TERMS' : loanScheduleState(schedule)}
				{@const problems = schedule === null ? [] : loanScheduleProblems(schedule)}
				{#snippet amountCell({ row }: { row: Repayment })}
					<div class="py-1.5">
						<MoneyInput
							{ctx}
							scale={2}
							value={row.amount}
							readonly={locked}
							on_change={(next) => {
								if (typeof next === 'string') updateRow(row.key, { amount: next });
							}}
						/>
					</div>
				{/snippet}
				{#snippet dateCell({ row }: { row: Repayment })}
					<div class="py-1.5">
						<TimeInput
							{ctx}
							of="date"
							precision="month"
							value={row.paid_on}
							readonly={locked}
							on_change={(paid_on: string | null) => updateRow(row.key, { paid_on })}
						/>
					</div>
				{/snippet}
				{#snippet removeControl(row: Repayment)}
					{#if row.payroll_run_id != null}<span
							role="img"
							title={ctx.t('loan.repayment_locked')}
							aria-label={ctx.t('loan.repayment_locked')}
							><Icon name="lucide:lock-keyhole" class="size-4 text-muted-foreground" /></span
						>{:else if !locked}<Button
							size="icon"
							variant="outline"
							aria-label={ctx.t('loan.remove_repayment')}
							hint={ctx.t('loan.remove_repayment')}
							onclick={() => removeRow(row.key)}
						>
							<Icon name="lucide:x" class="size-4" />
						</Button>{/if}
				{/snippet}
				<Stack gap="lg">
					<Stack gap="md">
						<CatalogField {ctx} of="loan_catalog" />
						{#each ['quantity', 'repayment_period', 'evidence_file'] as name (name)}<Field
								{ctx}
								{name}
							/>{/each}
					</Stack>
					<Stack gap="sm" data-loan-repayments>
						<Cluster gap="sm" align="center" justify="between">
							<h3 class="font-medium">{ctx.t('loan.repayments')}</h3>
							{#if !viewing}
								<Cluster gap="xs" align="center">
									<Button
										size="icon"
										variant="outline"
										aria-label={ctx.t('loan.add_repayment')}
										hint={ctx.t('loan.add_repayment_hint')}
										disabled={!loaded}
										onclick={() => addRow(form)}
									>
										<Icon name="lucide:plus" class="size-4" />
									</Button>
									<Button
										size="icon"
										variant="outline"
										aria-label={scheduleState === 'READY'
											? ctx.t('loan.recalculate')
											: ctx.t('loan.regenerate')}
										hint={ctx.t('loan.schedule_hint')}
										disabled={!loaded || scheduleState === 'NO_TERMS'}
										onclick={() => regenerate(form)}
									>
										<Icon name="lucide:refresh-cw" class="size-4" />
									</Button>
								</Cluster>
							{/if}
						</Cluster>
						<Bound class="rounded-md border">
							<Table
								{ctx}
								of={shown}
								key="loan-repayments-matrix"
								layout="grid"
								embedded
								controlled
								row_trailing={removeControl}
								empty={repaymentsEmpty}
								columns={[
									{ field: 'amount', label: ctx.t('loan.repayment_amount'), cell: amountCell },
									{ field: 'paid_on', label: ctx.t('loan.column_date'), cell: dateCell }
								]}
							/>
						</Bound>
						<Cluster gap="sm" align="center">
							{#each problems as problem}<span class="text-xs text-tone-warning-text"
									>{label(problem)}</span
								>{/each}
						</Cluster>
					</Stack>
				</Stack>
			{/snippet}
		</Form>
	{/if}
</RecordShell>
