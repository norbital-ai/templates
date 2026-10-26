import { label, type Kind, type ViewBolt } from '@norbital-ai/ui';

/** The words of a key without a catalog entry: `untimed_credit_day_types` → `Untimed credit day types`. */
const words = (key: string) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * A json shape named from the catalog at every depth: `models.<collection>.fields.<path>` labels a nested field
 * (`payroll.attendance.step_hours`) and `<path>.help` replaces its declared help. `Show` and the structure editors
 * read a nested field's words only from its kind.
 */
export function labelled(
	bolt: Pick<ViewBolt, 't'>,
	collection: string,
	path: string,
	kind: Kind
): Kind {
	const helpKey = `models.${collection}.fields.${path}.help`;
	const help = bolt.t(helpKey);
	const own = {
		...kind,
		label: label(bolt, collection, path, words(path.slice(path.lastIndexOf('.') + 1))),
		...(help === helpKey ? {} : { help })
	};
	if (own.kind === 'object')
		return {
			...own,
			fields: Object.fromEntries(
				Object.entries(own.fields).map(([f, k]) => [
					f,
					labelled(bolt, collection, `${path}.${f}`, k)
				])
			)
		};
	if (own.kind === 'list') return { ...own, of: labelled(bolt, collection, path, own.of) };
	if (own.kind === 'json' && own.shape !== undefined)
		return { ...own, shape: labelled(bolt, collection, path, own.shape) };
	return own;
}

/**
 * A list of objects whose expressions edit and show as plain text, so the list stays a table (a code editor is a
 * whole-row field, and one whole-row column turns the table into stacked cards). The text is a textarea cell.
 */
export function tabled(kind: Kind): Kind {
	if (kind.kind !== 'list' || kind.of.kind !== 'object') return kind;
	const fields = Object.fromEntries(
		Object.entries(kind.of.fields).map(([f, k]): [string, Kind] => [
			f,
			k.kind === 'text' && k.format === 'cel'
				? {
						kind: 'text',
						max: 100_000,
						...(k.optional ? { optional: true as const } : {}),
						...(k.label === undefined ? {} : { label: k.label })
					}
				: k
		])
	);
	return { ...kind, of: { ...kind.of, fields } };
}
