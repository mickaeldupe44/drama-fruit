// La base de données et les fichiers du mode payant : Supabase, appelé en HTTP avec la clé « service_role » du serveur.
import { env } from './common.js';

const url = () => env('SUPABASE_URL').replace(/\/$/, '');
const service = () => env('SUPABASE_SERVICE_KEY');
const BUCKET = 'videos';

// Le mode payant s'allume tout seul quand les trois réglages Supabase sont présents. Sinon le site reste en mode test.
export const paid = () => Boolean(env('SUPABASE_URL') && env('SUPABASE_ANON_KEY') && env('SUPABASE_SERVICE_KEY'));

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(`${url()}${path}`, {
    method,
    headers: { apikey: service(), Authorization: `Bearer ${service()}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let d = null; try { d = text ? JSON.parse(text) : null; } catch { d = text; }
  if (!r.ok) { const e = new Error((d && (d.message || d.error_description || d.error || d.msg)) || `Supabase ${r.status}`); e.status = r.status; e.upstream = true; throw e; }
  return d;
}

// Le compte derrière un jeton de connexion du site, ou null si le jeton n'est pas (ou plus) valable.
export async function userFromToken(token) {
  const r = await fetch(`${url()}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.id ? { id: d.id, email: d.email || '' } : null;
}

const q = (filters) => Object.entries(filters).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
export const rpc = (fn, args) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
export const select = (table, filters) => call(`/rest/v1/${table}?${q(filters)}`);
export const insert = (table, row, prefer = 'return=representation') => call(`/rest/v1/${table}`, { method: 'POST', body: row, headers: { Prefer: prefer } });
export const update = (table, filters, patch) => call(`/rest/v1/${table}?${q(filters)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } });
export const remove = (table, filters) => call(`/rest/v1/${table}?${q(filters)}`, { method: 'DELETE' });
export async function count(table, filters) {
  const r = await fetch(`${url()}/rest/v1/${table}?${q({ select: 'id', ...filters })}`, { method: 'HEAD', headers: { apikey: service(), Authorization: `Bearer ${service()}`, Prefer: 'count=exact' } });
  return Number(String(r.headers.get('content-range') || '').split('/')[1]) || 0;
}

// Fichiers : une adresse pour déposer la vidéo montée depuis le navigateur, et une adresse temporaire pour la relire.
export async function uploadUrl(path) {
  const d = await call(`/storage/v1/object/upload/sign/${BUCKET}/${path}`, { method: 'POST', body: {}, headers: { 'x-upsert': 'true' } });
  return `${url()}/storage/v1${d.url}`;
}
export async function readUrl(path, seconds = 3600) {
  const d = await call(`/storage/v1/object/sign/${BUCKET}/${path}`, { method: 'POST', body: { expiresIn: seconds } });
  return `${url()}/storage/v1${d.signedURL || d.signedUrl}`;
}
