// app.js (v2.6)
// - Seed dữ liệu từ PDF (data.js -> storage.js)
// - Chủ đề dạng grid
// - Học: chọn 1 hoặc nhiều chủ đề (Select all / chọn ghim / bỏ chọn)
// - TTS: chỉ đọc từ (word), ưu tiên giọng US nếu có

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
} from "./storage.js";

import { createTts, initTtsUI, speakText, stopSpeak } from "./tts.js";

let state = seedIfEmpty();
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmt(n){
  return new Intl.NumberFormat("vi-VN").format(n);
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getDeckById(id){ return state.decks.find(d => d.id === id) ?? null; }
function getActiveDeck(){ return getDeckById(state.activeDeckId) ?? null; }

function saveAndRender(){
  state = migrateState(state);
  saveState(state);
  renderDeckGrid();
}
function saveAndRenderDeckDetail(){
  state = migrateState(state);
  saveState(state);
  renderDeckDetail();
}

/* =========================
   THEME
   ========================= */
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  $("#themeToggleTop").textContent = theme === "light" ? "☀️ Light" : "🌙 Dark";
}
function toggleTheme(){
  const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const next = cur === "light" ? "dark" : "light";
  saveTheme(next);
  applyTheme(next);
}
function initTheme(){
  applyTheme(loadTheme());
  $("#themeToggleTop").addEventListener("click", toggleTheme);
  $("#themeToggleSettings").addEventListener("click", toggleTheme);
}

/* =========================
   TABS
   ========================= */
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
  if (name === "study") ensureStudyReady();
}
tabs.forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

/* =========================
   DECKS (GRID)
   ========================= */
const deckGrid = $("#deckGrid");
const deckSearch = $("#deckSearch");
const tagFilter = $("#tagFilter");
const sortSelect = $("#sortSelect");
const btnClearFilter = $("#btnClearFilter");

let deckFilters = { q: "", tag: "" };

function getAllDeckTags(){
  const set = new Set();
  for (const d of state.decks){
    for (const t of (Array.isArray(d.tags) ? d.tags : [])){
      const nt = normalizeTag(t);
      if (nt) set.add(nt);
    }
  }
  return Array.from(set).sort((a,b) => a.localeCompare(b, "vi", { sensitivity:"base" }));
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

function renderDeckGrid(){
  renderTagFilterOptions();
  deckGrid.innerHTML = "";

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

  if (!decks.length){
    deckGrid.innerHTML = `<div class="muted">Không có chủ đề phù hợp. Xóa lọc hoặc tạo chủ đề mới.</div>`;
    return;
  }

  for (const d of decks){
    const el = document.createElement("div");
    el.className = "deck-card";
    el.addEventListener("click", () => openDeckDetail(d.id));

    const cardCount = d.cards?.length || 0;

    const tags = (Array.isArray(d.tags) ? d.tags : [])
      .map(normalizeTag)
      .filter(Boolean);

    // Tag gọn: tối đa 2 + "+N"
    const tagChips = [];
    const maxTags = 2;
    for (let i=0;i<Math.min(tags.length, maxTags);i++){
      tagChips.push(`<span class="tag">${escapeHtml(tags[i])}</span>`);
    }
    if (tags.length > maxTags){
      tagChips.push(`<span class="tag">+${tags.length - maxTags}</span>`);
    }

    el.innerHTML = `
      <div class="deck-card-top">
        <div>
          <div class="deck-title">${escapeHtml(d.name)}</div>
          <div class="deck-meta">${d.pinned ? "⭐ Đã ghim • " : ""}${fmt(cardCount)} thẻ</div>
        </div>

        <div class="deck-actions" onclick="event.stopPropagation()">
          <button class="icon-btn" title="Ghim / bỏ ghim" data-action="pin">${d.pinned ? "⭐" : "☆"}</button>
          <button class="icon-btn" title="Học chủ đề này" data-action="study">▶</button>
        </div>
      </div>

      <div class="muted small">${escapeHtml(d.description || "")}</div>
      <div class="deck-tags">${tagChips.join("")}</div>
    `;

    el.querySelector('[data-action="pin"]').addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      d.pinned = !d.pinned;
      saveAndRender();
    });

    el.querySelector('[data-action="study"]').addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      selectedDeckIds = [d.id];
      showTab("study");
    });

    deckGrid.appendChild(el);
  }
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

