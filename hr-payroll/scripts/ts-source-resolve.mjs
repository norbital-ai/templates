/**
 * Let `node --experimental-strip-types` follow the source graph.
 *
 * Every module in `src/` imports its neighbours as `./thing.js`, which is what the emitted build
 * resolves to and what TypeScript requires under NodeNext. Node's type stripping compiles a `.ts`
 * file in place but does not rewrite those specifiers, so a test that imports any module with
 * relative runtime imports fails to resolve before a single assertion runs.
 *
 * This hook rewrites a relative `.js` specifier to its `.ts` sibling only when the `.js` file does
 * not exist and the `.ts` one does — so a real emitted file, a dependency and a package specifier
 * are all left exactly as they were.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const exists = (url) => {
	if (url.protocol !== 'file:') return false;
	return existsSync(fileURLToPath(url));
};

/** The `.ts` sibling a relative `.js` specifier should resolve to, or `null` to leave it alone. */
const sourceSibling = (specifier, parentURL) => {
	if (parentURL == null || !specifier.endsWith('.js')) return null;
	if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
	if (exists(new URL(specifier, parentURL))) return null;
	const candidate = `${specifier.slice(0, -3)}.ts`;
	return exists(new URL(candidate, parentURL)) ? candidate : null;
};

registerHooks({
	resolve(specifier, context, nextResolve) {
		return nextResolve(sourceSibling(specifier, context.parentURL) ?? specifier, context);
	}
});
