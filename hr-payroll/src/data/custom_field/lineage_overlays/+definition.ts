import { customField } from '@norbital-ai/bolt';
import { compileEligibility } from '../../../lib/payroll/run/eligibility.js';

const f = customField({
	description:
		'The locality overlays a settings version routes to: on a day a person expression over the worksite holds (`worksite.region in [...]`), the named lineage’s version in force replaces the listed work-rule parts, its leave rows by code and its tables by name. Schemes stay with this version.',
	shape: {
		kind: 'list',
		of: {
			kind: 'object',
			fields: {
				/** The overlay's own settings lineage (`jurisdiction_settings.code`). */
				lineage: { kind: 'text' },
				/** A person expression judged per day; true routes the day to the overlay. */
				when: { kind: 'text' },
				/** The top-level `work_rules` keys the overlay replaces. */
				work_rules: { kind: 'list', of: { kind: 'text' } },
				authority: { kind: 'text' }
			}
		}
	}
});
export default f;

f.validate((overlays) => {
	const lineages = overlays.map((overlay) => overlay.lineage.trim());
	if (lineages.some((lineage) => lineage === '')) return 'An overlay names its lineage.';
	if (new Set(lineages).size !== lineages.length) return 'Each overlay lineage is declared once.';
	for (const overlay of overlays) {
		if (overlay.authority.trim() === '')
			return `${overlay.lineage}: an overlay names the authority that localises the law.`;
		if (overlay.when.trim() === '')
			return `${overlay.lineage}: an overlay states when it governs a day.`;
		const fault = compileEligibility(overlay.when);
		if (fault != null) return `${overlay.lineage} when: ${fault}`;
	}
	return undefined;
});