/* =========================
   DECK DETAIL + CARDS CRUD
   ========================= */
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
const editingCardId = $("#editingCardId");

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

function renderDeckDetail(){
  const deck = getActiveDeck();
  if (!deck) return;

  deckName.value = deck.name || "";
  deckDesc.value = deck.description || "";
  deckTags.value = (Array.isArray(deck.tags) ? deck.tags : []).join(", ");
  btnTogglePin.textContent = deck.pinned ? "⭐ Bỏ ghim" : "⭐ Ghim";

  renderCardList();
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
  selectedDeckIds = selectedDeckIds.filter(id => id !== deck.id);

  state.activeDeckId = state.decks[0]?.id ?? null;
  saveAndRender();
  dlgDeckDetail.close();
});

$("#btnNewCard").addEventListener("click", () => openCardDialog());

function openCardDialog(card){
  editingCardId.value = card?.id || "";
  dlgCardTitle.textContent = card ? "Sửa thẻ" : "Thêm thẻ";

  cardWord.value = card?.word || "";
  cardIpa.value = card?.ipa || "";
  cardMeaning.value = card?.meaning || "";
  cardExample.value = card?.example || "";

  dlgCard.showModal();
}

$("#btnSaveCardConfirm").addEventListener("click", (e) => {
  if (!cardWord.value.trim()){
    e.preventDefault();
    alert("Từ (word) trống. Nhập đi.");
  }
  if (!cardMeaning.value.trim()){
    // meaning bắt buộc (để học)
    e.preventDefault();
    alert("Nghĩa (meaning) trống. Nhập đi.");
  }
});

dlgCard.addEventListener("close", () => {
  if (dlgCard.returnValue !== "ok") return;
  const deck = getActiveDeck();
  if (!deck) return;

  const payload = {
    word: cardWord.value.trim(),
    ipa: cardIpa.value.trim(),
    meaning: cardMeaning.value.trim(),
    example: cardExample.value.trim(),
  };

  const id = editingCardId.value;
  if (id){
    const c = deck.cards.find(x => x.id === id);
    if (!c) return;
    Object.assign(c, payload);
  } else {
    deck.cards.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `card_${Date.now()}`,
      createdAt: Date.now(),
      tag: "",
      ...payload,
    });
  }

  saveAndRenderDeckDetail();
  renderDeckGrid();
});

cardSearch.addEventListener("input", () => renderCardList());

