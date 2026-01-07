// app.js (v2.3) - Chủ đề dạng card grid + modal (SmartVocabPro vibe)
import {
  seedIfEmpty,
  saveState,
  migrateState,
  parseTagsCsv,
  normalizeTag,
  loadTheme,
  saveTheme,
  exportJson,
  restoreMerge,
  restoreOverwrite,
  deckToCsv,
} from "./storage.js";

import { createTts, initTtsUI, speakText, stopSpeak } from "./tts.js";

let state = seedIfEmpty();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function downloadText(filename, content, mime="text/plain;charset=utf-8"){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getActiveDeck(){
  return state.decks.find(d => d.id === state.activeDeckId) ?? null;
}
function getDeckById(id){
  return state.decks.find(d => d.id === id) ?? null;
}

// ---------- theme ----------
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  $("#themeToggleTop").textContent = theme === "light" ? "☀️ Light" : "🌙 Dark";
}
function initTheme(){
  applyTheme(loadTheme());
  $("#themeToggleTop").addEventListener("click", toggleTheme);
  $("#themeToggleSettings").addEventListener("click", toggleTheme);
}
function toggleTheme(){
  const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const next = cur === "light" ? "dark" : "light";
  saveTheme(next);
  applyTheme(next);
}

// ---------- tabs ----------
const tabs = $$(".tab");
const panels = $$("[data-panel]");

function showTab(name){
  if (name !== "study"){
    stopAutoplay();
    stopPomo();
    stopSpeak(tts);
  }
  tabs.forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  panels.forEach(p => p.classList.toggle("hidden", p.dataset.panel !== name));
  if (name === "study") renderStudy();
}
tabs.forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

// ---------- elements (decks) ----------
const deckGrid = $("#deckGrid");

const deckSearch = $("#deckSearch");
const tagFilter = $("#tagFilter");
const sortSelect = $("#sortSelect");
const btnClearFilter = $("#btnClearFilter");

const dlgDeck = $("#dlgDeck");
const newDeckName = $("#newDeckName");
const newDeckTags = $("#newDeckTags");

const dlgDeckDetail = $("#dlgDeckDetail");
const deckName = $("#deckName");
const deckDesc = $("#deckDesc");
const deckTags = $("#deckTags");
const btnTogglePin = $("#btnTogglePin");

const cardList = $("#cardList");
const cardSearch = $("#cardSearch");

const dlgCard = $("#dlgCard");
const dlgCardTitle = $("#dlgCardTitle");
const cardWord = $("#cardWord");
const cardIpa = $("#cardIpa");
const cardMeaning = $("#cardMeaning");
const cardExample = $("#cardExample");
const cardTag = $("#cardTag");
const editingCardId = $("#editingCardId");

// settings
const btnExportJson = $("#btnExportJson");
const jsonFileInput = $("#jsonFileInput");
const backupMsg = $("#backupMsg");
const btnResetAll = $("#btnResetAll");
const dlgRestore = $("#dlgRestore");

// ---------- filters/sort ----------
let deckFilters = { q: "", tag: "" };

function getAllDeckTags(){
  const set = new Set();
  for (const d of state.decks){
    for (const t of (Array.isArray(d.tags) ? d.tags : [])){
      const nt = normalizeTag(t);
      if (nt) set.add(nt);
    }
  }
  return Array.from(set).sort();
}

function renderTagFilterOptions(){
  const current = tagFilter.value || "";
  const tags = getAllDeckTags();
  tagFilter.innerHTML = `<option value="">Tất cả tag</option>`;
  for (const t of tags){
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    tagFilter.appendChild(opt);
  }
  tagFilter.value = tags.includes(current) ? current : "";
  deckFilters.tag = tagFilter.value;
}

function applyDeckSort(decks){
  const mode = sortSelect.value || "pinned_newest";
  const pinnedFirst = (a,b) => (b.pinned?1:0) - (a.pinned?1:0);

  if (mode === "pinned_az"){
    decks.sort((a,b) => {
      const p = pinnedFirst(a,b);
      if (p) return p;
      return String(a.name).localeCompare(String(b.name), "vi", { sensitivity:"base" });
    });
  } else if (mode === "pinned_cards"){
    decks.sort((a,b) => {
      const p = pinnedFirst(a,b);
      if (p) return p;
      return (b.cards?.length||0) - (a.cards?.length||0);
    });
  } else {
    decks.sort((a,b) => {
      const p = pinnedFirst(a,b);
      if (p) return p;
      return (b.createdAt||0) - (a.createdAt||0);
    });
  }
  return decks;
}

