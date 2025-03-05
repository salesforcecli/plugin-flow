#!/usr/bin/env -S node --disable-warning=DEP0040
// eslint-disable-next-line node/shebang
async function main() {
  const { execute } = await import('@oclif/core');
  await execute({ dir: import.meta.url });
}

await main();