function renderCardList(){
  const deck = getActiveDeck();
  if (!deck) return;
  const q = cardSearch.value.trim().toLowerCase();

  let cards = deck.cards.slice();
  if (q){
    cards = cards.filter(c => {
      const s = `${c.word||""} ${c.ipa||""} ${c.meaning||""} ${c.example||""}`.toLowerCase();
      return s.includes(q);
    });
  }

  if (!cards.length){
    cardList.innerHTML = `<div class="muted">Chưa có thẻ (hoặc lọc không ra). Thêm thẻ mới đi.</div>`;
    return;
  }

  cardList.innerHTML = "";
  for (const c of cards){
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="item-title">${escapeHtml(c.word || "")} ${c.ipa ? `<span class="muted">/ ${escapeHtml(c.ipa)} /</span>` : ""}</div>
      <div class="item-sub">${escapeHtml(c.meaning || "")}</div>
      ${c.example ? `<div class="item-sub">VD: ${escapeHtml(c.example)}</div>` : ""}

      <div class="item-actions">
        <button class="chip" data-act="edit">Sửa</button>
        <button class="chip" data-act="del">Xóa</button>
      </div>
    `;
    el.querySelector('[data-act="edit"]').addEventListener("click", () => openCardDialog(c));
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      const ok = confirm(`Xóa thẻ "${c.word}"?`);
      if (!ok) return;
      deck.cards = deck.cards.filter(x => x.id !== c.id);
      saveAndRenderDeckDetail();
      renderDeckGrid();
    });
    cardList.appendChild(el);
  }
}

$("#btnStudyThisDeck").addEventListener("click", () => {
  selectedDeckIds = [state.activeDeckId].filter(Boolean);
  dlgDeckDetail.close();
  showTab("study");
});

/* =========================
   STUDY
   ========================= */
const dlgPick = $("#dlgPick");
const pickSearch = $("#pickSearch");
const pickList = $("#pickList");
const pickMeta = $("#pickMeta");
const btnPickAll = $("#btnPickAll");
const btnPickNone = $("#btnPickNone");
const btnPickPinned = $("#btnPickPinned");
const btnPickStart = $("#btnPickStart");

const btnPickDecks = $("#btnPickDecks");
const studySelectionMeta = $("#studySelectionMeta");

const flashcardBtn = $("#flashcard");
const flashFront = $("#flashFront");
const flashBack = $("#flashBack");
const btnPrev = $("#btnPrev");
const btnNext = $("#btnNext");
const btnFlip = $("#btnFlip");
const btnRandom = $("#btnRandom");
const btnShuffle = $("#btnShuffle");
const btnAutoplay = $("#btnAutoplay");
const autoplaySpeed = $("#autoplaySpeed");
const studyMeta = $("#studyMeta");

let selectedDeckIds = [state.activeDeckId].filter(Boolean);
let studyQueue = [];        // array of { deckId, cardIndex }
let cursor = 0;
let isRandom = false;
let autoplayTimer = null;
let autoplayOn = false;

function buildStudyQueue(){
  const ids = selectedDeckIds.length ? selectedDeckIds : [state.activeDeckId].filter(Boolean);
  const items = [];
  for (const id of ids){
    const d = getDeckById(id);
    if (!d) continue;
    for (let i=0;i<(d.cards?.length||0);i++){
      items.push({ deckId: id, cardIndex: i });
    }
  }
  studyQueue = items;
  cursor = 0;
}

function shuffleQueue(){
  for (let i=studyQueue.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [studyQueue[i], studyQueue[j]] = [studyQueue[j], studyQueue[i]];
  }
  cursor = 0;
}

function getCurrentCard(){
  if (!studyQueue.length) return null;
  const it = studyQueue[Math.min(cursor, studyQueue.length-1)];
  const d = getDeckById(it.deckId);
  const c = d?.cards?.[it.cardIndex] ?? null;
  return { deck: d, card: c, idx: cursor, total: studyQueue.length };
}

function renderStudy(){
  const cur = getCurrentCard();
  if (!cur || !cur.card){
    flashFront.innerHTML = `<div class="muted">Bạn chưa chọn chủ đề hoặc chủ đề rỗng.</div>`;
    flashBack.innerHTML = "";
    studyMeta.textContent = "";
    studySelectionMeta.textContent = "";
    return;
  }

  const { deck, card, idx, total } = cur;

  studyMeta.textContent = `${idx+1}/${total} • ${deck?.name || ""}`;
  const deckCount = selectedDeckIds.length || 1;
  studySelectionMeta.textContent = `Đang chọn: ${deckCount} chủ đề • ${fmt(total)} thẻ`;

  const frontHtml = `
    <div>
      <div class="word">${escapeHtml(card.word || "")}</div>
      ${card.ipa ? `<div class="ipa">/${escapeHtml(card.ipa)}/</div>` : `<div class="ipa muted">/ IPA trống /</div>`}
    </div>
  `;

  const hasExample = !!(card.example || "").trim();
  const backHtml = `
    <div>
      <div class="meaning">${escapeHtml(card.meaning || "")}</div>
      <div class="back-actions">
        ${hasExample ? `<button class="btn secondary" id="btnShowExample" type="button">Xem ví dụ</button>` : `<span class="muted small">Không có ví dụ</span>`}
      </div>
      <div class="example" id="exampleBox" style="display:none;">${escapeHtml(card.example || "")}</div>
    </div>
  `;

  flashFront.innerHTML = frontHtml;
  flashBack.innerHTML = backHtml;

  const btnShow = $("#btnShowExample");
  if (btnShow){
    btnShow.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const box = $("#exampleBox");
      if (!box) return;
      box.style.display = box.style.display === "none" ? "block" : "none";
    });
  }
}

function flip(){
  flashcardBtn.classList.toggle("is-flipped");
}
function unflip(){
  flashcardBtn.classList.remove("is-flipped");
}

function next(){
  if (!studyQueue.length) return;
  if (isRandom){
    cursor = Math.floor(Math.random()*studyQueue.length);
  }else{
    cursor = Math.min(cursor+1, studyQueue.length-1);
  }
  unflip();
  renderStudy();
  // autoplay: đọc từ khi chuyển card
  if (autoplayOn) speakCurrentWord();
}

function prev(){
  if (!studyQueue.length) return;
  cursor = Math.max(cursor-1, 0);
  unflip();
  renderStudy();
}

btnPrev.addEventListener("click", prev);
btnNext.addEventListener("click", next);
btnFlip.addEventListener("click", flip);
flashcardBtn.addEventListener("click", flip);

btnRandom.addEventListener("click", () => {
  isRandom = !isRandom;
  btnRandom.textContent = isRandom ? "🎲 Random: ON" : "🎲 Random: OFF";
});

btnShuffle.addEventListener("click", () => {
  if (!studyQueue.length) return;
  shuffleQueue();
  unflip();
  renderStudy();
});

function stopAutoplay(){
  autoplayOn = false;
  if (autoplayTimer) clearInterval(autoplayTimer);
  autoplayTimer = null;
  btnAutoplay.textContent = "▶ Auto";
}
function startAutoplay(){
  stopAutoplay();
  autoplayOn = true;
  btnAutoplay.textContent = "⏸ Auto";
  speakCurrentWord();

  const ms = Number(autoplaySpeed.value) || 3000;
  autoplayTimer = setInterval(() => {
    // flip -> next
    if (!flashcardBtn.classList.contains("is-flipped")){
      flip();
    } else {
      next();
    }
  }, ms);
}
btnAutoplay.addEventListener("click", () => {
  if (autoplayOn) stopAutoplay();
  else startAutoplay();
});
autoplaySpeed.addEventListener("change", () => {
  if (autoplayOn) startAutoplay();
});

// Pick decks dialog
btnPickDecks.addEventListener("click", () => openPickDialog());
pickSearch.addEventListener("input", () => renderPickList());

btnPickAll.addEventListener("click", () => {
  selectedDeckIds = state.decks.map(d => d.id);
  renderPickList();
});
btnPickNone.addEventListener("click", () => {
  selectedDeckIds = [];
  renderPickList();
});
btnPickPinned.addEventListener("click", () => {
  selectedDeckIds = state.decks.filter(d => d.pinned).map(d => d.id);
  renderPickList();
});

function openPickDialog(){
  pickSearch.value = "";
  renderPickList();
  dlgPick.showModal();
}

function renderPickList(){
  const q = pickSearch.value.trim().toLowerCase();
  const rows = state.decks
    .filter(d => !q || `${d.name||""} ${(d.description||"")} ${(d.tags||[]).join(" ")}`.toLowerCase().includes(q))
    .sort((a,b) => (b.pinned?1:0)-(a.pinned?1:0) || String(a.name).localeCompare(String(b.name), "vi", { sensitivity:"base" }));

  pickList.innerHTML = "";
  let totalCards = 0;

  for (const d of rows){
    const checked = selectedDeckIds.includes(d.id);
    const count = d.cards?.length || 0;
    if (checked) totalCards += count;

    const el = document.createElement("div");
    el.className = "pick-row";
    el.innerHTML = `
      <label class="pick-left">
        <input type="checkbox" ${checked ? "checked" : ""} />
        <div>
          <div class="pick-name">${escapeHtml(d.name)}</div>
          <div class="pick-count">${d.pinned ? "⭐ " : ""}${fmt(count)} thẻ</div>
        </div>
      </label>
      <div class="muted small">${(d.tags||[]).slice(0,2).join(", ")}</div>
    `;
    el.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked){
        if (!selectedDeckIds.includes(d.id)) selectedDeckIds.push(d.id);
      }else{
        selectedDeckIds = selectedDeckIds.filter(id => id !== d.id);
      }
      renderPickList();
    });
    pickList.appendChild(el);
  }

  pickMeta.textContent = `Đã chọn: ${fmt(selectedDeckIds.length)} chủ đề • ${fmt(totalCards)} thẻ`;
}

dlgPick.addEventListener("close", () => {
  if (dlgPick.returnValue !== "ok") return;
  ensureStudyReady(true);
});

function ensureStudyReady(forceRebuild=false){
  const needRebuild = forceRebuild || !studyQueue.length;
  if (needRebuild){
    buildStudyQueue();
    if (!studyQueue.length){
      // fallback: chọn deck active nếu user bỏ chọn hết
      selectedDeckIds = [state.activeDeckId].filter(Boolean);
      buildStudyQueue();
    }
    renderStudy();
  }else{
    renderStudy();
  }
}

function onKeydown(e){
  if ($("#dlgPick")?.open || $("#dlgDeck")?.open || $("#dlgDeckDetail")?.open || $("#dlgCard")?.open || $("#dlgRestore")?.open) return;

  if (e.code === "Space"){
    e.preventDefault();
    flip();
  } else if (e.code === "ArrowRight"){
    e.preventDefault();
    next();
  } else if (e.code === "ArrowLeft"){
    e.preventDefault();
    prev();
  } else if (e.key?.toLowerCase() === "r"){
    isRandom = !isRandom;
    btnRandom.textContent = isRandom ? "🎲 Random: ON" : "🎲 Random: OFF";
  } else if (e.key?.toLowerCase() === "s"){
    speakCurrentWord();
  }
}
window.addEventListener("keydown", onKeydown);

/* =========================
   TTS
   ========================= */
const tts = createTts();
const voiceSelect = $("#voiceSelect");
const rateSelect = $("#rateSelect");
const btnSpeak = $("#btnSpeak");

function speakCurrentWord(){
  const cur = getCurrentCard();
  const word = cur?.card?.word || "";
  speakText(tts, word);
}

initTtsUI(tts, {
  btnSpeak,
  voiceSelect,
  rateSelect,
  onSpeakWord: speakCurrentWord,
});

/* =========================
   POMODORO
   ========================= */
const pomoLabel = $("#pomoLabel");
const pomoTime = $("#pomoTime");
const btnPomoStart = $("#btnPomoStart");
const btnPomoReset = $("#btnPomoReset");
const pomoPreset = $("#pomoPreset");

let pomoTimer = null;
let pomoMode = "focus"; // focus / break
let focusMin = 25;
let breakMin = 5;
let remainSec = focusMin * 60;
let running = false;

function parsePreset(){
  const [f,b] = (pomoPreset.value || "25,5").split(",").map(x => Number(x));
  focusMin = Number.isFinite(f) ? f : 25;
  breakMin = Number.isFinite(b) ? b : 5;
}
function setPomo(sec){
  remainSec = Math.max(0, sec);
  const mm = String(Math.floor(remainSec/60)).padStart(2,"0");
  const ss = String(remainSec%60).padStart(2,"0");
  pomoTime.textContent = `${mm}:${ss}`;
  pomoLabel.textContent = pomoMode === "focus" ? "Pomodoro: học" : "Pomodoro: nghỉ";
}
function tickPomo(){
  remainSec -= 1;
  setPomo(remainSec);
  if (remainSec <= 0){
    // switch mode
    pomoMode = pomoMode === "focus" ? "break" : "focus";
    const nextSec = (pomoMode === "focus" ? focusMin : breakMin) * 60;
    setPomo(nextSec);
  }
}
function startPomo(){
  parsePreset();
  if (pomoTimer) clearInterval(pomoTimer);
  running = true;
  btnPomoStart.textContent = "Pause";
  pomoTimer = setInterval(tickPomo, 1000);
}
function pausePomo(){
  running = false;
  btnPomoStart.textContent = "Start";
  if (pomoTimer) clearInterval(pomoTimer);
  pomoTimer = null;
}
function stopPomo(){
  pausePomo();
}
function resetPomo(){
  parsePreset();
  pomoMode = "focus";
  setPomo(focusMin*60);
}
btnPomoStart.addEventListener("click", () => {
  if (running) pausePomo();
  else startPomo();
});
btnPomoReset.addEventListener("click", resetPomo);
pomoPreset.addEventListener("change", resetPomo);

/* =========================
   SETTINGS: BACKUP / RESTORE
   ========================= */
const btnExportJson = $("#btnExportJson");
const jsonFileInput = $("#jsonFileInput");
const btnResetAll = $("#btnResetAll");
const backupMsg = $("#backupMsg");

const dlgRestore = $("#dlgRestore");
const btnRestoreOverwrite = $("#btnRestoreOverwrite");
const btnRestoreMerge = $("#btnRestoreMerge");

let pendingImported = null;

btnExportJson.addEventListener("click", () => {
  const { filename, data } = exportJson(state);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  backupMsg.textContent = "Đã export JSON.";
});

jsonFileInput.addEventListener("change", async () => {
  const file = jsonFileInput.files?.[0];
  if (!file) return;
  try{
    const text = await file.text();
    pendingImported = JSON.parse(text);
    dlgRestore.showModal();
  }catch{
    alert("File JSON lỗi / không đọc được.");
  }finally{
    jsonFileInput.value = "";
  }
});

btnRestoreOverwrite.addEventListener("click", () => {
  if (!pendingImported) return;
  state = restoreOverwrite(pendingImported);
  saveAndRender();
  pendingImported = null;
  dlgRestore.close();
  backupMsg.textContent = "Khôi phục xong (ghi đè).";
});

btnRestoreMerge.addEventListener("click", () => {
  if (!pendingImported) return;
  state = restoreMerge(state, pendingImported);
  saveAndRender();
  pendingImported = null;
  dlgRestore.close();
  backupMsg.textContent = "Khôi phục xong (gộp).";
});

btnResetAll.addEventListener("click", () => {
  const ok = confirm("Reset toàn bộ dữ liệu? Sẽ mất hết deck/thẻ trên máy.");
  if (!ok) return;
  localStorage.removeItem("swm_flashcards_v26");
  state = seedIfEmpty(); // sẽ seed lại từ PDF
  selectedDeckIds = [state.activeDeckId].filter(Boolean);
  buildStudyQueue();
  renderStudy();
  renderDeckGrid();
  backupMsg.textContent = "Đã reset và seed lại dữ liệu mặc định.";
});

/* =========================
   INIT
   ========================= */
function buildStudyQueue(){
  const ids = selectedDeckIds.length ? selectedDeckIds : [state.activeDeckId].filter(Boolean);
  const items = [];
  for (const id of ids){
    const d = getDeckById(id);
    if (!d) continue;
    for (let i=0;i<(d.cards?.length||0);i++){
      items.push({ deckId: id, cardIndex: i });
    }
  }
  studyQueue = items;
  cursor = 0;
}

initTheme();
renderDeckGrid();
resetPomo();

// Build initial study queue
buildStudyQueue();
renderStudy();
