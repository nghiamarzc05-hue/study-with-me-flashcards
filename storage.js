// storage.js (v2.2)
// Model thẻ: word / ipa / meaning / example / tag
// Tương thích ngược từ bản cũ (front/back/hint).

const STORAGE_KEY = "swm_flashcards_v22";
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
  return { version: 22, decks: [], activeDeckId: null };
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

      // Backward-compat
      if ("front" in c && !("word" in c)) c.word = c.front;
      if ("back" in c && !("meaning" in c)) c.meaning = c.back;
      if ("hint" in c && !("example" in c)) c.example = c.hint;

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

  s.version = 22;
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
  const deck = {
    id: uid("deck"),
    name: "English A1 (mẫu)",
    description: "Deck mẫu: có IPA + ví dụ. TTS chỉ đọc từ (English).",
    tags: ["english","vocab"],
    pinned: true,
    createdAt: Date.now(),
    cards: [
      { id: uid("card"), word: "book", ipa: "/bʊk/", meaning: "quyển sách", example: "I read a book.", tag: "noun", createdAt: Date.now() },
      { id: uid("card"), word: "apple", ipa: "/ˈæp.əl/", meaning: "quả táo", example: "I eat an apple every day.", tag: "noun", createdAt: Date.now() },
      { id: uid("card"), word: "thank you", ipa: "/ˈθæŋk juː/", meaning: "cảm ơn", example: "Thank you for your help.", tag: "phrase", createdAt: Date.now() }
    ],
  };
  s.decks.push(deck);
  s.activeDeckId = deck.id;

  saveState(s);
  return s;
}

/* =====================
   Backup / Restore
   ===================== */
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

/* =====================
   CSV export helpers
   ===================== */
export function deckToCsv(deck){
  const header = ["word","ipa","meaning","example","tag"];
  const lines = [header.join(",")];

  for (const c of deck.cards){
    const row = [
      csvEscape(c.word ?? ""),
      csvEscape(c.ipa ?? ""),
      csvEscape(c.meaning ?? ""),
      csvEscape(c.example ?? ""),
      csvEscape(c.tag ?? "")
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function csvEscape(s){
  const v = String(s ?? "");
  if (/[",\n\r]/.test(v)){
    return '"' + v.replaceAll('"', '""') + '"';
  }
  return v;
}

/* =====================
   CSV parse (quotes basic)
   ===================== */
export function parseCsv(text){
  const rows = [];
  let i = 0;
  const s = String(text || "");

  function readCell(){
    let cell = "";
    if (s[i] === '"'){
      i++;
      while (i < s.length){
        if (s[i] === '"'){
          if (s[i+1] === '"'){ cell += '"'; i += 2; continue; }
          i++;
          break;
        }
        cell += s[i++];
      }
      while (s[i] === " " || s[i] === "\t") i++;
      return cell;
    }else{
      while (i < s.length && s[i] !== "," && s[i] !== "\n" && s[i] !== "\r"){
        cell += s[i++];
      }
      return cell.trim();
    }
  }

  while (i < s.length){
    while (i < s.length && (s[i] === "\r" || s[i] === "\n")) i++;
    if (i >= s.length) break;

    const row = [];
    while (i < s.length){
      row.push(readCell());
      if (s[i] === ","){ i++; continue; }
      if (s[i] === "\r"){ i++; if (s[i] === "\n") i++; break; }
      if (s[i] === "\n"){ i++; break; }
      if (i >= s.length) break;
    }
    if (row.length) rows.push(row);
  }

  return rows;
}

export function importCardsFromCsv(deck, csvText){
  const rows = parseCsv(csvText);
  if (!rows.length) return { added: 0, skipped: 0 };

  const first = rows[0].map(x => (x || "").toLowerCase());
  const hasHeader =
    first.includes("word") || first.includes("meaning") || first.includes("ipa") || first.includes("example");

  const start = hasHeader ? 1 : 0;
  let added = 0;
  let skipped = 0;

  for (let r = start; r < rows.length; r++){
    const cols = rows[r];
    const word = (cols[0] ?? "").trim();
    const ipa = (cols[1] ?? "").trim();
    const meaning = (cols[2] ?? "").trim();
    const example = (cols[3] ?? "").trim();
    const tag = normalizeTag((cols[4] ?? "").trim());

    if (!word || !meaning){ skipped++; continue; }

    deck.cards.push({
      id: uid("card"),
      word, ipa, meaning, example, tag,
      createdAt: Date.now(),
    });
    added++;
  }

  return { added, skipped };
}
