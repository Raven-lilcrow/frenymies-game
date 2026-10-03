// Writes docs/GAME-PLAN.md: the public copy of GAME-PLAN.md with private details removed
// (server domain, VPS, other services on the box). The terms live in tools/redact.local.json,
// which is never committed. Run before committing plan changes: node tools/public-plan.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = JSON.parse(readFileSync(join(root, 'tools/redact.local.json'), 'utf8')) as {
  replace: [string, string][];
  block: string[];
};

let text = readFileSync(join(root, 'GAME-PLAN.md'), 'utf8');
for (const [pattern, replacement] of rules.replace) text = text.replace(new RegExp(pattern, 'gi'), replacement);

const header =
  '> Public copy of the game plan. Server addresses and hosting details are left out on purpose.\n\n';
text = text.replace(/^(# .*\n)/, `$1\n${header}`);

const leaks = rules.block.flatMap((p) => [...text.matchAll(new RegExp(p, 'gi'))].map((m) => m[0]));
if (leaks.length) {
  console.error(`Not written: private terms still in the plan: ${[...new Set(leaks)].join(', ')}`);
  console.error('Add a replace rule for them in tools/redact.local.json.');
  process.exit(1);
}

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs/GAME-PLAN.md'), text);
console.log('Wrote docs/GAME-PLAN.md');
