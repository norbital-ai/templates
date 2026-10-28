<script lang="ts">
	/**
	 * A rule set: its identity, its family data, and its provenance (hash and source identity) kept closed. Read, the
	 * data shows as fields and tables — a keyed lookup (every value an object) is a table led by its key — and only
	 * the keys the engine evaluates show as expressions.
	 */
	import { bolt } from '$bolt';
	import {
		Form,
		openRecord,
		RecordShell,
		StructuredData,
		type Json,
		type Kind,
		type RecordView
	} from '@norbital-ai/ui';
	import { Schema } from 'effect';
	import * as Predicate from 'effect/Predicate';
	import { isJsonList, isJsonRecord } from '../../../lib/ui/records/json_object.js';
	import CatalogSections from '../../../lib/ui/settings/catalog_sections.svelte';

	let { view }: { view: RecordView<'rule_set'> } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const values = $derived(view.mode === 'create' ? view.values : {});
	const t = bolt.t;

	/** Keys whose text is an expression the engine evaluates, across the rule-set families. */
	const EXPRESSIONS = new Set([
		'when',
		'applies_when',
		'due',
		'amount',
		'occurrence',
		'repeat_key',
		'each',
		'file',
		'value'
	]);
	type JsonRecord = { readonly [key: string]: Json };
	// the form's field value is the kit's untyped `Value`: the stored rules are decoded as JSON once
	const isJson = Schema.is(Schema.Json);
	const mapValues = (object: JsonRecord, f: (value: Json) => Json): JsonRecord =>
		Object.fromEntries(Object.entries(object).map(([key, held]) => [key, f(held)]));
	const rowsOf = (value: Json): Json => {
		if (isJsonList(value)) return value.map(rowsOf);
		if (!isJsonRecord(value)) return value;
		const entries = Object.entries(value);
		const lookup = entries.length > 0 && entries.every(([, held]) => isJsonRecord(held));
		if (!lookup) return mapValues(value, rowsOf);
		const code = t('component.code');
		return entries.map(([key, held]) => ({
			[code]: key,
			...(isJsonRecord(held) ? mapValues(held, rowsOf) : {})
		}));
	};
	const fieldsOf = (rows: readonly JsonRecord[]): Record<string, Kind> => {
		const fields: Record<string, Kind> = {};
		for (const row of rows)
			for (const [key, held] of Object.entries(row))
				if (fields[key] === undefined || held !== null) fields[key] = kindOf(held, key);
		return fields;
	};
	const kindOf = (value: Json, key = ''): Kind => {
		if (Predicate.isString(value))
			return EXPRESSIONS.has(key) ? { kind: 'text', format: 'cel' } : { kind: 'text' };
		if (Predicate.isNumber(value)) return { kind: 'number' };
		if (Predicate.isBoolean(value)) return { kind: 'bool' };
		if (isJsonList(value)) {
			const rows = value.filter(isJsonRecord);
			if (rows.length > 0 && rows.length === value.length)
				return { kind: 'list', of: { kind: 'object', fields: fieldsOf(rows) } };
			return {
				kind: 'list',
				of: value[0] === undefined ? { kind: 'text' } : kindOf(value[0], key)
			};
		}
		if (isJsonRecord(value)) return { kind: 'object', fields: fieldsOf([value]) };
		return { kind: 'text' };
	};
</script>

<RecordShell
	of="rule_set"
	mode={view.mode}
	{...record == null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
>
	{#key record?.revision}
		<Form
			of="rule_set"
			mode={view.mode === 'create' ? 'create' : 'update'}
			{...record ? { id: record.id } : {}}
			{record}
			{values}
			onOutcome={(outcome) => {
				if (outcome.kind !== 'committed' || record) return;
				const created = outcome.records.find((row) => row.model === 'rule_set');
				if (created) openRecord('rule_set', created.id);
			}}
		>
			{#snippet children()}
				{#snippet rules({ value, id }: { value: unknown; id: string })}
					{@const data = isJson(value) ? rowsOf(value) : null}
					<StructuredData
						mode="view"
						kind={data === null ? { kind: 'json' } : kindOf(data)}
						value={data}
						{id}
					/>
				{/snippet}
				<CatalogSections
					views={{ rules }}
					sections={[
						{
							name: 'identity',
							title: t('section.identity'),
							fields: ['family', 'code', 'name', 'references']
						},
						{ name: 'rules', title: t('section.rules'), fields: ['rules'] },
						{
							name: 'technical',
							title: t('section.technical'),
							defaultOpen: false,
							fields: ['content_hash', 'source_identity']
						}
					]}
				/>
			{/snippet}
		</Form>
	{/key}
</RecordShell>
