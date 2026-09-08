<script lang="ts">
	/**
	 * The editable fields of an entry component: its unit, the evidence it demands, how it settles,
	 * and the layered ceiling it is bounded by.
	 *
	 * It lives here rather than inside either renderer because both renderers draw exactly this.
	 * `entry_component_definition` is `component_definition`'s ENTRY arm, so a second copy of the
	 * cap editor would be two files free to disagree about what a ceiling is — and the ceiling is
	 * the one part of a component a company argues about.
	 *
	 * No border and no heading: the caller owns the box it sits in, so an entry component's own
	 * field draws one and the union renderer's arm does not draw a second inside the first.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { PAYROLL_TIME_ZONE, startOfDayInstant, todayKey } from '../../lib/ui/calendar.js';
	import EffectiveLayerList from '../../lib/ui/policy-layers/effective-layer-list.svelte';
	import LayerLevelPicker, {
		type PolicyLayerLevel
	} from '../../lib/ui/policy-layers/layer-level-picker.svelte';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Column, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import type { EntryComponentDefinition } from './+definition.js';

	type Cap = NonNullable<EntryComponentDefinition['cap']>;
	type CapLayer = Cap['matrix']['layers'][number];
	type CapAward = CapLayer['award'];
	type AwardKind = CapAward['kind'];

	function options<T extends string>(values: readonly T[]): { value: T; label: string }[] {
		return values.map((value) => ({ value, label: value.replaceAll('_', ' ').toLowerCase() }));
	}

	const UNIT_OPTIONS = options<EntryComponentDefinition['unit']>(['MONEY', 'DAYS', 'HOURS']);
	const EVIDENCE_OPTIONS = options<EntryComponentDefinition['evidence']>([
		'NONE',
		'OPTIONAL',
		'REQUIRED'
	]);
	const SETTLEMENT_OPTIONS = options<EntryComponentDefinition['settlement']>([
		'PAYROLL',
		'COMPANY_DIRECT'
	]);
	const CAP_PERIOD_OPTIONS = options<Cap['period']>([
		'CALENDAR_YEAR',
		'MONTH',
		'LIFETIME',
		'PER_EVENT'
	]);
	const CAP_ON_EXCEED_OPTIONS = options<Cap['on_exceed']>(['BLOCK', 'ALLOW']);
	const AWARD_OPTIONS: { value: AwardKind; label: string; description: string }[] = [
		{ value: 'FIXED', label: 'Fixed amount', description: 'The ceiling is a number' },
		{
			value: 'FORMULA',
			label: 'Formula',
			description: 'The ceiling is a CEL expression over the payslip context'
		}
	];
	/** A ceiling the policy has not withdrawn; a successor layer end-dates it. */
	const OPEN_ENDED = '9999-12-31T00:00:00.000Z';

	const { t } = useI18n<TenantI18nKeys>();

	let {
		value,
		disabled,
		companyId = null,
		onChange
	}: {
		readonly value: EntryComponentDefinition;
		readonly disabled: boolean;
		/** Scopes the people a cap layer may name; null offers none. */
		readonly companyId?: string | null;
		readonly onChange: (next: EntryComponentDefinition) => void;
	} = $props();

	function newCapLayer(level: PolicyLayerLevel): CapLayer {
		const ceiling = {
			eligibility: '',
			authority: '',
			award: { kind: 'FIXED' as const, amount: 0 },
			reimbursement_percentage: 100,
			effective_range: {
				start: startOfDayInstant(todayKey(), PAYROLL_TIME_ZONE),
				end: OPEN_ENDED
			}
		};
		switch (level) {
			case 'ORGANISATION':
				return { level: 'ORGANISATION', ...ceiling };
			case 'EMPLOYEE':
				return { level: 'EMPLOYEE', employment_id: '', ...ceiling };
		}
	}

	/**
	 * Move a cap layer to another arm, carrying everything the arms share.
	 *
	 * Written out rather than spread so the EMPLOYEE arm's extra field is added and dropped
	 * explicitly: a spread would leave it behind when the arm narrows, which the strict decode
	 * rejects only at save time, long after the operator has moved on.
	 */
	function atCapLevel(layer: CapLayer, level: PolicyLayerLevel): CapLayer {
		const { eligibility, authority, award, reimbursement_percentage, effective_range } = layer;
		const ceiling = { eligibility, authority, award, reimbursement_percentage, effective_range };
		switch (level) {
			case 'ORGANISATION':
				return { level: 'ORGANISATION', ...ceiling };
			case 'EMPLOYEE':
				return {
					level: 'EMPLOYEE',
					employment_id: layer.level === 'EMPLOYEE' ? layer.employment_id : '',
					...ceiling
				};
		}
	}

	function defaultAward(kind: AwardKind): CapAward {
		return kind === 'FIXED' ? { kind: 'FIXED', amount: 0 } : { kind: 'FORMULA', expr: '' };
	}

	/**
	 * The cap a freshly ticked "Capped" box starts from.
	 *
	 * Built rather than declared as a constant because its bounds are instants resolved in the
	 * payroll timezone. The literal this replaced read `{ start: '2026-01-01', end: null }`, which is
	 * neither an instant nor a permitted `end` — `instantRangeSchema` requires both bounds — so
	 * ticking the box seeded a cap the form could not save.
	 */
	function defaultCap(): Cap {
		return {
			period: 'CALENDAR_YEAR',
			matrix: { merge: 'MAX_WITH_COMPANY_LAYERS', layers: [newCapLayer('ORGANISATION')] },
			on_exceed: 'BLOCK'
		};
	}
</script>

