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
		loanScheduleRefusals,
		loanScheduleTotal,
		SCHEDULE_IMBALANCED,
		loanScheduleWriteRows,
		type LoanRepaymentDraft
	} from '../../lib/loan-schedule.js';
	import { Button } from '@norbital-ai/ui/button';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import EligibleTypes from '../../lib/ui/eligible-types.svelte';
	import FormSection from '../../lib/ui/form-section.svelte';

	/**
	 * The loan agreement, and the repayment lines it owns.
	 *
	 * The matrix is the schedule. An unbalanced sum is highlighted and blocks submit; amounts are
	 * never rewritten. Submit sends the matrix as `repayment_loan`, the loan's complete desired
	 * set: a row dropped from the matrix is a stored repayment the cascade-owned relationship
	 * deletes.
	 *
	 * The line picker offers only the lines whose eligibility holds for the person today
	 * (`EligibleTypes`); the hook holds the same rule on the day the agreement opens.
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
	 * repayment ids — a repayment is captured once per period it is recovered in.
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

	/**
	 * Submit is blocked by the same function the write hook refuses with, and by every issue it
	 * returns rather than the first — a schedule that is both a cent out and dated past the
	 * agreement's end says so once, not across two round trips.
	 *
	 * The imbalance carries the translated sentence the panel below already shows. The other two
	 * are the refusal's own words, which is what the server would answer with anyway.
	 */
	const semantic = ((values) =>
		Effect.succeed(
			loanScheduleRefusals({
				principal: values.principal ?? Number.NaN,
				effectiveRange: values.effective_range,
				rows: schedule
			}).map((refusal) =>
				refusal.code === SCHEDULE_IMBALANCED
					? {
							message: t('component.loan_schedule_imbalance', {
								due: formatNumeric(loanScheduleTotal(schedule)),
								principal: formatNumeric(values.principal)
							})
						}
					: { message: refusal.message }
			)
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
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.loan_section_loan')}
					hint={t('component.loan_section_loan_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field
							name="employment_id"
							label={t('component.person')}
							relationOptions={employmentRelationOptions(scopedCompanyId)}
						/>
						<EligibleTypes
							catalogue="loan_catalogue"
							employmentId={String(form.values().employment_id ?? '') || undefined}
							settingsCode={scopedSettingsCode}
						>
							{#snippet children(where)}
								<Field
									name="loan_catalogue_id"
									label={t('app.loans.deducted_as')}
									relationOptions={{
										label: (component) =>
											component.code != null && component.code !== ''
												? String(component.code)
												: '—',
										where,
										orderBy: { code: 'asc' },
										limit: 200
									}}
								/>
							{/snippet}
						</EligibleTypes>
						<Field name="principal" label={t('component.principal')} />
						<Field name="effective_range" label={t('component.effective_period')} />
						<Column span="all"><Field name="reference" label={t('component.reference')} /></Column>
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.repayment_schedule')}
					hint={t('component.loan_section_schedule_hint')}
				>
					<Stack
						gap="sm"
						data-loan-schedule
						data-invalid={imbalanced ? 'true' : undefined}
						aria-label={t('component.repayment_schedule')}
					>
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
							isRowDisabled={(row) => lockedIds.has(row.id)}
							canRemoveRow={(row) => !lockedIds.has(row.id)}
							emptyMessage={t('component.loan_schedule_empty')}
							addRowLabel={t('component.add_repayment')}
							createRow={() => createLoanRepaymentDraft(schedule.at(-1))}
							bounded={false}
							onChange={(rows) => applySchedule(rows, form)}
						/>
					</Stack>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
