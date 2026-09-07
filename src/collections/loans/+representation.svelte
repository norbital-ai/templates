<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm, type CollectionFormSemantic } from '@norbital-ai/ui/collection-form';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Effect } from 'effect';
	import { watch } from 'runed';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import {
		canGenerateLoanSchedule,
		createLoanRepaymentDraft,
		generateLoanSchedule,
		loanScheduleFromRows,
		loanScheduleImbalanced,
		loanScheduleTotal,
		loanScheduleWriteRows,
		type LoanRepaymentDraft
	} from '../../lib/loan-schedule.js';
	import { Button } from '@norbital-ai/ui/button';
	import {
		employmentRelationOptions,
		hrCreateScope,
		inForceCatalogue
	} from '../../lib/ui/create-scope.js';

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
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());

	let schedule = $state<LoanRepaymentDraft[]>([]);
	let seeded = $state(false);

	const repaymentsQuery = $derived(
		record
			? client.db.loan_repayments.findMany({
					where: { loan_id: { eq: record.id } },
					columns: { id: true, due_date: true, amount_due: true, sequence: true },
					orderBy: { due_date: 'asc' },
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

	/**
	 * The matrix shows the two facts the operator owns. `sequence` is not one of them: it is the
	 * date order, renumbered on every write by `loanScheduleWriteRows`, and a column asking the
	 * operator to restate the sort is a column that can contradict it.
	 */
	const COLUMNS = [
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

	/**
	 * The repayments a payroll run has already captured.
	 *
	 * These are history: the generator re-dates and re-prices everything else around them, and the
	 * matrix must not offer them for editing. One junction lookup, keyed by the loan's own
	 * repayment ids — the same shape every other settlement lookup in this workspace uses.
	 */
	const capturedQuery = $derived.by(() => {
		const ids = schedule.map((row) => row.id);
		if (ids.length === 0) return null;
		return client.db.payslip_loan_repayment_inputs.findMany({
			where: { loan_repayment_id: { in: ids } },
			columns: { loan_repayment_id: true },
			limit: 10_000
		});
	});
	const lockedIds = $derived(
		new Set((capturedQuery?.current ?? []).map((row) => row.loan_repayment_id))
	);

	const applySchedule = (
		rows: readonly LoanRepaymentDraft[],
		form: { setValues: (values: Record<string, unknown>) => void }
	) => {
		schedule = [...rows];
		form.setValues({ repayment_loan: loanScheduleWriteRows(rows) });
	};

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

<RecordShell title={record?.reference ?? t('component.create_loan')}>
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
			{@const canGenerate = canGenerateLoanSchedule(
				principal,
				form.values().effective_range,
				schedule
			)}
			<Grid gap="md" minimum="panel">
				<Field
					name="employment_id"
					label={t('component.employment')}
					relationOptions={employmentRelationOptions(scopedCompanyId)}
				/>
				<Field
					name="component_catalogue_id"
					label={t('component.catalogue_component')}
					relationOptions={{
						label: (component) =>
							component.code != null && component.code !== '' ? String(component.code) : '—',
						where: {
							nature: { eq: 'DEDUCTION' },
							...inForceCatalogue('component_catalogue_settings', scopedSettingsCode)
						},
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
						{#if canGenerate}
							<Inline gap="sm" align="center">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									data-generate-schedule
									onclick={() =>
										applySchedule(
											generateLoanSchedule({
												principal,
												range: form.values().effective_range,
												rows: schedule,
												lockedIds
											}),
											form
										)}
								>
									{schedule.length === 0
										? t('component.generate_repayment_schedule')
										: t('component.regenerate_repayment_schedule')}
								</Button>
								<span class="text-meta">{t('component.generate_repayment_schedule_hint')}</span>
							</Inline>
						{/if}
						<MatrixRenderer
							rows={schedule}
							columns={COLUMNS}
							emptyMessage={t('component.loan_schedule_empty')}
							addRowLabel={t('component.add_repayment')}
							createRow={() => createLoanRepaymentDraft(schedule.at(-1))}
							bounded={false}
							onChange={(rows) => applySchedule(rows, form)}
						/>
					</Stack>
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
