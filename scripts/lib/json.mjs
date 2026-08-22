import { Result, Schema } from 'effect';

const jsonObject = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.JsonObject));
const jsonString = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.String));

/** Decode a local JSON configuration object at its filesystem boundary. */
export function decodeJsonObject(raw, label) {
	const decoded = jsonObject(raw);
	if (Result.isFailure(decoded)) throw new Error(`${label} must contain a JSON object.`);
	return decoded.success;
}

/** Decode a command's `--json` output that is itself a bare JSON string, e.g. an npm version query. */
export function decodeJsonString(raw, label) {
	const decoded = jsonString(raw);
	if (Result.isFailure(decoded)) throw new Error(`${label} must be a JSON string.`);
	return decoded.success;
}
