<script lang="ts">
	/**
	 * The loan agreement, and the repayment lines it owns.
	 *
	 * The table is the schedule. An unbalanced sum is flagged, and the write refuses it with the same sentences
	 * (`loanScheduleRefusals`); amounts are never rewritten. Submit sends the table as explicit `loan_repayments`
	 * actions: a stored line is an update, a new line a create, a stored line dropped from the table a delete.
	 * A repayment a payslip captured is history: the generator works around it and it cannot be removed.
	 *
	 * The line picker offers only the lines whose eligibility holds for the person today (`EligibleTypes`); the
	 * transform holds the same rule on the day the agreement opens.
	 *
	 * An order with a `recovery_rule` has no schedule to balance: the table lists what payroll withheld.
	 */
	import EmploymentField from '../../../lib/ui/EmploymentField.svelte';
	import { t } from '../../../lib/ui/t.js';
	import Icon from '@iconify/svelte';
	import { bolt } from '$bolt';
	import { untrack } from 'svelte';
	import type { Id } from '@norbital-ai/bolt';
	import {
		Badge,
		Button,
		Field,
		Form,
		Picker,
		RecordShell,
		Table,
		type FormState,
		type RecordView
	} from '@norbital-ai/ui';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import { formatNumeric } from '../../../lib/ui/display-formatters.js';
	import {
		canGenerateLoanSchedule,
		createLoanRepaymentDraft,
		generateLoanSchedule,
		loanScheduleActions,
		loanScheduleFromRows,
		loanScheduleRefusals,
		loanScheduleTotal,
		SCHEDULE_IMBALANCED,
		type LoanRepaymentDraft
	} from '../../../lib/loan-schedule.js';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import EligibleTypes from '../../../lib/ui/eligible-types.svelte';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import * as Predicate from 'effect/Predicate';

	let { view }: { view: RecordView<'loans'> } = $props();
	const scope = hrCreateScope();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const loanId = $derived(record?.id ?? null);

	const stored = liveRows(() =>
		loanId == null
			? null
			: bolt.read('loan_repayments', {
					where: { loan_id: { eq: loanId } },
					orderBy: { due_date: 'asc' },
					all: true
				})
	);
	const storedRows = $derived(stored.current ?? []);
	/** The repayments a payroll run captured: their `payslip_id` is the settlement lock. */
	const lockedIds = $derived(
		new Set<string>(storedRows.filter((row) => row.payslip_id != null).map((row) => row.id))
	);

	/** The table is seeded once the stored lines are read, then edited as the operator's draft. */
	const seeded = $derived(loanId == null || !stored.loading);
	let schedule = $derived.by(() => {
		void seeded;
		return untrack(() => (seeded ? loanScheduleFromRows(storedRows) : []));
	});

	const applySchedule = (rows: readonly LoanRepaymentDraft[], form: FormState) => {
		schedule = [...rows];
		form.set(
			'loan_repayments',
			loanScheduleActions(rows, new Set(storedRows.map((row) => row.id)))
		);
	};
	/** The refusals the write would answer with, every one at once; the imbalance in its own words. */
	const refusals = (form: FormState) =>
		loanScheduleRefusals({
			principal: form.get('principal') ?? Number.NaN,
			effectiveRange: form.get('effective_range'),
			rows: schedule
		}).map((refusal) =>
			refusal.code === SCHEDULE_IMBALANCED
				? t('component.loan_schedule_imbalance', {
						due: formatNumeric(loanScheduleTotal(schedule)),
						principal: formatNumeric(form.get('principal'))
					})
				: refusal.message
		);
	const text = (value: unknown) => (Predicate.isString(value) ? value : '');
</script>

