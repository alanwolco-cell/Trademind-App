// Perfil de Chromium dedicado para Yahoo Fantasy.
// Aislado del Chrome real de Wolco a proposito: nunca se apunta al perfil personal.
import { chromium } from 'playwright';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const PROFILE_DIR = join(homedir(), '.macdraft', 'yahoo-profile');

export async function openContext({ headless = false } = {}) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
  });
}

// Yahoo NO redirige a login: sirve una portada publica. Verificado 25-ago-2026.
// Señal real: sin sesion sale "Sign in" y cero links a ligas (/f1/<id>).
export function leerLigas(html) {
  return [...new Set([...html.matchAll(/\/f1\/(\d+)/g)].map(m => m[1]))];
}

export async function isLoggedIn(page) {
  await page.goto('https://football.fantasysports.yahoo.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  const html = await page.content();
  return leerLigas(html).length > 0 || !/Sign in|Iniciar sesi/i.test(html);
}
