<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet } from '@norbital-ai/ui';
	import CompanyScope from '../scopes/company_picker.svelte';
	import type { CompanyScope as CompanyScopeState } from '../scopes/company_scope.svelte.js';

	/** Shared company-scoped layout and create sheet for HR controller event pages. */
	let {
		ctx,
		scope,
		title,
		description,
		icon,
		creating = $bindable(false),
		createOf,
		createTitle,
		children,
		create
	}: {
		ctx: PageContext;
		scope: CompanyScopeState;
		title: string;
		description: string;
		icon: string;
		creating?: boolean;
		createOf?: 'adhoc_catalog_entry' | 'loan_catalog_entry' | 'workplace_case_catalog_entry';
		createTitle?: string;
		children: Snippet<[Id<'entity'>]>;
		create?: Snippet<[Id<'entity'>]>;
	} = $props();
</script>

<AppShell {title} {description} {icon}>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={ctx.t('app.events.empty_scope')} />
	{:else}{@render children(scope.id)}{/if}
</AppShell>
{#if creating && scope.id !== null}
	{#if create !== undefined}{@render create(scope.id)}
	{:else if createOf !== undefined}<Sheet
			open
			on_open_change={(open) => !open && (creating = false)}
			title={createTitle ?? title}
			><RecordShell
				{ctx}
				of={createOf}
				mode="create"
				values={{ entity_id: scope.id }}
				on_done={() => (creating = false)}
			/></Sheet
		>{/if}
{/if}
