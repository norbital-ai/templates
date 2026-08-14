<script lang="ts">
	import { getCollectionFormFieldContext } from '@norbital-ai/ui/collection-form';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$pod/i18n-keys';
	import { client } from '$pod/client';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { repaymentScheduleSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';
	import ConsumedByCell from '../../lib/ui/repayment-schedule/consumed-by-cell.svelte';
	import { todayKey } from '../../lib/ui/calendar.js';
	import {
		repaymentConsumptionBySequence,
		repaymentRunLifecycleByPeriod,
		resolveRepaymentConsumption,
		type RepaymentConsumptionCell,
		type RepaymentConsumptionSourceRow,
		type RepaymentPeriodRunRow,
		type RepaymentScheduleMatrixRow
	} from '../../lib/ui/repayment-schedule/repayment-consumption.js';
	import {
		monthlyDueDates,
		repaymentScheduleIssues
	} from '../../collections/repayment_agreements/lib/repayment-schedule.js';

	const { t } = useI18n<TenantI18nKeys>();

	type RepaymentScheduleRendererProps = RendererProps & {
		readonly row?: Record<string, unknown>;
	};
	type PayslipLineConsumptionRow = NonNullable<
		RepaymentConsumptionSourceRow['entry_payslip_lines']
	>[number] & {
		readonly repayment_sequence?: number | null;
	};
	const columns = [
		{
			key: 'due_date',
			label: 'Due date',
			field: { name: 'due_date', kind: 'date', nullable: false } satisfies CollectionField,
			width: 180
		},
		{
			key: 'amount',
			label: 'Amount',
			field: { name: 'amount', kind: 'numeric', nullable: false } satisfies CollectionField,
			width: 160
		},
		{
			key: 'consumed_by',
			label: 'Consumed by',
			field: {
				name: 'consumed_by',
				kind: 'text',
				nullable: true,
				readOnly: true
			} satisfies CollectionField,
			readOnly: true,
			renderer: ConsumedByCell,
			width: 280
		},
		{
			key: 'consumed_at',
			label: 'Consumed at',
			field: {
				name: 'consumed_at',
				kind: 'timestamptz',
				nullable: true,
				readOnly: true
			} satisfies CollectionField,
			readOnly: true,
			width: 220
		}
	] satisfies readonly MatrixColumn<RepaymentScheduleMatrixRow>[];

	function coerceDraftRow(entry: unknown): { due_date: string; amount: number } {
		const raw = entry != null && typeof entry === 'object' ? entry : {};
		return {
			due_date: String(Reflect.get(raw, 'due_date') ?? ''),
			amount: Number(Reflect.get(raw, 'amount'))
		};
	}

	let props: RepaymentScheduleRendererProps = $props();
	let formContext: ReturnType<typeof getCollectionFormFieldContext> | null = null;
	try {
		formContext = getCollectionFormFieldContext();
	} catch {
		formContext = null;
	}
	const liveRow = $derived(formContext?.row() ?? props.row ?? {});
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(repaymentScheduleSchema.safeParse(props.value));
	const draft = $derived(Array.isArray(props.value) ? props.value : []);
	const issues = $derived(
		props.mode === 'display'
			? []
			: repaymentScheduleIssues({
					principal: liveRow.principal,
					effectiveRange: liveRow.effective_range,
					schedule: draft
				})
	);
	const total = $derived(
		parsed.success ? parsed.data.reduce((sum, entry) => sum + entry.amount, 0) : 0
	);
	const summary = $derived(
		parsed.success
			? `${parsed.data.length} instalment${parsed.data.length === 1 ? '' : 's'} · ${total.toFixed(2)}`
			: 'Invalid schedule'
	);
	const agreementId = $derived(
		typeof props.row?.norbital_id === 'string' ? props.row.norbital_id : null
	);
	const employmentId = $derived(
		typeof props.row?.employment_id === 'string' ? props.row.employment_id : null
	);
	const consumptionQuery = $derived(
		agreementId
			? client.db.payslip_lines.findMany({
					where: { repayment_agreement_id: { eq: agreementId } },
					columns: {
						norbital_id: true,
						repayment_sequence: true,
						sequence: true,
						amount: true,
						norbital_created_at: true
					},
					with: {
						payslip_line_payslip: {
							columns: { norbital_id: true },
							with: {
								payslip_payroll_run: {
									columns: {
										norbital_id: true,
										period: true,
										pay_date: true
									}
								}
							}
						}
					},
					limit: 600
				})
			: null
	);

	/**
	 * The pay calendar this schedule is read against.
	 *
	 * An instalment with no payslip line is only a defect once the run for its period has been
	 * *paid* — before that it is simply waiting. Answering "which of the four is this?" needs the
	 * agreement's company, which the agreement itself does not carry, so the employment supplies it.
	 */
	const employmentQuery = $derived(
		employmentId
			? client.db.employments.findFirst({ where: { norbital_id: { eq: employmentId } } })
			: null
	);
	const companyId = $derived(employmentQuery?.current?.company_id ?? null);
	const runsQuery = $derived(
		companyId
			? client.db.payroll_runs.findMany({
					where: { company_id: { eq: companyId } },
					orderBy: { period: 'asc' },
					limit: 600
				})
			: null
	);

	const consumptionBySequence = $derived(
		repaymentConsumptionBySequence(
			((consumptionQuery?.current ?? []) as readonly PayslipLineConsumptionRow[]).map(
				(line): RepaymentConsumptionSourceRow => ({
					repayment_sequence: line.repayment_sequence,
					entry_payslip_lines: [line]
				})
			)
		)
	);
	const runLifecycleByPeriod = $derived(
		repaymentRunLifecycleByPeriod((runsQuery?.current ?? []) as readonly RepaymentPeriodRunRow[])
	);
	const pendingQuery = (query: { loading?: boolean; current?: unknown; error?: unknown } | null) =>
		query == null || query.loading || (query.current === undefined && query.error == null);
	const consumptionPending = $derived(
		Boolean(
			agreementId &&
			(pendingQuery(consumptionQuery) ||
				// The calendar is part of the answer, so a cell must not resolve before it lands —
				// otherwise every unconsumed row would flash "Awaiting …" and then correct itself.
				(employmentId != null && (pendingQuery(employmentQuery) || pendingQuery(runsQuery))))
		)
	);
	const consumptionError = $derived(
		consumptionQuery?.error ?? employmentQuery?.error ?? runsQuery?.error ?? null
	);

	function consumptionCell(sequence: number, dueDate: string): RepaymentConsumptionCell {
		if (consumptionPending) return { status: 'loading' };
		if (consumptionError) return { status: 'error', message: consumptionError.message };
		return resolveRepaymentConsumption({
			dueDate,
			reference: consumptionBySequence.get(sequence),
			runLifecycleByPeriod,
			today: todayKey()
		});
	}

	const rows = $derived(
		draft.map((entry, sequence): RepaymentScheduleMatrixRow => {
			const coerced = coerceDraftRow(entry);
			const consumedBy = consumptionCell(sequence + 1, coerced.due_date);
			return {
				id: `instalment-${sequence}`,
				due_date: coerced.due_date,
				amount: coerced.amount,
				consumed_by: consumedBy,
				consumed_at: consumedBy.status === 'consumed' ? consumedBy.reference.consumedAt : null
			};
		})
	);
	const locked = $derived(
		disabled || props.mode === 'display' || consumptionPending || consumptionError != null
	);

	function emit(next: Value): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function nextDate(): string {
		const lastDate = coerceDraftRow(draft.at(-1)).due_date || todayKey();
		try {
			return monthlyDueDates(lastDate, 2)[1] ?? lastDate;
		} catch {
			return monthlyDueDates(todayKey(), 2)[1] ?? todayKey();
		}
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	{#if issues.length > 0}
		<ul class="mb-2 space-y-1 rounded-md border border-destructive bg-destructive/10 p-2 text-sm text-destructive" role="alert">
			{#each issues as issue (issue)}
				<li>{issue}</li>
			{/each}
		</ul>
	{/if}
	<div class={['rounded-md', issues.length > 0 && 'ring-2 ring-destructive ring-offset-2']}>
		<MatrixRenderer
			{rows}
			{columns}
			disabled={locked}
			emptyMessage={t('renderer.repayment_schedule.empty')}
			createRow={(): RepaymentScheduleMatrixRow => {
				const dueDate = nextDate();
				return {
					id: crypto.randomUUID(),
					due_date: dueDate,
					amount: 0.01,
					consumed_by: consumptionCell(draft.length + 1, dueDate),
					consumed_at: null
				};
			}}
			addRowLabel="Add instalment"
			allowRemoveRows={true}
			canRemoveRow={(row) =>
				draft.length > 1 && row.consumed_by.status !== 'consumed' && !consumptionPending}
			isRowDisabled={(row) => row.consumed_by.status === 'consumed'}
			bounded={false}
			onChange={(nextRows) =>
				emit(nextRows.map(({ due_date, amount }) => ({ due_date, amount })) as Value)}
		/>
	</div>
{/if}
