<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm, type CollectionFormSemantic } from '@norbital-ai/ui/collection-form';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import { watch } from 'runed';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import {
		createLoanRepaymentDraft,
		loanScheduleFromRows,
		loanScheduleImbalanced,
		loanScheduleTotal,
		loanScheduleWriteRows,
		type LoanRepaymentDraft
	} from '../../lib/loan-schedule.js';

	/**
	 * The loan agreement, and the repayment lines it owns.
	 *
	 * The matrix is the schedule. An unbalanced sum is highlighted and blocks submit; amounts are
	 * never rewritten. Submit sends the matrix as `repayment_loan`, the loan's complete desired
	 * set: a row dropped from the matrix is a stored repayment the cascade-owned relationship
	 * deletes.
	 */
	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	let schedule = $state<LoanRepaymentDraft[]>([]);
	let seeded = $state(false);

	const repaymentsQuery = $derived(
		record
			? client.db.loan_repayments.findMany({
					where: { loan_id: { eq: record.id } },
					columns: { id: true, due_date: true, amount_due: true, sequence: true },
					orderBy: { sequence: 'asc' },
					limit: 10_000
				})
			: null
	);

	watch(
		() => (repaymentsQuery == null ? 'create' : repaymentsQuery.loading ? 'loading' : 'ready'),
		(state) => {
			if (seeded || state === 'loading') return;
			if (state === 'ready') schedule = loanScheduleFromRows(repaymentsQuery?.current ?? []);
			seeded = true;
		},
		{ lazy: false }
	);

	const COLUMNS = [
		{
			key: 'sequence',
			label: t('component.sequence'),
			field: { name: 'sequence', kind: 'integer', nullable: false } satisfies CollectionField,
			width: 100
		},
		{
			key: 'due_date',
			label: t('component.due_date'),
			field: {
				name: 'due_date',
				kind: 'instant',
				precision: 'day',
				nullable: false
			} satisfies CollectionField,
			width: 200
		},
		{
			key: 'amount_due',
			label: t('component.amount_due'),
			field: { name: 'amount_due', kind: 'numeric', nullable: false } satisfies CollectionField,
			width: 160
		}
	] satisfies readonly MatrixColumn<LoanRepaymentDraft>[];

	const semantic = ((values) =>
		Effect.succeed(
			loanScheduleImbalanced(values.principal, schedule)
				? [
						{
							message: t('component.loan_schedule_imbalance', {
								due: formatNumeric(loanScheduleTotal(schedule)),
								principal: formatNumeric(values.principal)
							})
						}
					]
				: []
		)) satisfies CollectionFormSemantic;
</script>

<CollectionForm
	{client}
	collection="loans"
	defaultValues={record ?? undefined}
	{semantic}
	submitLabel={record ? t('component.save_loan') : t('component.create_loan')}
	loading={record != null && !seeded}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field, form })}
		{@const principal = form.values().principal}
		{@const due = loanScheduleTotal(schedule)}
		{@const imbalanced = loanScheduleImbalanced(principal, schedule)}
		<Grid gap="md" minimum="panel">
			<Field
				name="employment_id"
				label={t('component.employment')}
				relationOptions={{
					label: (employment) =>
						employment.employee_number != null && employment.employee_number !== ''
							? String(employment.employee_number)
							: '—',
					orderBy: { employee_number: 'asc' },
					limit: 1000
				}}
			/>
			<Field
				name="pay_component_id"
				label={t('component.pay_component')}
				relationOptions={{
					label: (component) =>
						component.code != null && component.code !== '' ? String(component.code) : '—',
					where: { nature: { eq: 'DEDUCTION' } },
					orderBy: { code: 'asc' },
					limit: 200
				}}
			/>
			<Field name="principal" label={t('component.principal')} />
			<Field name="effective_range" label={t('component.effective_period')} />
			<Column span="all"><Field name="reference" label={t('component.reference')} /></Column>
			<Column span="all"><Field name="reason" label={t('component.reason')} /></Column>
			<Column span="all">
				<Stack
					as="section"
					gap="sm"
					data-loan-schedule
					data-invalid={imbalanced ? 'true' : undefined}
					aria-labelledby="loan-repayment-schedule-heading"
				>
					<h3 id="loan-repayment-schedule-heading" class="text-sm font-semibold">
						{t('component.repayment_schedule')}
					</h3>
					{#if imbalanced}
						<p class="text-sm text-destructive" role="status">
							{t('component.loan_schedule_imbalance', {
								due: formatNumeric(due),
								principal: formatNumeric(principal)
							})}
						</p>
					{/if}
					<MatrixRenderer
						rows={schedule}
						columns={COLUMNS}
						emptyMessage={t('component.loan_schedule_empty')}
						addRowLabel={t('component.add_repayment')}
						createRow={() => createLoanRepaymentDraft(schedule.at(-1))}
						bounded={false}
						onChange={(rows) => {
							schedule = rows;
							form.setValues({ repayment_loan: loanScheduleWriteRows(rows) });
						}}
					/>
				</Stack>
			</Column>
		</Grid>
	{/snippet}
</CollectionForm>
