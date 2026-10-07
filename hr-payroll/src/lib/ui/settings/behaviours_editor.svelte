<script lang="ts">
	/**
	 * The behaviours record as one accordion per rule: the rule's trigger, condition, reads and effect,
	 * edited through the platform's schema editor. Rules add and remove; the version stamps the set.
	 */
	import { bolt } from '$bolt';
	import { Button, Icon, SchemaEditor, Section, type Json } from '@norbital-ai/ui';
	import { Schema } from 'effect';
	import type { ComponentProps } from 'svelte';

	let {
		value,
		onChange,
		disabled = false
	}: {
		value: Json;
		onChange: (next: Json) => void;
		disabled?: boolean;
	} = $props();
	const t = bolt.t;

	const Rule = Schema.Struct({
		id: Schema.String,
		catalog: Schema.optional(Schema.String),
		target_collection: Schema.optional(Schema.String),
		events: Schema.Array(Schema.String),
		when: Schema.optional(Schema.String),
		fields: Schema.optional(Schema.Array(Schema.String)),
		reads: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
		effect: Schema.optional(Schema.String)
	});
	const Record_ = Schema.Struct({
		version: Schema.Number,
		rules: Schema.Array(Schema.Unknown)
	});
	type RuleRow = {
		readonly id: string;
		readonly catalog?: string;
		readonly target_collection?: string;
		readonly events: readonly string[];
		readonly when?: string;
		readonly fields?: readonly string[];
		readonly reads?: Readonly<Record<string, Json>>;
		readonly effect?: string;
	};
	const isRule = (value: unknown): value is RuleRow => Schema.is(Rule)(value);
	const jsonFrom = (unknown: unknown): Json => Schema.decodeUnknownSync(Schema.Json)(unknown);

	const kind = {
		kind: 'object',
		fields: {
			id: { kind: 'text' },
			catalog: { kind: 'text', optional: true },
			target_collection: { kind: 'text', optional: true },
			events: { kind: 'list', of: { kind: 'text' } },
			when: { kind: 'text', max: 2000, optional: true },
			fields: { kind: 'list', of: { kind: 'text' }, optional: true },
			reads: { kind: 'record', of: { kind: 'json' }, optional: true },
			effect: { kind: 'text', max: 2000, optional: true }
		}
	} as const satisfies ComponentProps<typeof SchemaEditor>['kind'];

	const record = $derived(Schema.is(Record_)(value) ? value : null);
	const version = $derived(record?.version ?? 1);
	const rules = $derived<readonly RuleRow[]>(record == null ? [] : record.rules.filter(isRule));
	const emit = (next: { version: number; rules: readonly RuleRow[] }) =>
		onChange(jsonFrom(Schema.encodeUnknownSync(Record_)(next)));
	const replace = (index: number, next: Json) => {
		if (!isRule(next)) return;
		emit({ version, rules: rules.map((rule, i) => (i === index ? next : rule)) });
	};
	const add = () =>
		emit({ version, rules: [...rules, { id: `rule-${rules.length + 1}`, events: [] }] });
	const remove = (index: number) => emit({ version, rules: rules.filter((_, i) => i !== index) });
</script>

{#if record == null}
	<p class="text-meta">{t('behaviours.unrecognized')}</p>
{:else}
	<SchemaEditor
		kind={{ kind: 'int' }}
		value={version}
		onChange={(next) => typeof next === 'number' && emit({ version: next, rules })}
		{disabled}
	/>
	{#each rules as rule, index (index)}
		<Section
			name="rule-{index}"
			title={rule.id === '' ? t('behaviours.untitled_rule') : rule.id}
			defaultOpen={false}
		>
			{#snippet actions()}
				<Button
					variant="ghost"
					size="icon"
					aria-label={t('behaviours.remove_rule')}
					title={t('behaviours.remove_rule')}
					{disabled}
					onclick={() => remove(index)}
				>
					<Icon name="lucide:trash-2" class="size-4" />
				</Button>
			{/snippet}
			<SchemaEditor
				{kind}
				value={jsonFrom(Schema.encodeUnknownSync(Rule)(rule))}
				onChange={(next) => replace(index, next)}
				{disabled}
			/>
		</Section>
	{/each}
	<Button variant="outline" size="sm" {disabled} onclick={add}>
		<Icon name="lucide:plus" class="size-4" />
		{t('behaviours.add_rule')}
	</Button>
{/if}
