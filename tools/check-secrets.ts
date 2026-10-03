// Pre-commit check: stops a commit if a staged file contains a private term (tools/redact.local.json)
// or something shaped like an API key, token or private key. Installed by tools/install-hooks.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const keyShapes = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/, // Anthropic / OpenAI style
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack
  /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
];
const rulesFile = 'tools/redact.local.json';
const blocked = existsSync(rulesFile)
  ? (JSON.parse(readFileSync(rulesFile, 'utf8')).block as string[]).map((p) => new RegExp(p, 'i'))
  : [];

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean);

const problems: string[] = [];
for (const file of staged) {
  if (file === 'package-lock.json') continue;
  const text = git('show', `:${file}`);
  if (text.includes('\0')) continue; // binary
  text.split('\n').forEach((line, i) => {
    for (const re of [...blocked, ...keyShapes]) {
      if (re.test(line)) problems.push(`${file}:${i + 1}  matches ${re.source.slice(0, 40)}`);
    }
  });
}

if (problems.length) {
  console.error('Commit stopped: these lines look private or secret:\n  ' + problems.join('\n  '));
  console.error('Remove them (or move the file to .gitignore). Only skip this check if you are sure: git commit --no-verify');
  process.exit(1);
}
