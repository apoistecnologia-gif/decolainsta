/** Production configuration preflight. No remote calls, no secrets printed. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  // Node >=20.9: avoid a third-party dependency while validating the deployment.
  // Only fill variables not already set by the host's secret manager.
  const src = readFileSync(envPath, 'utf8');
  for (const line of src.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const problems = [];
const warnings = [];
const read = key => (process.env[key] || '').trim();
const placeholder = value => !value || /^(sua_|outra_|user$|password$|host$|secret$|changeme|example|seu-|test[-_]|dev[-_])/i.test(value) || /SEU-DOMINIO|MINIMO_32|EXAMPLE\.COM/i.test(value);

for (const field of ['AUTH_SECRET', 'ENCRYPTION_KEY', 'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET']) {
  const value = read(field);
  if (placeholder(value)) problems.push(`${field}: não configurada`);
}
for (const field of ['AUTH_SECRET', 'ENCRYPTION_KEY']) {
  const value = read(field);
  if (value && value.length < 32) problems.push(`${field}: requer ao menos 32 caracteres`);
}
if (read('AUTH_SECRET') && read('AUTH_SECRET') === read('ENCRYPTION_KEY')) problems.push('Use chaves diferentes para sessão e tokens');

try {
  const url = new URL(read('DATABASE_URL'));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || placeholder(url.hostname) || placeholder(url.username) || placeholder(url.password)) throw new Error('invalid');
} catch { problems.push('DATABASE_URL: informe uma conexão PostgreSQL real'); }

try {
  const url = new URL(read('INSTAGRAM_REDIRECT_URI'));
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.hostname.toLowerCase() === 'localhost' || url.pathname !== '/api/instagram/connect/callback' || url.search || url.hash || placeholder(url.hostname)) throw new Error('invalid');
} catch { problems.push('INSTAGRAM_REDIRECT_URI: configure HTTPS e o caminho /api/instagram/connect/callback'); }

const version = read('INSTAGRAM_API_VERSION') || 'v24.0';
if (!/^v\d{1,2}\.\d{1,2}$/.test(version)) problems.push('INSTAGRAM_API_VERSION: use formato v24.0');
if (read('NODE_ENV') !== 'production') warnings.push('NODE_ENV não está configurado como production');
if (!read('AUTH_URL')) warnings.push('AUTH_URL opcional não definido: confirme o domínio público do NextAuth no deploy');

console.log(`DecolaInsta — verificação local de configuração: ${problems.length ? 'PENDENTE' : 'VARIÁVEIS VÁLIDAS'}`);
for (const issue of problems) console.error(`- ${issue}`);
for (const notice of warnings) console.warn(`- Aviso: ${notice}`);
console.log('Esta análise não verifica conexão ao banco, OAuth, permissões Meta, DNS nem build.');
if (problems.length) process.exitCode = 1;
