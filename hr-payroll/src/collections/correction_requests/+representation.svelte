<script lang="ts">
	/**
	 * One correction to a payslip line that has already settled: whose, which settled line it fixes,
	 * whether it supersedes or reverses that line, how much, and why.
	 *
	 * `corrects_adjustment_id` is the sharpest thing the split buys, and this form is where it shows.
	 * It was a nullable column beside a five-armed union, permitted only on one arm and required
	 * there by a hook — and **every** seeded correction was missing it, because `seed-from-bank`
	 * writes without crossing the authorization boundary and the only enforcement was a rule on a
	 * path the data did not take. It is `notNull` and a real foreign key now, so this picker is not
	 * a courtesy: the write has nowhere to land without it.
	 *
	 * A correction names a settled *output*, never another request. Outputs are immutable, so there
	 * is no chain to walk and no sign to flip transitively, which is why the picker offers
	 * `payslip_adjustments` and nothing from the five request collections.
	 *
	 * `operation` is an ordinary enum field. `CORRECTION` supersedes the line under the referenced
	 * component's policy; `REVERSAL` settles in the opposite bucket of it — the engine derives the
	 * sign from the settled output and this form never states one.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
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
	 * The capture, read for the lock and for nothing else.
	 *
	 * A correction is captured like every other request, and it is locked like one: correcting a
	 * settled correction is a *new* row naming the adjustment that correction produced, never an
	 * edit of the row a run already took.
	 */
	const captureQuery = $derived(
		record
			? client.db.payslip_correction_request_inputs.findFirst({
					where: { correction_request_id: { eq: record.id } },
					columns: { period: true }
				})
			: null
	);
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
</script>

<RecordShell
	title={record
		? `${formatCalendarDate(record.corrected_on)} · ${formatNumeric(record.amount)}`
		: t('component.create_correction')}
>
	<CollectionForm
		{client}
		collection="correction_requests"
		defaultValues={record ?? undefined}
		{recordMetadata}
		submitLabel={record ? t('component.save_correction') : t('component.create_correction')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="compact">
				<Field
					name="employment_id"
					label={t('component.person')}
					relationOptions={employmentRelationOptions(scopedCompanyId)}
				/>
				<Field
					name="component_catalogue_id"
					label={t('component.catalogue_component')}
					relationOptions={{
						label: (component) => String(component.code ?? '') || '—',
						where: {
							entry_kind: { eq: 'CORRECTION' },
							...inForceCatalogue('component_catalogue_settings', scopedSettingsCode)
						},
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="amount" label={t('component.entry_amount')} />
				<Field name="corrected_on" label={t('component.corrected_on')} />
				<Field name="operation" label={t('component.adjustment_operation')} />
				<Field name="pay_period" label={t('component.pay_period_override')} />
				<Column span="all">
					<Field
						name="corrects_adjustment_id"
						label={t('component.corrects_adjustment')}
						relationOptions={{
							label: (adjustment) =>
								[adjustment.period, adjustment.label, adjustment.amount]
									.filter((part) => part != null && part !== '')
									.join(' · ') || '—',
							orderBy: { sequence: 'desc' },
							limit: 500
						}}
					/>
				</Column>
				<Column span="all">
					<Field name="reason" label={t('component.adjustment_reason')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
