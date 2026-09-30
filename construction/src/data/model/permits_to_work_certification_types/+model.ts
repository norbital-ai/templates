import { model } from '@norbital-ai/bolt';

/** A join row: both sides are relationships (`src/data/+relationship.ts`); its name is theirs, set by the transform. */
export default model({
	description: 'Join table linking permits to work to certification types.',
	label: 'name',
	fields: {
		/** `<permit> · <certification>`, derived on every write (and by `seed/seed.ts`): a label is never a foreign key. */
		name: { kind: 'text', optional: true }
	}
});
