// Installs the pre-commit secret check (tools/check-secrets.ts) into .git/hooks. Run once per clone:
// node tools/install-hooks.ts
import { writeFileSync } from 'node:fs';

writeFileSync('.git/hooks/pre-commit', '#!/bin/sh\nexec node tools/check-secrets.ts\n', { mode: 0o755 });
console.log('Installed .git/hooks/pre-commit');