deckSearch?.addEventListener("input", () => {
  deckFilters.q = deckSearch.value.trim().toLowerCase();
  renderDeckGrid();
});
tagFilter?.addEventListener("change", () => {
  deckFilters.tag = tagFilter.value;
  renderDeckGrid();
});
sortSelect?.addEventListener("change", () => renderDeckGrid());
btnClearFilter?.addEventListener("click", () => {
  deckFilters.q = "";
  deckFilters.tag = "";
  deckSearch.value = "";
  tagFilter.value = "";
  renderDeckGrid();
});

// ---------- decks CRUD ----------
$("#btnNewDeck").addEventListener("click", () => {
  newDeckName.value = "";
  newDeckTags.value = "";
  dlgDeck.showModal();
});

$("#btnCreateDeckConfirm").addEventListener("click", (e) => {
  if (!newDeckName.value.trim()){
    e.preventDefault();
    alert("Tên chủ đề trống. Đặt tên đi.");
  }
});

dlgDeck.addEventListener("close", () => {
  if (dlgDeck.returnValue !== "ok") return;
  const name = newDeckName.value.trim();
  const tags = parseTagsCsv(newDeckTags.value);

  const deck = {
    id: crypto.randomUUID ? crypto.randomUUID() : `deck_${Date.now()}`,
    name,
    description: "",
    tags,
    pinned: false,
    createdAt: Date.now(),
    cards: [],
  };
  state.decks.unshift(deck);
  state.activeDeckId = deck.id;
  saveAndRender();
  openDeckDetail(deck.id);
});

function openDeckDetail(deckId){
  state.activeDeckId = deckId;
  saveState(migrateState(state));
  renderDeckDetail();
  dlgDeckDetail.showModal();
}

$("#btnSaveDeck").addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;

  const name = deckName.value.trim();
  if (!name) return alert("Tên chủ đề trống. Sửa lại.");
  deck.name = name;
  deck.description = deckDesc.value.trim();
  deck.tags = parseTagsCsv(deckTags.value);

  saveAndRenderDeckDetail();
  renderDeckGrid();
});

btnTogglePin.addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;
  deck.pinned = !deck.pinned;
  saveAndRenderDeckDetail();
  renderDeckGrid();
});

$("#btnDeleteDeck").addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;
  const ok = confirm(`Xóa chủ đề "${deck.name}"? Xóa là mất luôn.`);
  if (!ok) return;

  state.decks = state.decks.filter(d => d.id !== deck.id);
  state.activeDeckId = state.decks[0]?.id ?? null;
  saveAndRender();
  dlgDeckDetail.close();
});

$("#btnStudyThisDeck").addEventListener("click", () => {
  dlgDeckDetail.close();
  showTab("study");
});

$("#btnExportDeckCsv").addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;
  const csv = deckToCsv(deck);
  const safeName = deck.name.replaceAll(/[^a-zA-Z0-9_\- ]/g, "_").slice(0,50).trim() || "deck";
  downloadText(`${safeName}.csv`, csv, "text/csv;charset=utf-8");
});

