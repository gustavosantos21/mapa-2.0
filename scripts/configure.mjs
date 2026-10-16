import { configureUser } from './admin.mjs';

try { await configureUser(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
await Promise.all([
  new Promise(resolve => process.stdout.write('', resolve)),
  new Promise(resolve => process.stderr.write('', resolve)),
]);
process.exit(process.exitCode ?? 0);
