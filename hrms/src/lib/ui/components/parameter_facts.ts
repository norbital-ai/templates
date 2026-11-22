import { enum_text, is_json_schema, json_schema_kind, type Kind } from '@norbital-ai/ui';
import { isJsonObject } from '../../foundation.js';

/** The statutory parameters a law declares (`employee_statutory_parameters`, `entity_statutory_parameters`), by name. */
export const declaredParameters = (
	schema: unknown
): Readonly<Record<string, { readonly label: string; readonly kind: Kind }>> =>
	Object.fromEntries(
		Object.entries(
			isJsonObject(schema) && isJsonObject(schema.properties) ? schema.properties : {}
		).map(([name, property]) => [
			name,
			{
				label:
					isJsonObject(property) && typeof property.title === 'string'
						? property.title
						: enum_text(name),
				kind: is_json_schema(property) ? json_schema_kind(property) : { kind: 'text' }
			}
		])
	);
