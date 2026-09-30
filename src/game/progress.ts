// Player progress kept in this browser: creds and personal bests.
// Storage can be unavailable (private windows, blocked site data), so every access is guarded.

export interface Progress {
  creds: number;
  bestScore: number;
  runs: number;
}

const KEY = 'upshift.progress.v1';

export function loadProgress(): Progress {
  const fallback: Progress = { creds: 0, bestScore: 0, runs: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      creds: Number(p.creds) || 0,
      bestScore: Number(p.bestScore) || 0,
      runs: Number(p.runs) || 0,
    };
  } catch {
    return fallback;
  }
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Not persisted; the run still counts for this session.
  }
}