// ---------- deck grid render ----------
function renderDeckGrid(){
  renderTagFilterOptions();

  deckGrid.innerHTML = "";
  if (!state.decks.length){
    deckGrid.innerHTML = `<div class="muted">Chưa có chủ đề nào. Tạo chủ đề mới đi.</div>`;
    return;
  }

  let decks = state.decks.slice();

  if (deckFilters.q){
    const q = deckFilters.q;
    decks = decks.filter(d => {
      const name = (d.name||"").toLowerCase();
      const desc = (d.description||"").toLowerCase();
      const tags = (Array.isArray(d.tags) ? d.tags : []).map(normalizeTag).join(" ");
      return name.includes(q) || desc.includes(q) || tags.includes(q);
    });
  }

  if (deckFilters.tag){
    const t = deckFilters.tag;
    decks = decks.filter(d => (Array.isArray(d.tags) ? d.tags.map(normalizeTag) : []).includes(t));
  }

  applyDeckSort(decks);

  for (const d of decks){
    const el = document.createElement("div");
    el.className = "deck-card";

    const tags = (Array.isArray(d.tags) ? d.tags : []).map(normalizeTag).filter(Boolean);
    const show = tags.slice(0,2);
    const more = Math.max(0, tags.length - show.length);
    const tagsHtml = show.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")
      + (more ? `<span class="tag">+${more}</span>` : "");

    el.innerHTML = `
      <div class="deck-card-top">
        <div>
          <div class="deck-title">${escapeHtml(d.name)} ${d.pinned ? "⭐" : ""}</div>
          <div class="deck-meta">${(d.cards?.length||0)} thẻ • ${(d.description||"").trim() ? escapeHtml(d.description).slice(0,60) : "—"}</div>
        </div>
        <button class="icon-btn" type="button" data-act="pin" aria-label="Ghim">${d.pinned ? "⭐" : "☆"}</button>
      </div>
      <div class="deck-tags">${tagsHtml}</div>
      <div class="deck-actions">
        <button class="btn secondary" type="button" data-act="open">Mở</button>
        <button class="btn" type="button" data-act="study">Học ngay</button>
      </div>
    `;

    el.querySelector('[data-act="pin"]').addEventListener("click", (e) => {
      e.stopPropagation();
      d.pinned = !d.pinned;
      saveAndRender();
      renderDeckGrid();
    });

    el.addEventListener("click", () => openDeckDetail(d.id));

    el.querySelector('[data-act="open"]').addEventListener("click", (e) => {
      e.stopPropagation();
      openDeckDetail(d.id);
    });

    el.querySelector('[data-act="study"]').addEventListener("click", (e) => {
      e.stopPropagation();
      state.activeDeckId = d.id;
      saveState(state);
      showTab("study");
    });

    deckGrid.appendChild(el);
  }
}

// ---------- cards CRUD (inside modal) ----------
$("#btnNewCard").addEventListener("click", () => {
  if (!getActiveDeck()) return alert("Chọn chủ đề trước.");
  openCardDialog("add");
});

$("#btnSaveCardConfirm").addEventListener("click", (e) => {
  if (!cardWord.value.trim() || !cardMeaning.value.trim()){
    e.preventDefault();
    alert("Từ hoặc nghĩa trống. Điền đủ.");
  }
});

dlgCard.addEventListener("close", () => {
  if (dlgCard.returnValue !== "ok") return;
  const deck = getActiveDeck();
  if (!deck) return;

  const word = cardWord.value.trim();
  const ipa = cardIpa.value.trim();
  const meaning = cardMeaning.value.trim();
  const example = cardExample.value.trim();
  const tag = normalizeTag(cardTag.value.trim());
  const id = editingCardId.value;

  if (!id){
    deck.cards.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `card_${Date.now()}`,
      word, ipa, meaning, example, tag,
      createdAt: Date.now(),
    });
  }else{
    const c = deck.cards.find(x => x.id === id);
    if (c){
      c.word = word;
      c.ipa = ipa;
      c.meaning = meaning;
      c.example = example;
      c.tag = tag;
    }
  }

  saveAndRenderDeckDetail();
  renderDeckGrid();
});

cardSearch.addEventListener("input", () => renderDeckDetail());

function openCardDialog(mode, card){
  editingCardId.value = "";
  if (mode === "add"){
    dlgCardTitle.textContent = "Thêm thẻ";
    cardWord.value = "";
    cardIpa.value = "";
    cardMeaning.value = "";
    cardExample.value = "";
    cardTag.value = "";
  } else {
    dlgCardTitle.textContent = "Sửa thẻ";
    editingCardId.value = card.id;
    cardWord.value = card.word ?? "";
    cardIpa.value = card.ipa ?? "";
    cardMeaning.value = card.meaning ?? "";
    cardExample.value = card.example ?? "";
    cardTag.value = card.tag ?? "";
  }
  dlgCard.showModal();
}

