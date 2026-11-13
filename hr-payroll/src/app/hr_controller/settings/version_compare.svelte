<script lang="ts">
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { Combobox, EmptyState, StructuredData } from '@norbital-ai/ui';
	import { Schema } from 'effect';
	import { JsonObject } from '../../../lib/payroll_engine/contracts.js';
	import { jsonValues } from '../../../lib/payroll_engine/foundation.js';
	import { newest_first } from '../../../lib/ui/scopes/settings_scope.js';
	import { COMPARED, comparableVersion } from '../../../lib/payroll_engine/version_compare.js';
	import { jurisdictionOptions, jurisdictionVersions } from './jurisdiction_scope.svelte.js';

	type Versions = NonNullable<
		ReturnType<typeof jurisdictionVersions>['current']
	>['jurisdiction_settings']['rows'];
	let {
		ctx,
		versions,
		current
	}: { ctx: PageContext; versions: Versions; current: Id<'jurisdiction_settings'> } = $props();

	const lineage = $derived(
		newest_first(
			versions.filter(
				(row) => row.code === versions.find((version) => version.id === current)?.code
			)
		)
	);
	let chosenFrom = $state<Id<'jurisdiction_settings'> | null>(null);
	let chosenTo = $state<Id<'jurisdiction_settings'> | null>(null);
	const inLineage = (id: Id<'jurisdiction_settings'> | null) =>
		lineage.some((row) => row.id === id) ? id : null;
	const to = $derived(inLineage(chosenTo) ?? current);
	const from = $derived(
		inLineage(chosenFrom) ??
			lineage
				.slice(lineage.findIndex((row) => row.id === to) + 1)
				.find((row) => row.status !== 'VOID')?.id ??
			null
	);

	const read = (id: Id<'jurisdiction_settings'>) => {
		const owned = { where: { settings_id: { eq: id } }, limit: 10000 };
		return ctx.query({
			jurisdiction_settings: { where: { id: { eq: id } }, limit: 1 },
			subtotal: owned,
			allowance_catalog: owned,
			overtime_catalog: owned,
			statutory_contribution_catalog: owned,
			leave_catalog: owned,
			claim_catalog: owned,
			adhoc_catalog: owned,
			loan_catalog: owned,
			workplace_case_catalog: owned,
			registered_rule: owned,
			registered_effect: owned
		});
	};
	const before = $derived(from === null ? null : read(from));
	const after = $derived(read(to));
	const document = (answer: ReturnType<typeof read>['current'] | undefined) => {
		if (answer == null) return undefined;
		const rows = Object.fromEntries(
			COMPARED.map((family) => [
				family,
				Schema.decodeUnknownSync(Schema.Array(JsonObject))(jsonValues(answer[family].rows))
			])
		);
		const settings = Schema.decodeUnknownSync(JsonObject)(
			jsonValues(answer.jurisdiction_settings.rows[0] ?? {})
		);
		return comparableVersion(settings, rows);
	};
	const beforeDocument = $derived(document(before?.current));
	const afterDocument = $derived(document(after.current));
	const options = $derived(jurisdictionOptions(ctx, lineage));
</script>

<Stack gap="sm">
	<Cluster gap="sm">
		<Combobox
			aria-label={ctx.t('settings_version.compare_from')}
			class="w-72"
			{options}
			value={from}
			on_change={(next) => (chosenFrom = next)}
		/>
		<Combobox
			aria-label={ctx.t('settings_version.compare_to')}
			class="w-72"
			{options}
			value={to}
			on_change={(next) => (chosenTo = next)}
		/>
	</Cluster>
	{#if from === null}<EmptyState title={ctx.t('settings_version.compare_empty')} />
	{:else if beforeDocument !== undefined && afterDocument !== undefined}<StructuredData
			{ctx}
			id="settings-version-compare"
			mode="diff"
			kind={{ kind: 'json' }}
			before={beforeDocument}
			value={afterDocument}
			changes_only
			name={ctx.t('settings_version.compare')}
		/>{/if}
</Stack>
