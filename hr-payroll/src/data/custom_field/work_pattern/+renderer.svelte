<script lang="ts">
	/**
	 * A named pattern's shape: either a repeating day cycle of roster codes (one row per day in a
	 * matrix), anchored at the pattern row's effective start, or a roster-assigned expectation
	 * where no cycle can be generated. The shape selector switches between the two; there is no
	 * anchor date to type — the row already states when it begins.
	 */
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { Combobox, Input } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import MatrixRenderer, { type MatrixColumn } from '../../../lib/ui/grid.svelte';
	import type { CollectionField } from '../../../lib/ui/grid.svelte';
	import { watch } from 'runed';
	import { bolt } from '$bolt';

	import { numberFrom, nullableNumberFrom } from '../../../lib/ui/renderer-input.js';
	import RosterCodeCell from '../../../lib/ui/roster-code-cell.svelte';
	import type { Id } from '@norbital-ai/bolt';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { WorkPattern as Value } from '../../../lib/datatypes/work_pattern.js';
	import * as Predicate from 'effect/Predicate';

	type Expectation = Extract<Value, { expectation: unknown }>['expectation'];
	type DayRow = { id: string; roster_code_id: string; company_id: string | null };

	let { view }: { view: CustomFieldView<Value> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const current = $derived(view.value);
	// The record's other fields arrive as the form's draft (`Json`): its entity is asserted here, where it enters.
	const companyId = $derived(
		Predicate.isString(view.row?.company_id) ? (view.row.company_id as Id<'companies'>) : null
	);

	const codes = liveRows(() =>
		companyId == null
			? null
			: bolt.read('shift_definitions', {
					where: { company_id: { eq: companyId }, approval_id: { isNull: true } },
					select: { id: true },
					orderBy: { code: 'asc' },
					all: true
				})
	);
	const codeIds = $derived((codes.current ?? []).map((code) => code.id));

	/* ── shape ─────────────────────────────────────────────────────────────────────────────── */
	type Shape = 'CYCLE' | 'DECLARED';
	const shapeOptions = $derived<{ value: Shape; label: string }[]>([
		{ value: 'CYCLE', label: t('renderer.work_pattern.shape_cycle') },
		{ value: 'DECLARED', label: t('renderer.work_pattern.shape_rostered') }
	]);
	const shape = $derived<Shape>(current == null || 'days' in current ? 'CYCLE' : 'DECLARED');
	function switchShape(next: Shape): void {
		if (next === shape) return;
		if (next === 'CYCLE') {
			if (codeIds.length > 0) emit({ days: [{ roster_code_id: codeIds[0]! }] });
			return;
		}
		emit({
			expectation: {
				days_per_week: 6,
				minimum_paid_minutes_per_week: null,
				maximum_paid_minutes_per_week: null
			}
		});
	}

	function emit(value: Value): void {
		if (view.mode === 'edit') view.onChange(value);
	}

	/* ── day cycle ─────────────────────────────────────────────────────────────────────────── */
	let dayRows = $state<DayRow[]>([]);
	watch(
		() => current,
		(pattern) => {
			if (pattern == null || !('days' in pattern)) return;
			dayRows = pattern.days.map((day, index) => ({
				id: String(index),
				roster_code_id: day.roster_code_id,
				company_id: companyId
			}));
		},
		{ lazy: false }
	);
	// A create has no value yet; the first available code opens the cycle so the form can be saved.
	watch(
		() => codeIds,
		(ids) => {
			if (view.mode !== 'edit' || current != null || ids.length === 0) return;
			emit({ days: [{ roster_code_id: ids[0]! }] });
		}
	);

	const dayColumns: MatrixColumn<DayRow>[] = [
		{
			key: 'roster_code_id',
			label: t('roster.day_sheet_roster_code'),
			field: { name: 'roster_code_id', kind: 'uuid', nullable: false } satisfies CollectionField,
			renderer: RosterCodeCell
		}
	];

	function commitDays(rows: DayRow[]): void {
		dayRows = rows.map((row) => ({ ...row, company_id: companyId }));
		const days = dayRows
			.filter((row) => row.roster_code_id !== '')
			.map((row) => ({ roster_code_id: row.roster_code_id }));
		if (days.length === 0) return;
		emit({ days } satisfies Value);
	}

	/* ── roster-assigned expectation ───────────────────────────────────────────────────────── */
	function editExpectation(change: Partial<Expectation>): void {
		if (current == null || !('expectation' in current)) return;
		emit({ expectation: { ...current.expectation, ...change } } as Value);
	}
	const expectation = $derived(
		current != null && 'expectation' in current ? current.expectation : null
	);

	const summary = $derived.by(() => {
		if (current == null) return '—';
		if ('expectation' in current) {
			const value = current.expectation;
			const bounds = [
				value.minimum_paid_minutes_per_week == null
					? ''
					: `min ${value.minimum_paid_minutes_per_week / 60}h`,
				value.maximum_paid_minutes_per_week == null
					? ''
					: `max ${value.maximum_paid_minutes_per_week / 60}h`
			].filter(Boolean);
			return `Rostered · ${value.days_per_week}d/week${bounds.length ? ` · ${bounds.join(' · ')}` : ''}`;
		}
		return `${current.days.length}-day cycle`;
	});
</script>

{#if view.mode === 'show'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm">
		<Labelled label={t('renderer.work_pattern.shape')} class="text-xs" muted>
			<Combobox
				class="w-64 max-w-full"
				size="sm"
				options={shapeOptions}
				value={shape}
				{disabled}
				onChange={(next) => {
					if (next) switchShape(next);
				}}
			/>
		</Labelled>
		{#if expectation != null}
			<p class="text-meta">{t('renderer.work_pattern.expectation_hint')}</p>
			<Grid gap="sm" minimum="compact">
				<Labelled label={t('renderer.work_pattern.days_per_week')} class="text-xs" muted>
					<Input
						class="h-8"
						type="number"
						min="0.5"
						max="7"
						step="0.5"
						value={expectation.days_per_week}
						{disabled}
						oninput={(event) =>
							editExpectation({ days_per_week: numberFrom(event.currentTarget.value, 0) })}
					/>
				</Labelled>
				<label class="text-xs">
					<Stack gap="xs">
						<span class="text-muted-foreground"
							>{t('renderer.work_pattern.minimum_minutes_per_week')}</span
						>
						<Input
							class="h-8"
							type="number"
							min="0"
							step="1"
							value={expectation.minimum_paid_minutes_per_week ?? ''}
							{disabled}
							oninput={(event) =>
								editExpectation({
									minimum_paid_minutes_per_week: nullableNumberFrom(event.currentTarget.value)
								})}
						/>
					</Stack>
				</label>
				<label class="text-xs">
					<Stack gap="xs">
						<span class="text-muted-foreground"
							>{t('renderer.work_pattern.maximum_minutes_per_week')}</span
						>
						<Input
							class="h-8"
							type="number"
							min="0"
							step="1"
							value={expectation.maximum_paid_minutes_per_week ?? ''}
							{disabled}
							oninput={(event) =>
								editExpectation({
									maximum_paid_minutes_per_week: nullableNumberFrom(event.currentTarget.value)
								})}
						/>
					</Stack>
				</label>
			</Grid>
		{:else}
			<Stack gap="sm">
				{#if codeIds.length === 0}
					<p class="text-meta">{t('renderer.work_pattern.no_codes')}</p>
				{:else}
					<MatrixRenderer
						bind:rows={dayRows}
						columns={dayColumns}
						{disabled}
						bounded={false}
						getRowId={(row) => row.id}
						addRowLabel={t('renderer.work_pattern.add_day')}
						createRow={() => ({
							id: String(dayRows.length),
							roster_code_id: codeIds[0] ?? '',
							company_id: companyId
						})}
						onChange={commitDays}
					/>
				{/if}
			</Stack>
		{/if}
	</Stack>
{/if}
