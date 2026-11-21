import { custom_field } from '@norbital-ai/bolt';

/**
 * Co-located spatial zones / storeys / grid axes owned by a project.
 */
export default custom_field({
	description: 'Project storeys, zones, elevations, and grid axes.',
	shape: {
		kind: 'object',
		many: true,
		fields: {
			code: { kind: 'text' },
			name: { kind: 'text' },
			elevation_m: { kind: 'number', optional: true },
			grid_axis: { kind: 'text', optional: true }
		}
	},
	validate: (value) => {
		const codes = new Set<string>();
		for (const zone of value) {
			const code = zone.code.trim();
			if (!code) return 'Every zone requires a code.';
			if (codes.has(code)) return `Duplicate zone code: ${code}`;
			codes.add(code);
		}
		return undefined;
	}
});
