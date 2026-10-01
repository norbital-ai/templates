<script lang="ts">
	/**
	 * A subject's recorded facts, edited against the declarations its caller names: a company's
	 * `facts`, a departure's `exit_facts`, terms' `terms_facts`, a day's `work_day_facts`, a
	 * payment's `payment_facts`. The one renderer is `lib/ui/declared-facts-field.svelte`.
	 */
	import type { FactKey } from '../../../lib/datatypes/fact_keys.js';
	import type { CustomFieldView } from '@norbital-ai/ui';
	import type { ValueOf } from '@norbital-ai/bolt';
	import DeclaredFactsField from '../../../lib/ui/declared-facts-field.svelte';
	import type f from './+definition.ts';

	type Value = ValueOf<typeof f.spec.shape>;

	let { view, declarations }: { view: CustomFieldView<Value>; declarations: readonly FactKey[] } =
		$props();
</script>

<DeclaredFactsField {view} settingsCode={null} {declarations} />
