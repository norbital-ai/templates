import { model } from '@norbital-ai/bolt';
import { STEPS_FIELD } from '../../../lib/outreach.js';

/**
 * The owner's outreach template: ordered steps (`day_offset` from enrolment, email or call, subject, body). Subject and
 * body use `{{first_name}}`, `{{company}}`, `{{potential_projects}}` (the company's kept projects as bullets) and
 * `{{sender_name}}`. Every member of a cohort gets the same sequence; only the substitutions differ. The workspace is the one
 * place it is authored: `launch_cohort` pushes the steps to the cohort's Apollo sequence.
 */
export default model('sequences', {
	description: 'An outreach template: ordered email and call steps with lead variables.',
	icon: 'lucide:list-ordered',
	record_label: 'record.name',
	fields: { name: { kind: 'text' }, steps: STEPS_FIELD },
	outputs: { default: { fields: 'all' } },
	create: { fields: ['name', 'steps'] },
	update: { fields: ['name', 'steps'] },
	delete: {}
});
