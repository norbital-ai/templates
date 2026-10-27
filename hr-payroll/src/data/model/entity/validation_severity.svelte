<script lang="ts">
	/**
	 * How the jurisdiction's checks bind an entity (`validation_severity`): one choice for every rule, and an override
	 * per rule of the version in force, keyed by its code: its `VALIDATIONS` rules and the statutory schemes whose
	 * `refuse_when` refuses a payslip, one table row each by its name. Hold is offered only for a rule that holds a payslip
	 * itself. Readonly, the choices read as text.
	 */
	import { bolt } from '$bolt';
	import type { Row } from '@norbital-ai/bolt';
	import { Combobox, Label, Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import * as Predicate from 'effect/Predicate';

	type Severity = NonNullable<Row<'entity'>['validation_severity']>;
	type Kind = Severity['rules'][string];
	let {
		code,
		value,
		onChange,
		disabled = false,
		readonly = false,
		id
	}: {
		code: unknown;
		value: unknown;
		onChange: (next: Severity) => void;
		disabled?: boolean;
		readonly?: boolean;
		id: string;
	} = $props();
	const t = bolt.t;
	const Rule = Schema.Struct({ kind: Schema.String, message: Schema.String });
	const SeverityValue = Schema.Struct({
		default: Schema.Literals(['refuse', 'warn', 'record']),
		rules: Schema.Record(Schema.String, Schema.Literals(['refuse', 'warn', 'hold']))
	});
	// Absent: every rule keeps its own kind.
	const current = $derived<Severity>(
		Schema.is(SeverityValue)(value) ? value : { default: 'record', rules: {} }
	);
	const day = bolt.clock('day');
	const version = $derived(
		!Predicate.isString(code)
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: {
							code: { eq: code },
							sealed_at: { isNull: false },
							voided_at: { isNull: true },
							effective_range: { contains: day.today }
						},
						fields: ['code']
					},
					'jurisdiction_settings.rule_set': {
						where: { family: { eq: 'VALIDATIONS' } },
						fields: ['code', 'name', 'rules']
					},
					'jurisdiction_settings.statutory_contribution_catalog': {
						fields: ['code', 'name', 'configuration']
					}
				})
	);
	const rules = $derived(
		(version?.current?.jurisdiction_settings.rows ?? []).flatMap((row) => [
			...row.rule_set.flatMap((held) =>
				Schema.is(Rule)(held.rules)
					? [
							{
								code: held.code,
								name: held.name,
								message: held.rules.message,
								holds: held.rules.kind === 'hold'
							}
						]
					: []
			),
			...row.statutory_contribution_catalog.flatMap((held) => {
				const guards = held.configuration?.refuse_when ?? [];
				return guards.length === 0
					? []
					: [
							{
								code: held.code,
								name: held.name,
								message: guards.map((guard) => guard.message).join(' · '),
								holds: false
							}
						];
			})
		])
	);
	const LABELS = {
		refuse: 'entity.severity_refuse',
		warn: 'entity.severity_warn',
		hold: 'entity.severity_hold',
		record: 'entity.severity_record'
	} as const;
	const label = (kind: keyof typeof LABELS) => t(LABELS[kind]);
	const setRule = (rule: string, kind: Kind | null) => {
		const { [rule]: _dropped, ...others } = current.rules;
		onChange({ ...current, rules: kind == null ? others : { ...others, [rule]: kind } });
	};
</script>

{#snippet severityCell({ row }: { row: (typeof rules)[number] })}
	{@const chosen = current.rules[row.code] ?? null}
	{#if readonly}
		{chosen == null ? t('entity.severity_inherit') : label(chosen)}
	{:else}
		<Combobox
			id={`${id}-${row.code}`}
			aria-label={row.name}
			{disabled}
			clearable
			placeholder={t('entity.severity_inherit')}
			options={(row.holds
				? (['warn', 'refuse', 'hold'] as const)
				: (['warn', 'refuse'] as const)
			).map((kind) => ({ value: kind, label: label(kind) }))}
			value={chosen}
			onChange={(next) => setRule(row.code, next)}
		/>
	{/if}
{/snippet}

<Stack gap="sm">
	<Stack gap="xs">
		<Label for={id}>{t('entity.severity_every_rule')}</Label>
		{#if readonly}
			<p class="text-sm font-medium">{label(current.default)}</p>
		{:else}
			<Combobox
				{id}
				{disabled}
				options={(['warn', 'refuse', 'record'] as const).map((kind) => ({
					value: kind,
					label: label(kind)
				}))}
				value={current.default}
				onChange={(next) => next != null && onChange({ ...current, default: next })}
			/>
		{/if}
	</Stack>
	{#if rules.length > 0}
		<Table
			of={rules}
			key={`${id}-rules`}
			columns={[
				{ field: 'name', label: t('entity.severity_rule') },
				{ field: 'message', label: t('entity.severity_message') },
				{ field: 'code', label: t('entity.severity_choice'), cell: severityCell }
			]}
			toolbar={{
				new: false,
				actions: false,
				search: false,
				filter: false,
				export: false,
				delete: false,
				select: false
			}}
		/>
	{/if}
</Stack>
