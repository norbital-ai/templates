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
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { Effect } from 'effect';
	import type { RepresentationProps } from './$types.js';
	import {
		componentEntryEventIssues,
		componentEntryKindIssues
	} from '../../lib/component_entry_refusals.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { decodeNumber } from '@norbital-ai/std/json';
	import {
		employmentRelationOptions,
		hrCreateScope,
		inForceCatalogue
	} from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());

	/**
	 * One-off or recurring now lives inside the ALLOWANCE arm's own `recurrence` union, so the
	 * form reads it from the event rather than from a nullable column beside it. There is nothing
	 * left for a toggle to desynchronise from: the value states which it is.
	 */
	const allowanceRecurrence = $derived.by(() => {
		const event = record?.event;
		if (event == null || typeof event !== 'object') return null;
		if (Reflect.get(event, 'kind') !== 'ALLOWANCE') return null;
		return Reflect.get(event, 'recurrence') ?? null;
	});

	/**
	 * The captured input, which is one junction lookup instead of a walk.
	 *
	 * The junction names the entry directly and carries the period on the row, which is exactly the
	 * pair `settlementLedgerGrants()` exposes to a rank with no payroll authority.
	 *
	 * It is read for the lock and for nothing else. This form used to open with a bordered panel
	 * whose only content was a capture label — a whole field's worth of chrome restating what the
	 * record's own restriction badge already says, in different words, above a form the same
	 * capture disables. The badge is the one statement now, and it is the same badge on leave
	 * requests and loan repayments.
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
	/**
	 * Each component's declared entry shape, so the form can mark a mismatched arm exactly as the
	 * write hook would rather than discovering it on submit. One read over the same scoped
	 * catalogue the picker above already lists.
	 */
	const catalogueQuery = client.db.component_catalogue.findMany({
		columns: { id: true, code: true, entry_kind: true },
		limit: 500
	});
	const entryKindByComponent = $derived(
		new Map((catalogueQuery.current ?? []).map((row) => [row.id, row]))
	);

	const semantic = ((values) => {
		const component = entryKindByComponent.get(String(values.component_catalogue_id ?? ''));
		const event = values.event;
		const declared =
			event != null && typeof event === 'object' ? Reflect.get(event, 'kind') : undefined;
		return Effect.succeed([
			...componentEntryEventIssues({
				event: values.event,
				corrects_adjustment_id: optionalText(values.corrects_adjustment_id),
				amount: values.amount == null ? null : decodeNumber(values.amount),
				pay_period: optionalText(values.pay_period)
			}).map((message) => ({ message, path: ['event'] })),
			// Silent until a component is chosen: an unfilled picker is not a mismatch.
			...(component == null
				? []
				: componentEntryKindIssues(declared, component.entry_kind, component.code).map(
						(message) => ({ message, path: ['component_catalogue_id'] })
					))
		]);
	}) satisfies CollectionFormSemantic;
</script>

<RecordShell
	title={record ? `${record.event_date} · ${record.amount}` : t('component.create_entry')}
>
	<Stack gap="md">
		<CollectionForm
			{client}
			collection="component_entries"
			defaultValues={record ?? undefined}
			{recordMetadata}
			{semantic}
			submitLabel={record ? t('component.save_entry') : t('component.create_entry')}
			onAfterSubmit={record ? undefined : close}
		>
			{#snippet children({ Field, form })}
				<Stack gap="lg">
					<Grid gap="md" minimum="compact">
						<Field
							name="employment_id"
							label={t('component.employment')}
							relationOptions={employmentRelationOptions(scopedCompanyId)}
						/>
						<Field
							name="component_catalogue_id"
							label={t('component.catalogue_component')}
							relationOptions={{
								label: (component) => {
									const code = component.code;
									if (code) return String(code);
									return '—';
								},
								where: inForceCatalogue('component_catalogue_settings', scopedSettingsCode),
								orderBy: { code: 'asc' },
								limit: 500
							}}
						/>
						<Field name="amount" label={t('component.entry_amount')} />
						<Field name="event_date" />
						<Field name="evidence_file" label={t('component.evidence_file')} />
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
					<Stack as="section" gap="sm" aria-labelledby="component-entry-cadence-heading">
						<h3 id="component-entry-cadence-heading" class="text-sm font-semibold">
							{t('component.entry_cadence')}
						</h3>
						<!--
							One-off versus recurring is not a control here any more. It is the ALLOWANCE
							arm's own `recurrence`, drawn by the event renderer below along with the rest
							of that arm's payload, so the toggle and the value cannot disagree — which is
							what a toggle over a nullable sibling column could always do.
						-->
						<p class="text-meta">
							{allowanceRecurrence == null
								? t('component.entry_one_off_hint')
								: t('component.entry_recurring_hint')}
						</p>
						<Field name="pay_period" label={t('component.pay_period_override')} />
					</Stack>
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
</RecordShell>
