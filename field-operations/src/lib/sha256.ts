import { Effect, Encoding } from 'effect';
import * as Schema from 'effect/Schema';
class DigestUnavailable extends Schema.TaggedError<DigestUnavailable>()('DigestUnavailable', {
	message: Schema.String
}) {}
/** Bolt supplies WebCrypto's host digest to the guest without a facility crossing. */
export const sha256Text = (message: string) =>
	Effect.tryPromise({
		try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)),
		catch: (cause) => new DigestUnavailable({ message: String(cause) })
	}).pipe(Effect.map((bytes) => Encoding.encodeHex(new Uint8Array(bytes))));
