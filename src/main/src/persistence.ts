/**
 * Session persistence — survive an app restart with the *evolved* surface,
 * not just the original .fe. We snapshot SE's exact-state dump (same content
 * exportDmp produces) plus a little metadata to a sidecar JSON file.
 *
 * Best-effort: every function swallows its own errors. Persistence must never
 * break a simulation command or block startup.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { config } from "./config";

const STATE_FILE = join(config.stateDir, "last-session.json");

export interface SavedSession {
  fe_file:  string;
  energy:   number | null;
  area:     number | null;
  dmp:      string;          // SE exact-state dump (a reloadable datafile)
  saved_at: string;
}

export function saveSession(s: SavedSession): void {
  try {
    mkdirSync(config.stateDir, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch (e) {
    console.error("[persist] save failed:", e);
  }
}

export function loadSaved(): SavedSession | null {
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as SavedSession;
  } catch {
    return null;
  }
}

export function clearSaved(): void {
  try {
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  } catch { /* ignore */ }
}
