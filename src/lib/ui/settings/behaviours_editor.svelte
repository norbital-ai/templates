<script lang="ts">
	/**
	 * The behaviours record as one accordion per rule: the rule's trigger, condition, reads and effect,
	 * conditions in the code editor (`format: 'cel'`). Rules add and remove; the record's format `version` is carried,
	 * never edited.
	 */
	import { bolt } from '$bolt';
	import { Button, Editor, Icon, type Json, type Kind } from '@norbital-ai/ui';
	import { Inline } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';

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
			when: { kind: 'text', format: 'cel', max: 2000, optional: true },
			fields: { kind: 'list', of: { kind: 'text' }, optional: true },
			reads: { kind: 'record', of: { kind: 'json' }, optional: true },
			effect: { kind: 'text', max: 2000, optional: true }
		}
	} as const satisfies Kind;

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
	let opened = $state<boolean[]>([]);
	const remove = (index: number) => {
		opened = opened.filter((_, i) => i !== index);
		emit({ version, rules: rules.filter((_, i) => i !== index) });
	};
</script>

{#if record == null}
	<p class="text-meta">{t('behaviours.unrecognized')}</p>
{:else}
	{#each rules as rule, index (index)}
		<!-- a rule's editors mount when it opens: eight closed rules held ~30 code editors measuring off-screen -->
		<details
			class="group border-t"
			ontoggle={(event) => (opened[index] = event.currentTarget.open)}
		>
			<summary class="cursor-pointer list-none py-2 select-none [&::-webkit-details-marker]:hidden">
				<Inline gap="sm" align="center" justify="between">
					<Inline gap="sm" align="center">
						<Icon
							name="lucide:chevron-right"
							class="size-4 text-muted-foreground transition-transform group-open:rotate-90"
						/>
						<span class="text-sm font-medium"
							>{rule.id === '' ? t('behaviours.untitled_rule') : rule.id}</span
						>
					</Inline>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t('behaviours.remove_rule')}
						title={t('behaviours.remove_rule')}
						{disabled}
						onclick={(event) => {
							event.preventDefault();
							remove(index);
						}}
					>
						<Icon name="lucide:trash-2" class="size-4" />
					</Button>
				</Inline>
			</summary>
			{#if opened[index]}
				<div class="pb-3">
					<Editor
						{kind}
						name="behaviours.rules.{index}"
						value={jsonFrom(Schema.encodeUnknownSync(Rule)(rule))}
						onChange={(next) => replace(index, next)}
						{disabled}
					/>
				</div>
			{/if}
		</details>
	{/each}
	<Button variant="outline" size="sm" {disabled} onclick={add}>
		<Icon name="lucide:plus" class="size-4" />
		{t('behaviours.add_rule')}
	</Button>
{/if}
