import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.flock');
const TOKEN_FILE = join(CONFIG_DIR, 'token');
const SERVER_FILE = join(CONFIG_DIR, 'server');
const IDENTITY_FILE = join(CONFIG_DIR, 'identity.json');

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function saveToken(token: string): void {
  ensureDir();
  writeFileSync(TOKEN_FILE, token, { encoding: 'utf-8', mode: 0o600 });
}

export function loadToken(): string {
  try {
    return readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    throw new Error('No token found. Run `flock register` first.');
  }
}

export function saveServer(url: string): void {
  ensureDir();
  writeFileSync(SERVER_FILE, url.replace(/\/$/, ''), 'utf-8');
}

export function loadServer(): string {
  try {
    return readFileSync(SERVER_FILE, 'utf-8').trim();
  } catch {
    return 'http://localhost:3001';
  }
}

export interface Identity {
  id: string;
  name: string;
  token: string;
}

export function saveIdentity(identity: Identity): void {
  ensureDir();
  writeFileSync(IDENTITY_FILE, JSON.stringify(identity, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

export function loadIdentity(): Identity | null {
  try {
    const raw = readFileSync(IDENTITY_FILE, 'utf-8').trim();
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}
