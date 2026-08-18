<script lang="ts">
	/**
	 * The overtime position of one statutory scheme, as an effective-dated list.
	 *
	 * This is the same frame `pay_component_policy` mounts — a list of rows carrying an authority, a
	 * `contribution_treatment` and an effective range — with one row less of identity: every row here
	 * is about the same thing, the derived overtime this scheme is being asked to charge. The column
	 * the value sits in already says which scheme, so `identity` is a sentence rather than a picker.
	 */
	import { Result, Schema } from 'effect';
	import EffectiveLayerList from '../../lib/ui/policy-layers/effective-layer-list.svelte';
	import ContributionTreatmentRenderer from '../contribution_treatment/+renderer.svelte';
	import { PAYROLL_TIME_ZONE, startOfDayInstant, todayKey } from '../../lib/ui/calendar.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { Stack } from '@norbital-ai/ui/layout';
	import { overtimeTreatmentScheduleSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type Entry = Value[number];
	type Charge = Entry['treatment'];

	/** A position the authority has not withdrawn; a successor row end-dates it. */
	const OPEN_ENDED = '9999-12-31T00:00:00.000Z';

	const CHARGE_FIELD = {
		name: 'treatment',
		kind: 'contribution_treatment',
		nullable: false
	} satisfies CollectionField;

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(overtimeTreatmentScheduleSchema)(props.value, {
			onExcessProperty: 'error'
		})
	);
	const entries = $derived<Entry[]>(Result.isSuccess(parsed) ? [...parsed.success] : []);
	const summary = $derived(
		!Result.isSuccess(parsed)
			? '—'
			: entries.length === 0
				? t('renderer.overtime_treatment_schedule.undecided')
				: entries.map((entry) => entry.treatment.kind.toLowerCase()).join(' · ')
	);

	function emit(next: Entry[]): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function newEntry(): Entry {
		return {
			authority: '',
			treatment: { kind: 'UNSET' },
			effective_range: {
				start: startOfDayInstant(todayKey(), PAYROLL_TIME_ZONE),
				end: OPEN_ENDED
			}
		};
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm" class="rounded-md border border-border bg-muted/20 p-3">
		<EffectiveLayerList
			layers={entries}
			{disabled}
			emptyMessage={t('renderer.overtime_treatment_schedule.empty')}
			addPlaceholder={t('renderer.overtime_treatment_schedule.add_placeholder')}
			additions={[
				{
					value: 'OVERTIME_TREATMENT',
					label: 'Overtime position',
					description: 'How this scheme charges derived overtime',
					create: newEntry
				}
			]}
			onChange={emit}
		>
			{#snippet identity()}
				<p class="text-xs text-muted-foreground">
					{t('renderer.overtime_treatment_schedule.identity')}
				</p>
			{/snippet}

			{#snippet body(row)}
				<Stack gap="xs" class="text-sm font-medium">
					<span>{t('component.chargeability')}</span>
					<ContributionTreatmentRenderer
						field={CHARGE_FIELD}
						value={row.layer.treatment}
						mode="edit"
						disabled={row.disabled}
						onValueChange={(next: Charge | null) => {
							if (next !== null) row.replace({ ...row.layer, treatment: next });
						}}
					/>
				</Stack>
			{/snippet}
		</EffectiveLayerList>
	</Stack>
{/if}
