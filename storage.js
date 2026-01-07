// storage.js
// v2.6 – seed dữ liệu từ data.js (PDF converted)
// Không còn Import CSV

import { SEED_DECKS } from "./data.js";

const STORAGE_KEY = "swm_flashcards_v26";

/* =========================
   THEME
========================= */
export function loadTheme() {
  return localStorage.getItem("swm_theme") || "light";
}

export function saveTheme(theme) {
  localStorage.setItem("swm_theme", theme);
}

/* =========================
   STATE
========================= */
export function seedIfEmpty() {
  let state = loadState();

  if (!state || !Array.isArray(state.decks) || state.decks.length === 0) {
    state = {
      decks: structuredClone(SEED_DECKS),
      activeDeckId: SEED_DECKS[0]?.id || null,
    };
    saveState(state);
  }

  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("loadState error:", e);
    return null;
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function migrateState(state) {
  if (!state.decks) state.decks = [];
  return state;
}

/* =========================
   TAG HELPERS
========================= */
export function parseTagsCsv(text = "") {
  return text
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);
}

export function normalizeTag(tag = "") {
  return tag.toLowerCase().trim();
}

/* =========================
   BACKUP / RESTORE
========================= */
export function exportJson(state) {
  return {
    filename: `study-with-me-backup-${Date.now()}.json`,
    data: state,
  };
}

export function restoreOverwrite(data) {
  if (!data || !Array.isArray(data.decks)) {
    throw new Error("Invalid backup file");
  }
  saveState(data);
  return data;
}

export function restoreMerge(current, incoming) {
  if (!incoming || !Array.isArray(incoming.decks)) return current;

  const map = new Map(current.decks.map(d => [d.id, d]));

  for (const d of incoming.decks) {
    if (!map.has(d.id)) {
      map.set(d.id, d);
    }
  }

  const merged = {
    decks: Array.from(map.values()),
    activeDeckId: current.activeDeckId || merged?.decks?.[0]?.id || null,
  };

  saveState(merged);
  return merged;
}