<RecordShell of="loans" {...loanId == null ? {} : { id: loanId }} mode={view.mode}>
	<Form
		of="loans"
		mode={view.mode}
		{...loanId == null ? {} : { id: loanId }}
		{record}
		values={createValues(view)}
		submit={record ? t('component.save_loan') : t('component.create_loan')}
		onOutcome={openCreated(view)}
	>
		{#snippet children(form)}
			{@const principal = form.get('principal')}
			{@const range = form.get('effective_range')}
			{@const ruled = text(form.get('recovery_rule')).trim() !== ''}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.loan_section_loan')}
					hint={t('component.loan_section_loan_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<EmploymentField label={t('component.person')} companyId={scope?.companyId?.()} />
						<EligibleTypes
							catalogue="loan_catalogue"
							employmentId={(text(form.get('employment_id')) || undefined) as
								Id<'employments'> | undefined}
							settingsCode={scope?.settingsCode?.()}
						>
							{#snippet children(where)}
								<Field name="loan_catalogue_id" label={t('app.loans.deducted_as')}>
									{#snippet editor(field)}
										<Picker
											of="loan_catalogue"
											label={['code', 'name']}
											{...where == null ? {} : { where }}
											orderBy={{ code: 'asc' }}
											value={text(field.value) || null}
											onChange={field.onChange}
											disabled={field.disabled}
										/>
									{/snippet}
								</Field>
							{/snippet}
						</EligibleTypes>
						<Field name="principal" label={t('component.principal')} />
						<Field name="effective_range" label={t('component.effective_period')} />
						<Column span="all"><Field name="reference" label={t('component.reference')} /></Column>
						<Column span="all"
							><Field name="disbursed_on" label={t('component.loan_disbursed_on')} /></Column
						>
						<Column span="all"
							><Field
								name="approval_reference"
								label={t('component.loan_approval_reference')}
							/></Column
						>
						<Field name="creditor" />
						<Field name="authority" />
						<Column span="all"><Field name="recovery_rule" /></Column>
						<Field name="priority" />
						<Field name="on_exit" />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.repayment_schedule')}
					hint={t('component.loan_section_schedule_hint')}
				>
					{#snippet trailing()}
						{#if lockedIds.size > 0}
							<Badge variant="outline" title={t('component.loan_schedule_locked_note')}>
								<Inline as="span" gap="xs">
									<Icon icon="lucide:lock-keyhole" class="size-3 shrink-0" aria-hidden="true" />
									{t('component.loan_schedule_locked_badge')}
								</Inline>
							</Badge>
						{/if}
					{/snippet}
					<Stack gap="sm" data-loan-schedule aria-label={t('component.repayment_schedule')}>
						{#each seeded && !ruled ? refusals(form) : [] as refusal (refusal)}
							<p class="text-sm text-destructive" role="status">{refusal}</p>
						{/each}
						{#if !ruled && canGenerateLoanSchedule(principal, range, schedule)}
							<Inline gap="sm" align="center">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									data-generate-schedule
									onclick={() =>
										applySchedule(
											generateLoanSchedule({ principal, range, rows: schedule, lockedIds }),
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
						<!-- `sequence` is the date order, renumbered on every write: the operator owns the day and the amount. -->
						<Table
							of={schedule}
							columns={[
								{ field: 'due_date', label: t('component.due_date'), width: 200, edit: true },
								{ field: 'amount_due', label: t('component.amount_due'), width: 160, edit: true }
							]}
							add={() => createLoanRepaymentDraft(schedule.at(-1))}
							remove
							onChange={(rows) => {
								// A captured line stays: its date and amount are history, and it is never dropped.
								const next = [
									...rows.filter((row) => !lockedIds.has(row.id)),
									...schedule.filter((row) => lockedIds.has(row.id))
								];
								applySchedule(next, form);
							}}
						>
							{#snippet empty()}<p class="text-meta">
									{t('component.loan_schedule_empty')}
								</p>{/snippet}
						</Table>
					</Stack>
				</FormSection>
			</Stack>
		{/snippet}
	</Form>
</RecordShell>