// ---------- deck detail render (modal) ----------
function renderDeckDetail(){
  const deck = getActiveDeck();
  if (!deck) return;

  deckName.value = deck.name;
  deckDesc.value = deck.description || "";
  deckTags.value = (deck.tags || []).join(", ");
  btnTogglePin.textContent = deck.pinned ? "⭐ Bỏ ghim" : "⭐ Ghim";

  const q = cardSearch.value.trim().toLowerCase();
  const cards = q
    ? (deck.cards||[]).filter(c => {
        const t = (c.tag||"").toLowerCase();
        const w = (c.word||"").toLowerCase();
        const ipa = (c.ipa||"").toLowerCase();
        const m = (c.meaning||"").toLowerCase();
        const ex = (c.example||"").toLowerCase();
        return w.includes(q) || ipa.includes(q) || m.includes(q) || ex.includes(q) || t.includes(q);
      })
    : (deck.cards||[]);

  cardList.innerHTML = "";
  if (!cards.length){
    cardList.innerHTML = `<div class="muted">Chưa có thẻ. Bấm “Thêm thẻ”.</div>`;
    return;
  }

  for (const c of cards){
    const el = document.createElement("div");
    el.className = "item";
    const tag = c.tag ? `<span class="tag">${escapeHtml(c.tag)}</span>` : "";
    const ipa = c.ipa ? `<div class="item-sub">${escapeHtml(c.ipa)}</div>` : "";
    const example = c.example ? `<div class="item-sub"><span class="muted small">VD:</span> ${escapeHtml(c.example)}</div>` : "";

    el.innerHTML = `
      <div class="item-title">${escapeHtml(c.word)}</div>
      ${ipa}
      <div class="item-sub">${escapeHtml(c.meaning)}</div>
      ${example}
      <div class="tags">${tag}</div>
      <div class="item-actions">
        <button class="chip" data-act="edit">Sửa</button>
        <button class="chip" data-act="del">Xóa</button>
      </div>
    `;

    el.querySelector('[data-act="edit"]').addEventListener("click", () => openCardDialog("edit", c));
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      const ok = confirm("Xóa thẻ này? Xóa là mất luôn.");
      if (!ok) return;
      const deck2 = getActiveDeck();
      deck2.cards = deck2.cards.filter(x => x.id !== c.id);
      saveAndRenderDeckDetail();
      renderDeckGrid();
    });

    cardList.appendChild(el);
  }
}

function saveAndRender(){
  state = migrateState(state);
  saveState(state);
  renderAll();
}
function saveAndRenderDeckDetail(){
  state = migrateState(state);
  saveState(state);
  renderDeckDetail();
}
function renderAll(){
  renderDeckGrid();
  if (backupMsg) backupMsg.textContent = "";
}

// ---------- Study (same as v2.2) ----------
let randomMode = false;

let study = { deckId: state.activeDeckId, order: [], idx: 0, flipped: false, showExample: false };

const studyDeckSelect = $("#studyDeckSelect");
const flashcard = $("#flashcard");
const flashFront = $("#flashFront");
const flashBack = $("#flashBack");
const studyMeta = $("#studyMeta");

function getStudyDeck(){ return getDeckById(study.deckId); }

function getCurrentCard(){
  const deck = getStudyDeck();
  if (!deck || !study.order.length) return null;
  const id = study.order[study.idx];
  return deck.cards.find(c => c.id === id) || null;
}

function speakWord(){
  const card = getCurrentCard();
  speakText(tts, card?.word || "");
}

function pickRandomIndex(){
  if (!study.order.length) return 0;
  if (study.order.length === 1) return 0;
  let next = Math.floor(Math.random() * study.order.length);
  if (next === study.idx) next = (next + 1) % study.order.length;
  return next;
}

function setupStudy(deckId, shuffle){
  study.deckId = deckId;
  const deck = getDeckById(deckId);
  const ids = (deck?.cards ?? []).map(c => c.id);
  if (!ids.length){
    study.order = [];
    study.idx = 0;
    study.flipped = false;
    study.showExample = false;
    return;
  }
  study.order = ids.slice();
  if (shuffle) fisherYates(study.order);
  study.idx = 0;
  study.flipped = false;
  study.showExample = false;
}

