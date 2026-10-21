<script lang="ts">
	import { onMount } from 'svelte';
	import { Effect, Predicate } from 'effect';
	import { isPlainDate, type PlainDate } from '@norbital-ai/std/date';
	import { Decimal, sum } from '@norbital-ai/std/decimal';
	import {
		Button,
		Icon,
		MoneyInput,
		Table,
		TimeInput,
		Tooltip,
		openRecord,
		useRecordController,
		type FormState,
		type SemanticIssue
	} from '@norbital-ai/ui';
	import type { Row } from '@norbital-ai/bolt';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import {
		buildLoanSchedule,
		validateLoanRepayments,
		type LoanRepayment,
		type LoanScheduleInput
	} from '../../loan_schedule.js';
	import { live, liveRows } from '../state/live.svelte.js';
	import { governingPayroll } from '../format/version_money.svelte.js';
	import { loanCalendar } from '../../loan_values.js';

	let { form, record }: { form: FormState; record: Row<'loan_catalog_entry'> | null } = $props();
	const uid = $props.id();
	const controller = useRecordController();
	const historical = $derived(controller?.historical === true);
	const stored = liveRows(() =>
		record == null || historical
			? null
			: bolt.read('loan_repayment_entry', {
					where: { loan_id: { eq: record.id } },
					select: {
						occurred_on: true,
						amount: true,
						activity: true,
						payslip_id: true,
						sequence: true,
						revision: true
					},
					orderBy: { occurred_on: 'asc' },
					all: true
				})
	);
	type Draft = {
		readonly key: string;
		readonly id?: string;
		readonly revision?: number | undefined;
		readonly occurred_on: PlainDate | null;
		readonly amount: Decimal | null;
		readonly payslip_id?: string | null;
		readonly activity?: 'AWARD' | 'REVERSAL';
		readonly sequence?: number | null;
	};
	/** One table row: `index` keys its semantic issues (`repayments.<index>.<cell>`). */
	type Line = {
		readonly id: string;
		readonly index: number;
		readonly amount: Decimal | null;
		readonly occurred_on: PlainDate | null;
		readonly payslip_id: string | null;
	};
	// the schedule keeps the money and calendar of the version governing the loan's class, as the server does
	const catalogId = $derived(form.id<'loan_catalog'>('catalog_id'));
	const loanClass = live(() =>
		catalogId == null || catalogId === ''
			? null
			: bolt.get('loan_catalog', catalogId, { settings_id: true })
	);
	const payroll = governingPayroll(() => {
		const version = loanClass.current?.settings_id;
		return version == null ? null : { version };
	});
	const calendar = $derived(loanCalendar(payroll()));
	const principal = $derived.by(() => {
		const value = form.get('principal_amount');
		return calendar != null &&
			value instanceof Decimal &&
			value.cmp(0) > 0 &&
			value.eq(value.round(calendar.scale))
			? value
			: null;
	});
	const period = $derived.by(() => {
		const value = form.get('repayment_period');
		if (!Predicate.isObject(value)) return null;
		const from = Reflect.get(value, 'from'),
			to = Reflect.get(value, 'to');
		return isPlainDate(from) && isPlainDate(to) && from <= to ? { from, to } : null;
	});
	const parameters = $derived.by((): LoanScheduleInput | null => {
		if (principal == null || period == null || calendar == null) return null;
		return {
			...calendar,
			principal_amount: principal,
			repayment_period: period,
			repayment_frequency:
				form.get('repayment_frequency') === 'SEMI_MONTHLY' ? 'SEMI_MONTHLY' : 'MONTHLY'
		};
	});
	const ready = $derived(record == null || stored.current != null);
	const queued = $derived(form.children['repayments'] ?? []);
	const automatic = $derived.by(() => {
		if (!ready || (stored.current?.length ?? 0) !== 0 || queued.length !== 0 || parameters == null)
			return null;
		const built = buildLoanSchedule(parameters);
		return built.ok ? built.repayments : null;
	});
	const rows = $derived.by((): readonly Draft[] => {
		if (automatic != null) return automatic.map((row, index) => ({ ...row, key: `new:${index}` }));
		const deleted = new Set(queued.flatMap((op) => (op.action === 'delete' ? [op.id] : [])));
		const entries: Draft[] = (stored.current ?? [])
			.filter((row) => !deleted.has(row.id))
			.map((row) => {
				const edit = queued.find((op) => op.action === 'update' && op.id === row.id);
				const date =
					edit?.action === 'update' && Object.hasOwn(edit.set, 'occurred_on')
						? edit.set['occurred_on']
						: row.occurred_on;
				const amount =
					edit?.action === 'update' && Object.hasOwn(edit.set, 'amount')
						? edit.set['amount']
						: row.amount;
				return {
					...row,
					key: row.id,
					revision: edit?.action === 'update' ? edit.revision : row.revision,
					occurred_on: isPlainDate(date) ? date : null,
					amount: amount instanceof Decimal ? amount : null
				};
			});
		let index = 0;
		for (const op of queued)
			if (op.action === 'create') {
				const date = op.values['occurred_on'],
					amount = op.values['amount'];
				entries.push({
					key: `new:${index++}`,
					occurred_on: isPlainDate(date) ? date : null,
					amount: amount instanceof Decimal ? amount : null
				});
			}
		return entries;
	});
	const lines = $derived(
		rows.map((row, index): Line => ({
			id: row.key,
			index,
			amount: row.amount,
			occurred_on: row.occurred_on,
			payslip_id: row.payslip_id ?? null
		}))
	);

	const total = $derived(
		sum(
			rows.map((row) =>
				row.amount == null
					? Decimal.of(0)
					: row.activity === 'REVERSAL'
						? row.amount.neg()
						: row.amount
			)
		)
	);
	const editable = $derived(
		form.mode !== 'view' && form.spec.readonly !== true && form.canSubmit && !historical
	);
	const shown = $derived(!historical && catalogId !== null && catalogId !== '');

	/** The server's `validateLoanRepayments` invariants, per cell, so Save stays off while any is broken. */
	const issues = $derived.by((): readonly SemanticIssue[] => {
		if (!shown || !ready) return [];
		const found: SemanticIssue[] = [];
		// the server refuses a loan without both terms: Save stays off until they are entered
		if (editable && principal == null)
			found.push({ field: 'principal_amount', message: bolt.t('loan.principal_required') });
		if (editable && period == null)
			found.push({ field: 'repayment_period', message: bolt.t('loan.period_required') });
		rows.forEach((row, index) => {
			if (row.amount == null)
				found.push({
					field: `repayments.${index}.amount`,
					message: bolt.t('loan.amount_required')
				});
			else if (row.amount.cmp(0) <= 0 || !row.amount.eq(row.amount.round(2)))
				found.push({
					field: `repayments.${index}.amount`,
					message: bolt.t('loan.amount_invalid')
				});
			if (row.occurred_on == null)
				found.push({ field: `repayments.${index}.date`, message: bolt.t('loan.date_required') });
			else if (period != null && (row.occurred_on < period.from || row.occurred_on > period.to))
				found.push({
					field: `repayments.${index}.date`,
					message: bolt.t('loan.date_outside_period', { from: period.from, to: period.to })
				});
		});
		if (parameters != null && !total.eq(parameters.principal_amount))
			found.push({
				field: 'repayments',
				message: bolt.t('loan.total_mismatch', {
					total: total.round(2).toString(),
					principal: parameters.principal_amount.round(2).toString()
				})
			});
		return found;
	});
	onMount(() => form.addValidation(() => issues));
	// Cancel restores the stored schedule: the cells remount, so no editor keeps a value the draft no longer holds.
	let generation = $state(0);
	onMount(() => form.onReset(() => generation++));

	function complete(draft: readonly Draft[]): readonly LoanRepayment[] | null {
		const result: LoanRepayment[] = [];
		for (const row of draft) {
			if (row.amount == null || row.occurred_on == null) return null;
			result.push({ ...row, amount: row.amount, occurred_on: row.occurred_on });
		}
		return result;
	}
	function queue(draft: readonly Draft[]) {
		const operations: Parameters<FormState['queueChildren']>[1][number][] = [];
		const retained = new Set(draft.flatMap((row) => (row.id == null ? [] : [row.id])));
		for (const row of stored.current ?? [])
			if (!retained.has(row.id)) {
				const prior = queued.find(
					(op) => (op.action === 'delete' || op.action === 'update') && op.id === row.id
				);
				operations.push({
					action: 'delete',
					id: row.id,
					revision: prior != null && prior.action !== 'create' ? prior.revision : row.revision
				});
			}
		for (const row of draft) {
			if (row.id == null)
				operations.push({
					action: 'create',
					values: { occurred_on: row.occurred_on, amount: row.amount }
				});
			else {
				const original = stored.current?.find((old) => old.id === row.id);
				if (
					original != null &&
					row.revision != null &&
					(row.occurred_on !== original.occurred_on ||
						row.amount == null ||
						!row.amount.eq(original.amount))
				)
					operations.push({
						action: 'update',
						id: row.id,
						revision: row.revision,
						set: { occurred_on: row.occurred_on, amount: row.amount }
					});
			}
		}
		form.queueChildren('repayments', operations);
	}
	const unlocked = (key: string) =>
		editable && rows.find((row) => row.key === key)?.payslip_id == null;
	function edit(key: string, change: Pick<Draft, 'amount'> | Pick<Draft, 'occurred_on'>) {
		if (unlocked(key)) queue(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
	}
	function remove(key: string) {
		if (unlocked(key)) queue(rows.filter((row) => row.key !== key));
	}
	function add() {
		if (editable && ready)
			queue([...rows, { key: `new:${rows.length}`, occurred_on: null, amount: null }]);
	}
	function recalculate() {
		if (!editable || parameters == null || !ready) return;
		const repayments: LoanRepayment[] = rows.flatMap((row) =>
			row.occurred_on == null
				? []
				: [{ ...row, occurred_on: row.occurred_on, amount: row.amount ?? Decimal.of(0) }]
		);
		const result = buildLoanSchedule({ ...parameters, repayments });
		if (!result.ok) {
			form.notice = { tone: 'danger', text: result.message };
			return;
		}
		queue(
			result.repayments.map((row, index) => ({
				...row,
				key: row.id ?? `new:${index}`,
				revision: rows.find((old) => old.id != null && old.id === row.id)?.revision
			}))
		);
		form.notice = null;
	}
	const changedTerms = $derived(
		[
			'principal_amount',
			'repayment_period',
			'repayment_frequency',
			'catalog_id',
			'employment_id'
		].some((name) => JSON.stringify(form.get(name)) !== JSON.stringify(form.base[name] ?? null))
	);

	onMount(() =>
		form.beforeSubmit(() =>
			Effect.sync(() => {
				if (record != null && !changedTerms && queued.length === 0 && automatic == null)
					return true;
				const repayments = complete(rows);
				if (!ready || parameters == null || repayments == null) {
					form.notice = { tone: 'danger', text: bolt.t('loan.invalid_dates') };
					return false;
				}
				const checked = validateLoanRepayments({ ...parameters, repayments });
				if (!checked.ok) {
					form.notice = { tone: 'danger', text: checked.message };
					return false;
				}
				queue(rows);
				return true;
			})
		)
	);
</script>

{#snippet problem(message: string)}
	<Tooltip text={message}>
		{#snippet trigger({ props })}
			<Button
				{...props}
				type="button"
				variant="ghost"
				size="icon"
				aria-label={message}
				data-semantic-issue
				class="size-5 shrink-0 text-destructive"
			>
				<Icon name="lucide:info" class="size-3.5" />
			</Button>
		{/snippet}
	</Tooltip>
{/snippet}

{#snippet recalculateControl()}
	<Button
		type="button"
		variant="ghost"
		size="icon"
		hint={bolt.t('loan.recalculate')}
		aria-label={bolt.t('loan.recalculate')}
		disabled={!editable || parameters == null || !ready || form.pending}
		onclick={recalculate}
	>
		<Icon name="lucide:refresh-cw" class="size-4" />
	</Button>
{/snippet}

{#snippet amountCell({ row }: { row: Line })}
	{@const issue = form.semanticError(`repayments.${row.index}.amount`)}
	<Inline
		gap="xs"
		data-repayment-amount={row.id}
		class={row.payslip_id != null ? 'rounded-sm ring-1 ring-primary ring-inset' : undefined}
	>
		<label for={`${uid}-amount-${row.id}`} class="sr-only"
			>{bolt.t('loan.repayment_amount')} {row.occurred_on ?? ''}</label
		>
		<MoneyInput
			id={`${uid}-amount-${row.id}`}
			scale={2}
			value={row.amount}
			invalid={issue != null}
			readonly={!editable || row.payslip_id != null}
			disabled={form.pending}
			onChange={(amount) => edit(row.id, { amount: amount instanceof Decimal ? amount : null })}
		/>
		{#if issue != null}{@render problem(issue)}{/if}
	</Inline>
{/snippet}

{#snippet dateCell({ row }: { row: Line })}
	{@const issue = form.semanticError(`repayments.${row.index}.date`)}
	<Inline gap="xs" data-repayment-date={row.id} data-locked={row.payslip_id != null || undefined}>
		<label for={`${uid}-date-${row.id}`} class="sr-only">{bolt.t('loan.repayment_date')}</label>
		<TimeInput
			id={`${uid}-date-${row.id}`}
			of="date"
			value={row.occurred_on}
			invalid={issue != null}
			{...period == null ? {} : { min: period.from, max: period.to }}
			readonly={!editable || row.payslip_id != null}
			disabled={form.pending}
			onChange={(date: string | null) =>
				edit(row.id, { occurred_on: isPlainDate(date) ? date : null })}
		/>
		{#if issue != null}{@render problem(issue)}{/if}
		{#if row.payslip_id != null}
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				hint={bolt.t('loan.repayment_locked')}
				aria-label={bolt.t('loan.repayment_locked')}
				data-repayment-payslip
				onclick={() => openRecord('payslip', row.payslip_id ?? '')}
			>
				<Icon name="lucide:lock-keyhole" class="size-3.5" />
			</Button>
		{:else if editable}
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				hint={bolt.t('loan.remove_repayment')}
				aria-label={bolt.t('loan.remove_repayment')}
				data-repayment-remove
				disabled={form.pending}
				onclick={() => remove(row.id)}
			>
				<Icon name="lucide:x" class="size-3.5" />
			</Button>
		{/if}
	</Inline>
{/snippet}

{#if historical}
	<p class="text-sm text-muted-foreground">{bolt.t('loan.schedule_history')}</p>
{:else if shown}
	{@const mismatch = form.semanticError('repayments')}
	<Stack gap="sm" data-loan-repayments>
		{#key generation}
			<Table
				of={lines}
				key="loan_repayments"
				layout="grid"
				columns={[
					{ field: 'amount', label: bolt.t('loan.repayment_amount'), width: 200, cell: amountCell },
					{ field: 'occurred_on', label: bolt.t('loan.column_date'), width: 240, cell: dateCell }
				]}
				toolbar={{
					title: bolt.t('loan.repayments'),
					description: bolt.t('loan.schedule_instructions'),
					new: false,
					actions: false,
					search: false,
					filter: false,
					export: false,
					delete: false,
					select: false,
					trailing: recalculateControl
				}}
			/>
		{/key}
		<Inline gap="sm" justify="between">
			{#if editable}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-repayment-add
					disabled={!ready || form.pending}
					onclick={add}
				>
					<Icon name="lucide:plus" class="size-3.5" />{bolt.t('loan.add_repayment')}
				</Button>
			{/if}
			<Inline gap="xs" data-repayment-total>
				<p
					class={mismatch != null
						? 'text-sm text-destructive tabular-nums'
						: 'text-sm text-muted-foreground tabular-nums'}
				>
					{bolt.t('loan.schedule_total')}: {total.round(2).toString()}
				</p>
				{#if mismatch != null}{@render problem(mismatch)}{/if}
			</Inline>
		</Inline>
	</Stack>
{/if}
