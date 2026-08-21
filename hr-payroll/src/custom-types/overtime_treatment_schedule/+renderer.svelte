<script lang="ts">
	import { Result, Schema } from 'effect';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Stack } from '@norbital-ai/ui/layout';
	import {
		PAYROLL_TIME_ZONE,
		calendarDateInTimeZone,
		startOfDayInstant,
		todayKey
	} from '../../lib/ui/calendar.js';
	import { overtimeTreatmentScheduleSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	type Entry = Value[number];
	type TreatmentKind = Entry['treatment']['kind'];
	type TreatmentRow = {
		readonly id: string;
		readonly effective_from: string;
		readonly effective_to: string;
		readonly treatment: TreatmentKind;
		readonly special_rule: string | null;
		readonly authority: string;
	};

	const { t } = useI18n<TenantI18nKeys>();
	const OPEN_ENDED_DAY = '9999-12-31';
	const dateField = (name: string): CollectionField => ({ name, kind: 'date', nullable: false });
	const COLUMNS = [
		{
			key: 'effective_from',
			label: 'Effective from',
			field: dateField('effective_from'),
			width: 170
		},
		{ key: 'effective_to', label: 'Effective to', field: dateField('effective_to'), width: 170 },
		{
			key: 'treatment',
			label: 'Chargeability',
			field: {
				name: 'treatment',
				kind: 'enum',
				nullable: false,
				values: ['INCLUDE', 'EXCLUDE', 'REDUCE', 'SPECIAL', 'UNSET']
			} satisfies CollectionField,
			width: 160
		},
		{
			key: 'special_rule',
			label: 'Special rule',
			field: { name: 'special_rule', kind: 'text', nullable: true } satisfies CollectionField,
			placeholder: 'Only when chargeability is special',
			width: 200
		},
		{
			key: 'authority',
			label: 'Authority',
			field: { name: 'authority', kind: 'text', nullable: false } satisfies CollectionField,
			width: 240
		}
	] satisfies readonly MatrixColumn<TreatmentRow>[];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(overtimeTreatmentScheduleSchema)(props.value, {
			onExcessProperty: 'error'
		})
	);
	const entries = $derived<Entry[]>(Result.isSuccess(parsed) ? [...parsed.success] : []);
	const rows = $derived(
		entries.map((entry, index): TreatmentRow => ({
			id: `treatment-${index}`,
			effective_from: calendarDateInTimeZone(
				new Date(entry.effective_range.start),
				PAYROLL_TIME_ZONE
			),
			effective_to: calendarDateInTimeZone(new Date(entry.effective_range.end), PAYROLL_TIME_ZONE),
			treatment: entry.treatment.kind,
			special_rule: entry.treatment.kind === 'SPECIAL' ? entry.treatment.rule : null,
			authority: entry.authority
		}))
	);
	const summary = $derived(
		!Result.isSuccess(parsed)
			? '—'
			: entries.length === 0
				? t('renderer.overtime_treatment_schedule.undecided')
				: entries.map((entry) => entry.treatment.kind.toLowerCase()).join(' · ')
	);

	function treatmentOf(row: TreatmentRow): Entry['treatment'] {
		switch (row.treatment) {
			case 'SPECIAL':
				return { kind: 'SPECIAL', rule: row.special_rule ?? '' };
			case 'INCLUDE':
			case 'EXCLUDE':
			case 'REDUCE':
			case 'UNSET':
				return { kind: row.treatment };
		}
	}

	function emit(nextRows: TreatmentRow[]): void {
		if (props.mode !== 'edit') return;
		props.onValueChange(
			nextRows.map((row) => ({
				authority: row.authority,
				treatment: treatmentOf(row),
				effective_range: {
					start: startOfDayInstant(row.effective_from, PAYROLL_TIME_ZONE),
					end: startOfDayInstant(row.effective_to, PAYROLL_TIME_ZONE)
				}
			}))
		);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="xs">
		<p class="text-meta">One row per period in which the authority's position applies.</p>
		<MatrixRenderer
			{rows}
			columns={COLUMNS}
			{disabled}
			emptyMessage={t('renderer.overtime_treatment_schedule.empty')}
			addRowLabel="Add overtime position"
			createRow={(): TreatmentRow => ({
				id: crypto.randomUUID(),
				effective_from: todayKey(),
				effective_to: OPEN_ENDED_DAY,
				treatment: 'UNSET',
				special_rule: null,
				authority: ''
			})}
			bounded={false}
			onChange={emit}
		/>
	</Stack>
{/if}
