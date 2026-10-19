<script lang="ts">
	/**
	 * How the jurisdiction's checks bind an entity (`validation_severity`): one choice for every rule, and an override
	 * per rule of the version in force, keyed by its code: its `VALIDATIONS` rules and the statutory schemes whose
	 * `refuse_when` refuses a payslip. Hold is offered only for a rule that holds a payslip itself.
	 */
	import { bolt } from '$bolt';
	import type { Row } from '@norbital-ai/bolt';
	import { Combobox, Label } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import * as Predicate from 'effect/Predicate';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';

	type Severity = NonNullable<Row<'entity'>['validation_severity']>;
	type Kind = Severity['rules'][string];
	let {
		code,
		value,
		onChange,
		disabled,
		id
	}: {
		code: unknown;
		value: unknown;
		onChange: (next: Severity) => void;
		disabled: boolean;
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
	const version = liveRows(() =>
		!Predicate.isString(code)
			? null
			: bolt.read('jurisdiction_settings', {
					where: {
						code: { eq: code },
						sealed_at: { isNull: false },
						voided_at: { isNull: true },
						effective_range: { contains: { today: '' as const } }
					},
					select: {
						rule_set: {
							select: { code: true, rules: true },
							where: { family: { eq: 'VALIDATIONS' } },
							all: true
						},
						statutory_contribution_catalog: {
							select: { code: true, configuration: true },
							all: true
						}
					},
					all: true
				})
	);
	const rules = $derived(
		(version.current ?? []).flatMap((row) => [
			...row.rule_set.flatMap((held) =>
				Schema.is(Rule)(held.rules)
					? [{ code: held.code, message: held.rules.message, holds: held.rules.kind === 'hold' }]
					: []
			),
			...row.statutory_contribution_catalog.flatMap((held) => {
				const guards = held.configuration?.refuse_when ?? [];
				return guards.length === 0
					? []
					: [
							{
								code: held.code,
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

<Stack gap="sm">
	<Stack gap="xs">
		<Label for={id}>{t('entity.severity_every_rule')}</Label>
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
	</Stack>
	<Grid minimum="card">
		{#each rules as rule (rule.code)}
			<Stack gap="xs">
				<Label for={`${id}-${rule.code}`}>{rule.code}</Label>
				<p class="text-xs text-muted-foreground">{rule.message}</p>
				<Combobox
					id={`${id}-${rule.code}`}
					{disabled}
					clearable
					placeholder={t('entity.severity_inherit')}
					options={(rule.holds
						? (['warn', 'refuse', 'hold'] as const)
						: (['warn', 'refuse'] as const)
					).map((kind) => ({ value: kind, label: label(kind) }))}
					value={current.rules[rule.code] ?? null}
					onChange={(next) => setRule(rule.code, next)}
				/>
			</Stack>
		{/each}
	</Grid>
</Stack>