function fisherYates(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function renderStudy(){
  stopAutoplay();
  stopPomo();

  studyDeckSelect.innerHTML = "";
  for (const d of state.decks){
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.cards.length})`;
    studyDeckSelect.appendChild(opt);
  }

  const defaultId = state.activeDeckId ?? state.decks[0]?.id ?? "";
  studyDeckSelect.value = defaultId;

  setupStudy(defaultId, false);
  renderStudyCard();
}

function renderStudyCard(){
  const deck = getStudyDeck();
  const total = study.order.length;

  if (!deck || !total){
    studyMeta.textContent = "Deck trống. Thêm thẻ trước đã.";
    flashFront.textContent = "—";
    flashBack.textContent = "—";
    flashcard.classList.remove("is-flipped");
    return;
  }

  const card = getCurrentCard();
  studyMeta.textContent = `Deck: ${deck.name} • Thẻ: ${study.idx + 1}/${total}`;

  const ipa = card?.ipa?.trim();
  flashFront.innerHTML = `
    <div>
      <div class="word">${escapeHtml(card?.word ?? "—")}</div>
      ${ipa ? `<div class="ipa">${escapeHtml(ipa)}</div>` : ""}
    </div>
  `;

  const meaning = card?.meaning ?? "—";
  const example = card?.example?.trim() || "";
  const showEx = study.showExample && !!example;

  flashBack.innerHTML = `
    <div>
      <div class="meaning">${escapeHtml(meaning)}</div>
      ${showEx ? `<div class="example">${escapeHtml(example)}</div>` : ""}
      <div class="back-actions">
        ${example ? `<button class="btn secondary" type="button" id="btnToggleExample">${showEx ? "Ẩn ví dụ" : "Xem ví dụ"}</button>` : ""}
      </div>
    </div>
  `;

  const btnToggleExample = $("#btnToggleExample");
  if (btnToggleExample){
    btnToggleExample.addEventListener("click", (e) => {
      e.stopPropagation();
      study.showExample = !study.showExample;
      renderStudyCard();
    });
  }

  flashcard.classList.toggle("is-flipped", !!study.flipped);
}

function goPrev(opts = { speak: true }){
  if (!study.order.length) return;

  study.showExample = false;
  if (randomMode) study.idx = pickRandomIndex();
  else study.idx = (study.idx - 1 + study.order.length) % study.order.length;

  study.flipped = false;
  renderStudyCard();
  if (opts.speak) speakWord();
}
function goNext(opts = { speak: true }){
  if (!study.order.length) return;

  study.showExample = false;
  if (randomMode) study.idx = pickRandomIndex();
  else study.idx = (study.idx + 1) % study.order.length;

  study.flipped = false;
  renderStudyCard();
  if (opts.speak) speakWord();
}
function flipCard(){
  if (!study.order.length) return;
  study.flipped = !study.flipped;
  renderStudyCard();
}

$("#btnPrev").addEventListener("click", () => goPrev({ speak:true }));
$("#btnNext").addEventListener("click", () => goNext({ speak:true }));
$("#btnFlip").addEventListener("click", flipCard);
flashcard.addEventListener("click", flipCard);

$("#btnShuffle").addEventListener("click", () => {
  setupStudy(studyDeckSelect.value, true);
  renderStudyCard();
  speakWord();
});

$("#btnRandom").addEventListener("click", () => {
  randomMode = !randomMode;
  $("#btnRandom").textContent = randomMode ? "🎲 Random: ON" : "🎲 Random: OFF";
});

studyDeckSelect.addEventListener("change", () => {
  stopSpeak(tts);
  setupStudy(studyDeckSelect.value, false);
  renderStudyCard();
});

// Keyboard
window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const activePanel = panels.find(p => !p.classList.contains("hidden"))?.dataset.panel;
  if (activePanel !== "study") return;

  if (e.code === "Space"){ e.preventDefault(); flipCard(); }
  else if (e.code === "ArrowLeft"){ e.preventDefault(); goPrev({ speak:true }); }
  else if (e.code === "ArrowRight"){ e.preventDefault(); goNext({ speak:true }); }
  else if (e.code === "KeyR"){
    randomMode = !randomMode;
    $("#btnRandom").textContent = randomMode ? "🎲 Random: ON" : "🎲 Random: OFF";
  }
  else if (e.code === "KeyS"){ e.preventDefault(); speakWord(); }
});

// ---------- autoplay ----------
let autoplayTimer = null;
let autoplayMs = 3000;

const autoplaySpeed = $("#autoplaySpeed");
const btnAutoplay = $("#btnAutoplay");

if (autoplaySpeed){
  autoplayMs = Number(autoplaySpeed.value) || 3000;
  autoplaySpeed.addEventListener("change", () => {
    autoplayMs = Number(autoplaySpeed.value) || 3000;
    if (autoplayTimer) startAutoplay();
  });
}
btnAutoplay?.addEventListener("click", toggleAutoplay);

function stopAutoplay(){
  if (autoplayTimer) clearInterval(autoplayTimer);
  autoplayTimer = null;
  if (btnAutoplay) btnAutoplay.textContent = "▶ Auto";
}
function startAutoplay(){
  stopAutoplay();
  if (btnAutoplay) btnAutoplay.textContent = "⏸ Auto";
  autoplayTimer = setInterval(() => {
    goNext({ speak:false });
    speakWord();
  }, autoplayMs);
  speakWord();
}
function toggleAutoplay(){
  if (autoplayTimer) stopAutoplay();
  else startAutoplay();
}

// ---------- Pomodoro ----------
let pomoTimer = null;
let pomoMode = "work";
let workMin = 25;
let breakMin = 5;
let remainingSec = workMin * 60;

const pomoLabel = $("#pomoLabel");
const pomoTime = $("#pomoTime");
const btnPomoStart = $("#btnPomoStart");
const btnPomoReset = $("#btnPomoReset");
const pomoPreset = $("#pomoPreset");

function fmtTime(sec){
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function renderPomo(){
  pomoLabel.textContent = `Pomodoro: ${pomoMode === "work" ? "học" : "nghỉ"}`;
  pomoTime.textContent = fmtTime(remainingSec);
}
function stopPomo(){
  if (pomoTimer) clearInterval(pomoTimer);
  pomoTimer = null;
  btnPomoStart.textContent = "Start";
}
function startPomo(){
  if (pomoTimer) return;
  btnPomoStart.textContent = "Pause";
  pomoTimer = setInterval(() => {
    remainingSec--;
    if (remainingSec <= 0){
      pomoMode = (pomoMode === "work") ? "break" : "work";
      remainingSec = (pomoMode === "work" ? workMin : breakMin) * 60;
    }
    renderPomo();
  }, 1000);
}
function togglePomo(){ pomoTimer ? stopPomo() : startPomo(); }
function resetPomo(){
  stopPomo();
  pomoMode = "work";
  remainingSec = workMin * 60;
  renderPomo();
}
if (pomoPreset){
  const [w,b] = pomoPreset.value.split(",").map(Number);
  workMin = w; breakMin = b; remainingSec = workMin * 60;
  pomoPreset.addEventListener("change", () => {
    const [w2,b2] = pomoPreset.value.split(",").map(Number);
    workMin = w2; breakMin = b2;
    resetPomo();
  });
}
btnPomoStart.addEventListener("click", togglePomo);
btnPomoReset.addEventListener("click", resetPomo);
renderPomo();

// ---------- TTS ----------
const tts = createTts();
initTtsUI(tts, {
  btnSpeak: $("#btnSpeak"),
  voiceSelect: $("#voiceSelect"),
  rateSelect: $("#rateSelect"),
  onSpeakWord: () => speakWord(),
});

// ---------- Settings backup/restore ----------
btnExportJson.addEventListener("click", () => {
  const { filename, data } = exportJson(state);
  downloadText(filename, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  backupMsg.textContent = "Đã export JSON.";
});

let pendingImportJson = null;

jsonFileInput.addEventListener("change", async () => {
  const file = jsonFileInput.files?.[0];
  if (!file) return;

  try{
    const text = await file.text();
    pendingImportJson = JSON.parse(text);
  }catch{
    pendingImportJson = null;
    alert("File JSON không hợp lệ.");
    jsonFileInput.value = "";
    return;
  }

  dlgRestore.showModal();
});

dlgRestore.addEventListener("close", () => {
  jsonFileInput.value = "";
});

$("#btnRestoreOverwrite").addEventListener("click", (e) => {
  e.preventDefault();
  if (!pendingImportJson) return;
  const ok = confirm("Ghi đè sẽ xóa dữ liệu hiện tại. Chắc chưa?");
  if (!ok) return;

  state = restoreOverwrite(pendingImportJson);
  saveState(state);
  pendingImportJson = null;
  backupMsg.textContent = "Đã khôi phục (ghi đè).";
  dlgRestore.close();
  renderAll();
});

$("#btnRestoreMerge").addEventListener("click", (e) => {
  e.preventDefault();
  if (!pendingImportJson) return;

  state = restoreMerge(state, pendingImportJson);
  saveState(state);
  pendingImportJson = null;
  backupMsg.textContent = "Đã khôi phục (gộp).";
  dlgRestore.close();
  renderAll();
});

btnResetAll.addEventListener("click", () => {
  const ok = confirm("Reset sẽ xóa toàn bộ dữ liệu trên máy. Chắc chưa?");
  if (!ok) return;
  localStorage.clear();
  location.reload();
});

// ---------- init ----------
initTheme();
renderAll();
showTab("decks");