<Grid gap="sm" minimum="compact">
	<label class="text-sm font-medium">
		<Stack gap="xs">
			Unit
			<Combobox
				options={UNIT_OPTIONS}
				value={value.unit}
				{disabled}
				searchable={false}
				onValueChange={(unit) => {
					if (unit !== null) onChange({ ...value, unit });
				}}
			/>
		</Stack>
	</label>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			Evidence
			<Combobox
				options={EVIDENCE_OPTIONS}
				value={value.evidence}
				{disabled}
				searchable={false}
				onValueChange={(evidence) => {
					if (evidence !== null) onChange({ ...value, evidence });
				}}
			/>
		</Stack>
	</label>
	<label class="text-sm font-medium">
		<Stack gap="xs">
			Settlement
			<Combobox
				options={SETTLEMENT_OPTIONS}
				value={value.settlement}
				{disabled}
				searchable={false}
				onValueChange={(settlement) => {
					if (settlement !== null) onChange({ ...value, settlement });
				}}
			/>
		</Stack>
	</label>
	<label class="self-end text-sm font-medium">
		<Inline gap="sm">
			<input
				type="checkbox"
				class="size-4"
				checked={value.cap !== null}
				{disabled}
				onchange={(event) =>
					onChange({ ...value, cap: event.currentTarget.checked ? defaultCap() : null })}
			/>
			Capped
		</Inline>
	</label>

	{#if value.cap !== null}
		{@const cap = value.cap}
		<label class="text-sm font-medium">
			<Stack gap="xs">
				Cap period
				<Combobox
					options={CAP_PERIOD_OPTIONS}
					value={cap.period}
					{disabled}
					searchable={false}
					onValueChange={(period) => {
						if (period !== null) onChange({ ...value, cap: { ...cap, period } });
					}}
				/>
			</Stack>
		</label>
		<label class="text-sm font-medium">
			<Stack gap="xs">
				On exceed
				<Combobox
					options={CAP_ON_EXCEED_OPTIONS}
					value={cap.on_exceed}
					{disabled}
					searchable={false}
					onValueChange={(onExceed) => {
						if (onExceed !== null) onChange({ ...value, cap: { ...cap, on_exceed: onExceed } });
					}}
				/>
			</Stack>
		</label>
		<Column span="all">
			<EffectiveLayerList
				layers={cap.matrix.layers}
				{disabled}
				emptyMessage={t('renderer.component_definition.empty')}
				addPlaceholder={t('renderer.component_definition.add_placeholder')}
				additions={[
					{
						value: 'ORGANISATION',
						label: 'Organisation layer',
						create: () => newCapLayer('ORGANISATION')
					},
					{ value: 'EMPLOYEE', label: 'Employee layer', create: () => newCapLayer('EMPLOYEE') }
				]}
				onChange={(layers) =>
					onChange({
						...value,
						cap: { ...cap, matrix: { merge: 'MAX_WITH_COMPANY_LAYERS', layers } }
					})}
			>
				{#snippet identity(row)}
					<LayerLevelPicker
						levels={['ORGANISATION', 'EMPLOYEE']}
						level={row.layer.level}
						employmentId={row.layer.level === 'EMPLOYEE' ? row.layer.employment_id : null}
						{companyId}
						disabled={row.disabled}
						onLevelChange={(level) => row.replace(atCapLevel(row.layer, level))}
						onEmploymentChange={(employment) => {
							if (row.layer.level === 'EMPLOYEE')
								row.replace({ ...row.layer, employment_id: employment });
						}}
					/>
				{/snippet}

				{#snippet body(row)}
					<Grid gap="sm" minimum="compact">
						<label class="text-sm font-medium">
							<Stack gap="xs">
								Ceiling
								<Combobox
									options={AWARD_OPTIONS}
									value={row.layer.award.kind}
									disabled={row.disabled}
									searchable={false}
									onValueChange={(kind) => {
										if (kind !== null && kind !== row.layer.award.kind)
											row.replace({ ...row.layer, award: defaultAward(kind) });
									}}
								/>
							</Stack>
						</label>
						{#if row.layer.award.kind === 'FIXED'}
							<label class="text-sm font-medium">
								<Stack gap="xs">
									Amount
									<Input
										type="number"
										min="0"
										step="0.01"
										value={row.layer.award.amount}
										disabled={row.disabled}
										oninput={(event) =>
											row.replace({
												...row.layer,
												award: {
													kind: 'FIXED',
													amount: numberFrom(event.currentTarget.value, 0)
												}
											})}
									/>
								</Stack>
							</label>
						{:else}
							<label class="text-sm font-medium">
								<Stack gap="xs">
									Expression
									<Input
										value={row.layer.award.expr}
										disabled={row.disabled}
										placeholder={t('component.cel_expression')}
										oninput={(event) =>
											row.replace({
												...row.layer,
												award: { kind: 'FORMULA', expr: event.currentTarget.value }
											})}
									/>
								</Stack>
							</label>
						{/if}
						<label class="text-sm font-medium">
							<Stack gap="xs">
								Reimbursed (%)
								<Input
									type="number"
									min="0"
									max="100"
									step="1"
									value={row.layer.reimbursement_percentage}
									disabled={row.disabled}
									oninput={(event) =>
										row.replace({
											...row.layer,
											reimbursement_percentage: numberFrom(event.currentTarget.value, 100)
										})}
								/>
							</Stack>
						</label>
						<Column span="all">
							<Stack gap="xs" class="text-sm font-medium">
								<span>{t('component.who_this_layer_covers')}</span>
								<Input
									value={row.layer.eligibility}
									placeholder={t('component.eligibility_placeholder')}
									disabled={row.disabled}
									oninput={(event) =>
										row.replace({ ...row.layer, eligibility: event.currentTarget.value })}
								/>
							</Stack>
						</Column>
					</Grid>
				{/snippet}
			</EffectiveLayerList>
		</Column>
	{/if}
</Grid>
