import { createStore } from './store.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** readline decodes Windows VT input; muted output hides password echo/redraw. */
function terminalPrompts() {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  output.isTTY = process.stdout.isTTY;
  output.columns = process.stdout.columns;
  const terminal = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  const question = (prompt, { hidden = false, maxLength = 256 } = {}) => {
  return new Promise((resolve, reject) => {
    function cancel() { cleanup(); reject(new Error('Configuração cancelada.')); }
    function end() { cleanup(); reject(new Error('Entrada encerrada.')); }
    function cleanup() { terminal.off('SIGINT', cancel); terminal.off('close', end); }
    terminal.once('SIGINT', cancel);
    terminal.once('close', end);
    muted = hidden;
    if (hidden) process.stdout.write(prompt);
    terminal.question(hidden ? '' : prompt, value => {
      cleanup();
      if (hidden) process.stdout.write('\n');
      if (value.length > maxLength) reject(new Error('Entrada excede o limite permitido.'));
      else resolve(value);
    });
  });
  };
  return { question, close() { terminal.close(); process.stdin.pause(); process.stdin.unref?.(); output.end(); } };
}

export async function configureUser(username, { root = ROOT } = {}) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Execute em um terminal interativo; a senha não deve ser passada na linha de comando.');
  }
  const prompts = terminalPrompts();
  try {
  username = username ?? (await prompts.question('Nome da conta do painel (mínimo 3 caracteres): ', { maxLength: 100 })).trim();
  if (!/^[A-Za-z0-9_.@-]{3,100}$/.test(username)) {
    throw new Error('Use de 3 a 100 letras, números, ponto, traço, sublinhado ou @.');
  }
  const password = await prompts.question('Senha (mínimo 12 caracteres; não aparece na tela): ', { hidden: true });
  const confirm = await prompts.question('Repita a senha: ', { hidden: true });
  if (password !== confirm) throw new Error('Senhas diferentes.');
  if (password.length < 12) throw new Error('A senha precisa de pelo menos 12 caracteres.');
  const defaults = {
    inventory: JSON.parse(readFileSync(path.join(root, 'data/example-inventory.json'), 'utf8')),
    maps: JSON.parse(readFileSync(path.join(root, 'data/default-maps.json'), 'utf8')),
  };
  const store = createStore({ storageDirectory: path.join(root, 'private'), defaults });
  try { store.createUser(username, password); }
  finally { store.close(); }
  console.log('Conta criada/atualizada. Reinicie o servidor para encerrar sessões anteriores.');
  } finally { prompts.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, username, ...remaining] = process.argv.slice(2);
  if (command !== 'create-user' || !username || remaining.length) {
    console.error('Uso: node scripts/admin.mjs create-user USUARIO');
    process.exitCode = 1;
  } else {
    try { await configureUser(username); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
  // Windows ConPTY can retain a console handle after readline closes.
  // All database writes are synchronous and closed; flush diagnostics first.
  await Promise.all([
    new Promise(resolve => process.stdout.write('', resolve)),
    new Promise(resolve => process.stderr.write('', resolve)),
  ]);
  process.exit(process.exitCode ?? 0);
}
