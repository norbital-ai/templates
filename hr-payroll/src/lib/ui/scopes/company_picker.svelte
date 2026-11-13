<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Combobox } from '@norbital-ai/ui';
	import type { CompanyScope } from './company_scope.svelte.js';

	/** The legal entity picker in an HR Controller page's header. */
	let { ctx, scope }: { ctx: PageContext; scope: CompanyScope } = $props();
</script>

<Combobox
	class="w-56"
	aria-label={ctx.t('component.legal_entity')}
	options={scope.entities.map((company) => ({ value: company.id, label: company.name }))}
	value={scope.id}
	disabled={scope.entities.length === 0}
	on_change={(next) => next != null && scope.select(next)}
/>
