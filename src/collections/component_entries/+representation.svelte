<script lang="ts">
	/**
	 * One component entry, and whether payroll has already taken it.
	 *
	 * The event arm — why the money exists — is a discriminated union with a renderer that draws a
	 * picker for it, so the form is ordinary fields beside that one custom value. What replaces the
	 * legacy form's arm picker is the arm rule, `componentEntryEventIssues`, attached
	 * as semantic validation: the write hook and this form read the same function, so the form marks
	 * exactly what the server would refuse — every issue at once, rather than one resubmission at a
	 * time.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import type { CollectionFormSemantic } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { Effect } from 'effect';
	import type { RepresentationProps } from './$types.js';
	import { componentEntryEventIssues } from '../../lib/component_entry_refusals.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { decodeNumber } from '@norbital-ai/std/json';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * The captured input, which is one junction lookup instead of a walk.
	 *
	 * The junction names the entry directly and carries the period on the row, which is exactly the
	 * pair `settlementLedgerGrants()` exposes to a rank with no payroll authority.
	 */
	const captureQuery = $derived(
		record
			? client.db.payslip_component_entry_inputs.findFirst({
					where: { component_entry_id: { eq: record.id } },
					columns: { period: true }
				})
			: null
	);

	/**
	 * A human capture label, but only once a run has actually captured this entry. A drafted run
	 * that has not reached it yet must not read as though it had.
	 */
	const capturedByPayslip = $derived.by((): string => {
		if (!record) return '—';
		if (captureQuery?.loading) return t('component.loading');
		const capture = captureQuery?.current;
		if (capture) return t('component.paid_in', { period: capture.period });
		if (!record.pay_period) return t('component.settled_outside_payroll');
		return '—';
	});

	/**
	 * The same capture drives the label and the lock. An approved record stays editable until the
	 * capture exists; approval is workflow, consumption is settlement.
	 */
	const settledBy = $derived(
		captureQuery?.current ? { period: captureQuery.current.period } : null
	);
	const lock = $derived(
		record
			? sourceLock({
					existing: true,
					approvalId: record.approval_id,
					dates: [],
					settledBy,
					datePassed: 'IS_NOT_A_LOCK'
				})
			: { kind: 'NONE' as const }
	);
	const recordMetadata = $derived(sourceLockRecordMetadata(lock, t));

	/** A form value as the arm rule reads text: a day picker hands back an instant, not a string. */
	function optionalText(value: unknown): string | null {
		if (value == null) return null;
		return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
	}

	/**
	 * The arm rule, and nothing beside it.
	 *
	 * `path` is the column the issue is about where the sentence names one, and `event` otherwise —
	 * the arm is what a mismatched payload is always ultimately about.
	 */
	const semantic = ((values) =>
		Effect.succeed(
			componentEntryEventIssues({
				event: values.event,
				effective_range: values.effective_range,
				corrects_adjustment_id: optionalText(values.corrects_adjustment_id),
				amount: values.amount == null ? null : decodeNumber(values.amount),
				pay_period: optionalText(values.pay_period)
			}).map((message) => ({ message, path: ['event'] }))
		)) satisfies CollectionFormSemantic;
</script>

<Stack gap="md">
	<Grid gap="md" minimum="compact">
		<Column span="all">
			<Stack class="rounded-md border border-border bg-muted/20 p-3" gap="xs">
				<span class="text-meta">{t('component.payroll_consumption')}</span>
				<span aria-live="polite" class="block text-sm">{capturedByPayslip}</span>
			</Stack>
		</Column>
	</Grid>

	<CollectionForm
		{client}
		collection="component_entries"
		defaultValues={record ?? undefined}
		{recordMetadata}
		{semantic}
		submitLabel={record ? t('component.save_entry') : t('component.create_entry')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<Grid gap="md" minimum="compact">
					<Field
						name="employment_id"
						label={t('component.employment')}
						relationOptions={{
							label: (employment) =>
								employment.employee_number != null && employment.employee_number !== ''
									? String(employment.employee_number)
									: '—',
							orderBy: { employee_number: 'asc' },
							limit: 10_000
						}}
					/>
					<Field
						name="pay_component_id"
						label={t('component.pay_component')}
						relationOptions={{
							label: (component) => {
								const code = component.code;
								if (code) return String(code);
								return '—';
							},
							orderBy: { code: 'asc' },
							limit: 500
						}}
					/>
					<Field name="amount" label={t('component.entry_amount')} />
					<Field name="quantity" />
					<Field name="event_date" />
					<Field name="pay_period" label={t('component.pay_period')} />
					<Field name="evidence_file" label={t('component.evidence_file')} />
					<Column span="all">
						<Field name="effective_range" label={t('component.entry_effective_period')} />
					</Column>
					<Column span="all">
						<Field
							name="corrects_adjustment_id"
							label={t('component.corrects_adjustment')}
							relationOptions={{
								label: (adjustment) =>
									[adjustment.label, adjustment.amount]
										.filter((part) => part != null && part !== '')
										.join(' · ') || '—',
								orderBy: { sequence: 'desc' },
								limit: 500
							}}
						/>
					</Column>
				</Grid>
				<Stack as="section" gap="sm" aria-labelledby="component-entry-event-heading">
					<h3 id="component-entry-event-heading" class="text-sm font-semibold">
						{t('component.event_kind')}
					</h3>
					<p class="text-meta">{t('component.event_description')}</p>
					<Field name="event" />
				</Stack>
			</Stack>
		{/snippet}
	</CollectionForm>
</Stack>
