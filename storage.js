// storage.js (v2.6) – seed dữ liệu từ data.js (PDF converted)
// Không còn Import CSV
import { SEED_DECKS } from "./data.js";

const STORAGE_KEY = "swm_flashcards_v26";
const THEME_KEY = "swm_theme_v1";

export function uid(prefix){
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeTag(t){
  return String(t || "").trim().toLowerCase();
}

export function parseTagsCsv(input){
  return String(input || "")
    .split(",")
    .map(s => normalizeTag(s))
    .filter(Boolean);
}

export function loadTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" ? "light" : "dark";
}

export function saveTheme(theme){
  localStorage.setItem(THEME_KEY, theme === "light" ? "light" : "dark");
}

export function emptyState(){
  return { version: 26, decks: [], activeDeckId: null };
}

export function migrateState(state){
  const s = state && typeof state === "object" ? state : emptyState();
  if (!Array.isArray(s.decks)) s.decks = [];
  if (!("activeDeckId" in s)) s.activeDeckId = null;

  for (const d of s.decks){
    if (!d.id) d.id = uid("deck");
    if (!d.name) d.name = "Untitled";
    if (!("description" in d)) d.description = "";
    if (!("createdAt" in d)) d.createdAt = Date.now();
    if (!Array.isArray(d.cards)) d.cards = [];
    if (!Array.isArray(d.tags)) d.tags = [];
    d.tags = d.tags.map(normalizeTag).filter(Boolean);
    if (!("pinned" in d)) d.pinned = false;

    for (const c of d.cards){
      if (!c.id) c.id = uid("card");
      if (!("word" in c)) c.word = "";
      if (!("ipa" in c)) c.ipa = "";
      if (!("meaning" in c)) c.meaning = "";
      if (!("example" in c)) c.example = "";
      if (!("tag" in c)) c.tag = "";
      if (!("createdAt" in c)) c.createdAt = Date.now();

      c.word = String(c.word || "").trim();
      c.ipa = String(c.ipa || "").trim();
      c.meaning = String(c.meaning || "").trim();
      c.example = String(c.example || "").trim();
      c.tag = normalizeTag(c.tag);
    }
  }

  if (s.decks.length && !s.activeDeckId) s.activeDeckId = s.decks[0].id;
  if (s.activeDeckId && !s.decks.some(d => d.id === s.activeDeckId)){
    s.activeDeckId = s.decks[0]?.id ?? null;
  }

  s.version = 26;
  return s;
}

export function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw));
  }catch{
    return null;
  }
}

export function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrateState(state)));
}

export function seedIfEmpty(){
  let s = loadState();
  if (s && s.decks.length) return s;

  s = emptyState();
  const now = Date.now();

  const decks = structuredClone(SEED_DECKS);
  for (const d of decks){
    if (!d.createdAt) d.createdAt = now;
    for (const c of d.cards){
      if (!c.createdAt) c.createdAt = now;
    }
  }

  s.decks = decks;
  s.activeDeckId = s.decks[0]?.id ?? null;
  saveState(s);
  return s;
}

/* Backup / Restore */
export function exportJson(state){
  const data = migrateState(structuredClone(state));
  const filename = `study_with_me_backup_${new Date().toISOString().slice(0,10)}.json`;
  return { filename, data };
}

function reIdDeck(deck){
  deck.id = uid("deck");
  for (const c of deck.cards) c.id = uid("card");
}

export function restoreOverwrite(imported){
  return migrateState(imported);
}

export function restoreMerge(current, imported){
  const cur = migrateState(structuredClone(current));
  const inc = migrateState(structuredClone(imported));

  const curIds = new Set(cur.decks.map(d => d.id));
  for (const d of inc.decks){
    if (curIds.has(d.id)) reIdDeck(d);
    curIds.add(d.id);
    cur.decks.push(d);
  }

  if (!cur.activeDeckId && cur.decks.length) cur.activeDeckId = cur.decks[0].id;
  return migrateState(cur);
}
