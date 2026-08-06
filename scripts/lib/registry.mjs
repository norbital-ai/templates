/**
 * The scoped registry a template resolves `@norbital-ai/*` from.
 *
 * A template pins published versions and never links a workspace copy, so resolution here is the
 * same resolution a tenant sandbox performs. `NORBITAL_PACKAGE_REGISTRY` overrides it for a local
 * mirror or a rehearsal registry.
 */
export const defaultRegistry = 'https://npm.pkg.github.com';

/** Scope-to-registry mapping, plus credentials only when a token is present in the environment. */
export function registryConfiguration({ withCredentials = true } = {}) {
	const registry = (process.env.NORBITAL_PACKAGE_REGISTRY ?? defaultRegistry).trim();
	const lines = [`@norbital-ai:registry=${registry}`];
	const token = withCredentials ? process.env.NODE_AUTH_TOKEN?.trim() : undefined;
	if (token) lines.push(`//${new URL(registry).host}/:_authToken=${token}`);
	return `${lines.join('\n')}\n`;
}
