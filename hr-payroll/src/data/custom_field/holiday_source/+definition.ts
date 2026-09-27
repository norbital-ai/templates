import { customField } from '@norbital-ai/bolt';

const f = customField({
	description:
		'The Google Calendar source and IANA time zone used to prepare annual holiday drafts for one payroll jurisdiction. Credentials belong to the managed connection.',
	shape: {
		kind: 'object',
		fields: {
			calendar_id: { kind: 'text' },
			time_zone: { kind: 'text' },
			enabled: { kind: 'bool' }
		}
	}
});
export default f;
f.validate(({ calendar_id, time_zone }) => {
	if (calendar_id === '' || calendar_id !== calendar_id.trim())
		return 'Enter a Google calendar identifier without surrounding whitespace.';
	try {
		if (time_zone.trim() === '' || /^[+-]/.test(time_zone)) throw new RangeError(time_zone);
		new Intl.DateTimeFormat('en', { timeZone: time_zone });
		return undefined;
	} catch {
		return 'Enter a valid IANA time zone for this jurisdiction, not a fixed UTC offset.';
	}
});
