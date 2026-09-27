import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'The entity’s recorded facts, keyed by the names the settings version declares: sector, overtime consent, establishment tests.',
	shape: {
		kind: 'record',
		of: { kind: 'union', of: [{ kind: 'bool' }, { kind: 'number' }, { kind: 'text' }] }
	}
});
export default f;
f.validate((facts) =>
	Object.values(facts).every((value) => ['boolean', 'number', 'string'].includes(typeof value))
		? undefined
		: 'An entity fact is a boolean, a number or text.'
);
