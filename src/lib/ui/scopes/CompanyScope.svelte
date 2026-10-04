<script lang="ts">
	import { bolt } from '$bolt';
	import { Combobox } from '@norbital-ai/ui';
	import type { CompanyScope } from './company-scope.svelte.js';

	/** The legal entity picker in an HR Controller page's header. */
	let { scope }: { scope: CompanyScope } = $props();
</script>

<Combobox
	class="w-56"
	size="sm"
	aria-label={bolt.t('component.legal_entity')}
	options={scope.entities.map((company) => ({ value: company.id, label: company.name }))}
	value={scope.id}
	disabled={scope.entities.length === 0}
	onChange={(next) => next != null && scope.select(next)}
/>
