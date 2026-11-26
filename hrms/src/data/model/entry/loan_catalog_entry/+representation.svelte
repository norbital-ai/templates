<script lang="ts">
	import {
		Button,
		Field,
		Form,
		Icon,
		MoneyInput,
		RecordShell,
		Table,
		TimeInput,
		confirm_action,
		toast,
		use_record_controller,
		type FormState,
		type RecordView,
		type Value
	} from '@norbital-ai/ui';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Bound, Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Effect } from 'effect';
	import { untrack } from 'svelte';
	import { watch } from '@norbital-ai/ui/behaviors';
	import { fork } from '@norbital-ai/ui/effect';
	import { isJsonObject, numberOf } from '../../../../lib/foundation.js';
	import CatalogField from '../../../../lib/ui/settings/catalog_field.svelte';
	import ScopedEmploymentField from '../../../../lib/ui/person/scoped_employment_field.svelte';
	import {
		buildLoanSchedule,
		loanScheduleProblems,
		loanScheduleState,
		type LoanScheduleProblem
	} from './service/loan_schedule.js';

	let { view, ctx }: { view: RecordView<'loan_catalog_entry'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	const clock = ctx.clock('day');
	const controller = use_record_controller();
	const liveForm = $derived(controller?.current ?? null);

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
	let edited = $state(false);
	let loaded = $state(false);
	let reload = $state(0);
	let nextLocal = 0;

	const moneyText = (amount: number) =>
		new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 20 }).format(amount);

	// One read when the record opens and after each committed save; edits stay in draft until Save.
	$effect(() => {
		const id = record?.id ?? null;
		void reload;
		if (id === null || view.mode === 'create') {
			rows = [];
			draft = null;
			edited = false;
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
					edited = false;
				} finally {
					loaded = true;
				}
			})();
		});
	});

	const fixedEntity = $derived(
		record?.entity_id ??
			(view.mode === 'create' && typeof view.values.entity_id === 'string'
				? view.values.entity_id
				: null)
	);
	const fixedEmployment = $derived(
		record?.employment_id ??
			(view.mode === 'create' && typeof view.values.employment_id === 'string'
				? view.values.employment_id
				: null)
	);

	const termsOf = (
		quantityVal: Value | undefined,
		periodVal: Value | undefined
	): { readonly principal: number; readonly from: string; readonly to: string } => {
		const period = isJsonObject(periodVal) ? periodVal : null;
		return {
			principal: numberOf(quantityVal) ?? 0,
			from: typeof period?.from === 'string' ? period.from : '',
			to: typeof period?.to === 'string' ? period.to : ''
		};
	};

	const createTerms = $derived.by(() => {
		if (record !== null) return { principal: 0, from: '', to: '' };
		return termsOf(liveForm?.get('quantity'), liveForm?.get('repayment_period'));
	});

	const createAutoRows = $derived.by<readonly Repayment[]>(() => {
		if (record !== null || edited) return [];
		if (loanScheduleState({ ...createTerms, repayments: [] }) === 'NO_TERMS') return [];
		return buildLoanSchedule({ ...createTerms, repayments: [] }).create.map((row) => ({
			key: `auto:${row.paid_on}`,
			id: null,
			revision: null,
			amount: moneyText(row.amount),
			paid_on: row.paid_on,
			payroll_run_id: null
		}));
	});

	const shown = $derived(draft ?? (record === null ? createAutoRows : rows));

	// On create, keep the parent form's nested `repayments` layer in lockstep with the inline matrix.
	watch(
		() => {
			if (
				record !== null ||
				liveForm === null ||
				liveForm.spec.target.of !== 'model' ||
				liveForm.spec.target.mode !== 'create'
			)
				return null;
			return {
				form: liveForm,
				entity_id: liveForm.get('entity_id'),
				employment_id: liveForm.get('employment_id'),
				items: shown
			};
		},
		(next) => {
			if (next === null) return;
			next.form.queue_children(
				'repayments',
				next.items.map((row) => ({
					action: 'create' as const,
					values: {
						entity_id: next.entity_id,
						employment_id: next.employment_id,
						amount: row.amount,
						paid_on: row.paid_on
					}
				}))
			);
		}
	);

	const scheduleFor = (form: FormState) => {
		const terms = termsOf(
			form.get('quantity') ?? record?.quantity,
			form.get('repayment_period') ?? record?.repayment_period
		);
		return {
			...terms,
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

	const validateCreate = (values: Readonly<Record<string, Value>>) => {
		const terms = termsOf(values['quantity'], values['repayment_period']);
		const problems = loanScheduleProblems({
			...terms,
			repayments: shown.map((row) => ({
				id: row.key,
				amount: Number(row.amount),
				paid_on: row.paid_on ?? '',
				payroll_run_id: row.payroll_run_id
			}))
		});
		return problems.flatMap((problem) => {
			if (problem === 'principal')
				return values['quantity'] !== null ? [{ field: 'quantity', message: label(problem) }] : [];
			if (problem === 'period')
				return values['repayment_period'] !== null
					? [{ field: 'repayment_period', message: label(problem) }]
					: [];
			return values['quantity'] !== null && values['repayment_period'] !== null
				? [{ field: 'quantity', message: label(problem) }]
				: [];
		});
	};

	const updateRow = (key: string, patch: { amount?: string; paid_on?: string | null }) => {
		edited = true;
		draft = shown.map((row) => (row.key === key ? { ...row, ...patch } : row));
	};
	const removeRow = (key: string) => {
		edited = true;
		draft = shown.filter((row) => row.key !== key);
	};
	const addRow = (form: FormState) => {
		if (!loaded) return;
		const schedule = scheduleFor(form);
		nextLocal += 1;
		edited = true;
		draft = [
			...shown,
			{
				key: `new:${nextLocal}`,
				id: null,
				revision: null,
				amount: '0',
				paid_on: schedule.from !== '' ? schedule.from : `${String(clock.today).slice(0, 7)}-01`,
				payroll_run_id: null
			}
		];
	};
	const applySchedule = (schedule: ReturnType<typeof scheduleFor>) => {
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
				amount: moneyText(row.amount),
				paid_on: row.paid_on,
				payroll_run_id: null
			};
		});
		edited = record !== null;
		draft = record === null ? null : [...kept, ...added];
	};
	const regenerate = (form: FormState) => {
		if (!loaded) return;
		const schedule = scheduleFor(form);
		if (shown.length === 0) {
			applySchedule(schedule);
			return;
		}
		fork(
			Effect.gen(function* () {
				const proceed = yield* confirm_action({
					title: ctx.t('loan.generate_title'),
					body: ctx.t('loan.generate_body'),
					confirm_label: ctx.t('loan.regenerate'),
					destructive: true
				});
				if (!proceed) return;
				applySchedule(schedule);
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
			edited = false;
			reload += 1;
		}
	}}
>
	<Form
		{ctx}
		of="loan_catalog_entry"
		mode={record === null ? 'create' : 'update'}
		size="content"
		{...record === null
			? { values: view.mode === 'create' ? view.values : {}, validate: validateCreate }
			: { id: record.id, record, acts: repaymentActs }}
		on_reset={() => {
			draft = null;
			edited = false;
		}}
	>
		{#snippet children(form)}
			{@const viewing = form.mode === 'view'}
			{@const locked = !loaded || viewing}
			{@const schedule = scheduleFor(form)}
			{@const scheduleState = loanScheduleState(schedule)}
			{@const problems =
				record === null &&
				form.get('quantity') === null &&
				form.get('repayment_period') === null &&
				shown.length === 0
					? []
					: loanScheduleProblems(schedule)}
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
				<Grid minimum="card">
					{#if record === null && fixedEntity === null}<Field {ctx} name="entity_id" />{/if}
					{#if record === null}<ScopedEmploymentField
							{ctx}
							entityId={fixedEntity}
							disabled={fixedEmployment !== null}
						/>{/if}
					<CatalogField {ctx} of="loan_catalog" />
					{#each ['quantity', 'repayment_period', 'evidence_file'] as name (name)}<Field
							{ctx}
							{name}
						/>{/each}
				</Grid>
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
</RecordShell>
