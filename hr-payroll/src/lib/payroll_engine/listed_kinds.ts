import { Option, Schema } from 'effect';
/** Named factual kind codes live in their governing settings' own lookup. */
const ListedKinds = Schema.Array(
	Schema.Struct({
		code: Schema.String.check(Schema.isMinLength(1)),
		name: Schema.optionalKey(Schema.String)
	})
);
export function kindsOf(value: unknown): readonly {
	readonly code: string;
	readonly name: string;
}[] {
	const decoded = Schema.decodeUnknownOption(ListedKinds)(value);
	return Option.isNone(decoded)
		? []
		: decoded.value.map(({ code, name }) => ({ code, name: name ?? code }));
}
