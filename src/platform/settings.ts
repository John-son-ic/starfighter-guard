/**
 * D03 — versioned settings persistence over an injected StorageLike. No window,
 * no localStorage, no DOM: a caller that has a browser passes window.localStorage.
 * Behaviour source: docs/CONTRACTS.md ("D03 / src/platform/settings.ts").
 */
import type { Settings, StorageLike } from '../shared/types.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../shared/config.ts';

/** The only settings format this module understands. */
const SETTINGS_VERSION = 1;

/** Accepted quality tiers. Anything else falls back to the field default. */
const QUALITY_VALUES: readonly Settings['quality'][] = Object.freeze(['low', 'medium']);

const VOLUME_MIN = 0;
const VOLUME_MAX = 1;
const SENSITIVITY_MIN = 0.2;
const SENSITIVITY_MAX = 3;

/** A finite number, or undefined for anything a defensive read should ignore. */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A usable number clamped into range; out-of-range values are clamped, not dropped. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = asFiniteNumber(value);
  if (numeric === undefined) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

/** Only exact string matches survive; no coercion, no case folding. */
function asQuality(value: unknown): Settings['quality'] {
  return QUALITY_VALUES.includes(value as Settings['quality']) ? (value as Settings['quality']) : DEFAULT_SETTINGS.quality;
}

/**
 * Builds a complete, fresh Settings from untrusted data. Every field is decided
 * here, so extra keys are dropped and DEFAULT_SETTINGS is never written through.
 */
function normalizeSettings(raw: unknown): Settings {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    version: SETTINGS_VERSION,
    volume: clampNumber(source.volume, VOLUME_MIN, VOLUME_MAX, DEFAULT_SETTINGS.volume),
    sensitivity: clampNumber(source.sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX, DEFAULT_SETTINGS.sensitivity),
    quality: asQuality(source.quality),
  };
}

/** A complete default copy. Never returns DEFAULT_SETTINGS itself. */
function defaultSettings(): Settings {
  return normalizeSettings(null);
}

function isSupportedVersion(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).version === SETTINGS_VERSION;
}

/**
 * Reads settings. Missing, unreadable, malformed or outdated data all yield a new
 * complete default object rather than a partial merge.
 */
export function loadSettings(storage: StorageLike): Settings {
  let stored: string | null;
  try {
    stored = storage.getItem(SETTINGS_KEY);
  } catch {
    return defaultSettings();
  }
  if (stored === null || stored === undefined) return defaultSettings();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return defaultSettings();
  }
  if (!isSupportedVersion(parsed)) return defaultSettings();
  return normalizeSettings(parsed);
}

/**
 * Persists the four agreed fields after runtime normalization (TS types are not a
 * runtime guarantee). Returns false when the storage rejects the write.
 */
export function saveSettings(storage: StorageLike, value: Settings): boolean {
  const normalized = normalizeSettings(value);
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}
