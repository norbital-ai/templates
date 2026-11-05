import { customField } from '@norbital-ai/bolt';
import { REFERENCES_SHAPE } from '../../../lib/payroll_engine/references.js';

export default customField('references', {
	description:
		'The legal instruments a statutory row rests on: each its title, the article, section or schedule cited, a link to the official text, the official wording quoted and the day it took effect.',
	shape: REFERENCES_SHAPE,
	validate: (value) =>
		value.some((reference) => reference.title.trim() === '')
			? 'Every reference names its instrument.'
			: value.some((reference) => reference.url != null && !/^https?:\/\//i.test(reference.url))
				? 'A reference link is an http or https address.'
				: undefined
});
