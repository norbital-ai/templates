import { model } from '@norbital-ai/bolt';
import { STATUTORY_FIELDS } from '../../lib/payroll_engine/statutory_fields.js';

export default model({
	description:
		'One version of a jurisdiction settings lineage: general payroll data, owning its regulatory rule sets, family catalogues and schemes. Holidays belong to the entity that observes them. Sealed versions of one code never overlap; a sealed version and all its children are immutable and can only be voided.',
	icon: 'lucide:globe',
	label: 'name',
	fields: STATUTORY_FIELDS.settings
});
