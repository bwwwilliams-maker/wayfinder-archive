'use strict';

(() => {
  const STORAGE_SAVED_KEY = 'wayfinder.savedStops.v1';
  const STORAGE_MODULES_KEY = 'wayfinder.fieldKit.v1';

  const LIVE_QUICK_IDEAS = [
    { label: 'Buckhorn Exchange · Denver, CO', query: 'Buckhorn Exchange, 1000 Osage St, Denver, CO' },
    { label: 'Red Rocks Trading Post · Morrison, CO', query: 'Red Rocks Trading Post, Morrison, CO' }
  ];

  // -------------------------------------------------------------------------
  // Application State
  // -------------------------------------------------------------------------
  const state = {
    seededStops: [],
    currentStop: null,
    currentMode: 'seeded',
    currentSource: 'Wayfinder Verified Archive',
    providers: { liveSearchReady: false, activeProvider: 'none' },
    activeGemRank: null,
    openFunnelTiers: new Set([1]),
    activeEraIndex: 0,
    triviaAnswers: new Map(), // cardId -> { guess, correct }
    triviaStreak: 0,
    moduleVisibility: {
      story: true,
      map: true,
      time: true,
      trivia: true,
      archives: true
    },
    savedStops: [],
    audio: {
      supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
      paragraphs: [],
      currentIndex: 0,
      isPlaying: false,
      isPaused: false,
      rate: 1.0,
      voiceURI: '',
      generation: 0,
      barInView: true
    }
  };

  // -------------------------------------------------------------------------
  // DOM Cache
  // -------------------------------------------------------------------------
  const dom = {
    providerStatus: document.getElementById('providerStatus'),
    jumpSavedBtn: document.getElementById('jumpSavedBtn'),
    mastheadSavedCount: document.getElementById('mastheadSavedCount'),
    exploreForm: document.getElementById('exploreForm'),
    addressInput: document.getElementById('addressInput'),
    exploreSubmitBtn: document.getElementById('exploreSubmitBtn'),
    quickPickList: document.getElementById('quickPickList'),
    noticeBanner: document.getElementById('noticeBanner'),
    noticeTitle: document.getElementById('noticeTitle'),
    noticeText: document.getElementById('noticeText'),
    dismissNoticeBtn: document.getElementById('dismissNoticeBtn'),

    dossierSourceBadge: document.getElementById('dossierSourceBadge'),
    dossierArchetype: document.getElementById('dossierArchetype'),
    dossierName: document.getElementById('dossierName'),
    dossierSubtitle: document.getElementById('dossierSubtitle'),
    dossierTagline: document.getElementById('dossierTagline'),
    metaAddress: document.getElementById('metaAddress'),
    metaNeighborhood: document.getElementById('metaNeighborhood'),
    metaCoords: document.getElementById('metaCoords'),
    metaYearBuilt: document.getElementById('metaYearBuilt'),
    metaListenTime: document.getElementById('metaListenTime'),
    saveStopBtn: document.getElementById('saveStopBtn'),
    saveStopIcon: document.getElementById('saveStopIcon'),
    saveStopLabel: document.getElementById('saveStopLabel'),

    fieldKitToggles: document.getElementById('fieldKitToggles'),
    showAllModulesBtn: document.getElementById('showAllModulesBtn'),

    chapterTabs: document.getElementById('chapterTabs'),
    audioBar: document.getElementById('audioBar'),
    audioPlayPauseBtn: document.getElementById('audioPlayPauseBtn'),
    audioPlayIcon: document.getElementById('audioPlayIcon'),
    audioPlayLabel: document.getElementById('audioPlayLabel'),
    audioPrevBtn: document.getElementById('audioPrevBtn'),
    audioNextBtn: document.getElementById('audioNextBtn'),
    audioStopBtn: document.getElementById('audioStopBtn'),
    audioStatusLabel: document.getElementById('audioStatusLabel'),
    audioProgressFill: document.getElementById('audioProgressFill'),
    audioSpeedSelect: document.getElementById('audioSpeedSelect'),
    audioVoiceSelect: document.getElementById('audioVoiceSelect'),
    narrativeContainer: document.getElementById('narrativeContainer'),
    pulseContainer: document.getElementById('pulseContainer'),

    floatingMiniPlayer: document.getElementById('floatingMiniPlayer'),
    miniPlayerStatus: document.getElementById('miniPlayerStatus'),
    miniPrevBtn: document.getElementById('miniPrevBtn'),
    miniPlayPauseBtn: document.getElementById('miniPlayPauseBtn'),
    miniNextBtn: document.getElementById('miniNextBtn'),
    miniStopBtn: document.getElementById('miniStopBtn'),

    mapSubtitle: document.getElementById('mapSubtitle'),
    svgMapMount: document.getElementById('svgMapMount'),
    mapActiveBar: document.getElementById('mapActiveBar'),
    gemsList: document.getElementById('gemsList'),

    ratioContextBar: document.getElementById('ratioContextBar'),
    ratioLocalBar: document.getElementById('ratioLocalBar'),
    funnelTiers: document.getElementById('funnelTiers'),
    eraActiveTitle: document.getElementById('eraActiveTitle'),
    eraActiveYear: document.getElementById('eraActiveYear'),
    eraSlider: document.getElementById('eraSlider'),
    eraTicks: document.getElementById('eraTicks'),
    eraLensCard: document.getElementById('eraLensCard'),

    triviaScore: document.getElementById('triviaScore'),
    triviaStreak: document.getElementById('triviaStreak'),
    resetTriviaBtn: document.getElementById('resetTriviaBtn'),
    triviaGrid: document.getElementById('triviaGrid'),

    exportMdBtn: document.getElementById('exportMdBtn'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    copyNotesBtn: document.getElementById('copyNotesBtn'),
    printPdfBtn: document.getElementById('printPdfBtn'),
    savedCountBadge: document.getElementById('savedCountBadge'),
    savedStopsList: document.getElementById('savedStopsList'),
    sourcesCountBadge: document.getElementById('sourcesCountBadge'),
    sourcesList: document.getElementById('sourcesList'),
    digDeeperList: document.getElementById('digDeeperList'),
    savedStopsSection: document.getElementById('savedStopsSection'),
    toast: document.getElementById('toast')
  };

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      dom.toast.hidden = true;
    }, 3000);
  }

  function safeReadStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function safeWriteStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore quota / privacy mode storage errors
    }
  }

  // -------------------------------------------------------------------------
  // Modular Field Kit Toggles
  // -------------------------------------------------------------------------
  function loadModulePreferences() {
    const saved = safeReadStorage(STORAGE_MODULES_KEY, null);
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(state.moduleVisibility)) {
        if (typeof saved[key] === 'boolean') {
          state.moduleVisibility[key] = saved[key];
        }
      }
    }
    applyModuleVisibility();
  }

  function applyModuleVisibility() {
    for (const [mod, visible] of Object.entries(state.moduleVisibility)) {
      const section = document.querySelector(`[data-module-section="${mod}"]`);
      const btn = dom.fieldKitToggles.querySelector(`[data-module="${mod}"]`);
      if (section) section.hidden = !visible;
      if (btn) {
        btn.classList.toggle('is-active', visible);
        btn.setAttribute('aria-pressed', String(visible));
      }
    }
    safeWriteStorage(STORAGE_MODULES_KEY, state.moduleVisibility);
  }

  function bindFieldKitControls() {
    dom.fieldKitToggles.addEventListener('click', (event) => {
      const btn = event.target.closest('.kit-toggle');
      if (!btn) return;
      const mod = btn.dataset.module;
      if (!mod || !(mod in state.moduleVisibility)) return;
      state.moduleVisibility[mod] = !state.moduleVisibility[mod];
      applyModuleVisibility();
    });

    dom.showAllModulesBtn.addEventListener('click', () => {
      for (const key of Object.keys(state.moduleVisibility)) {
        state.moduleVisibility[key] = true;
      }
      applyModuleVisibility();
      showToast('All 5 Field Kit modules visible');
    });
  }

  // -------------------------------------------------------------------------
  // Saved Stops (localStorage Field Book)
  // -------------------------------------------------------------------------
  function loadSavedStops() {
    const list = safeReadStorage(STORAGE_SAVED_KEY, []);
    state.savedStops = Array.isArray(list) ? list : [];
    renderSavedStops();
  }

  function isCurrentStopSaved() {
    if (!state.currentStop) return false;
    return state.savedStops.some((entry) => entry.id === state.currentStop.id);
  }

  function updateSaveButtonUI() {
    const saved = isCurrentStopSaved();
    dom.saveStopIcon.textContent = saved ? '★' : '☆';
    dom.saveStopLabel.textContent = saved ? 'Saved in Field Book' : 'Save to Field Book';
    dom.saveStopBtn.classList.toggle('btn-primary', saved);
    dom.saveStopBtn.classList.toggle('btn-outline', !saved);
    dom.mastheadSavedCount.textContent = String(state.savedStops.length);
  }

  function toggleSaveCurrentStop() {
    if (!state.currentStop) return;
    const existingIdx = state.savedStops.findIndex((s) => s.id === state.currentStop.id);
    if (existingIdx >= 0) {
      state.savedStops.splice(existingIdx, 1);
      showToast(`Removed "${state.currentStop.name}" from Field Book`);
    } else {
      state.savedStops.unshift({
        id: state.currentStop.id,
        savedAt: new Date().toISOString(),
        stop: state.currentStop
      });
      showToast(`Saved "${state.currentStop.name}" to your Field Book`);
    }
    safeWriteStorage(STORAGE_SAVED_KEY, state.savedStops);
    renderSavedStops();
    updateSaveButtonUI();
  }

  function renderSavedStops() {
    dom.savedCountBadge.textContent = `${state.savedStops.length} saved`;
    dom.mastheadSavedCount.textContent = String(state.savedStops.length);

    if (!state.savedStops.length) {
      dom.savedStopsList.innerHTML =
        '<div class="empty-saved">No saved stops yet. Click <strong>Save to Field Book</strong> at the top of any dossier to keep it here.</div>';
      return;
    }

    dom.savedStopsList.innerHTML = state.savedStops
      .map((entry) => {
        const dateLabel = new Date(entry.savedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        return `
          <div class="saved-stop-item">
            <div class="saved-stop-meta">
              <span class="saved-stop-title">${escapeHtml(entry.stop.name)}</span>
              <span class="saved-stop-sub">${escapeHtml(entry.stop.address)} · Saved ${escapeHtml(dateLabel)}</span>
            </div>
            <div class="saved-stop-actions">
              <button type="button" class="btn btn-outline btn-sm" data-load-saved="${escapeHtml(entry.id)}">Open</button>
              <button type="button" class="btn btn-ghost btn-sm" data-remove-saved="${escapeHtml(entry.id)}" aria-label="Remove saved stop">✕</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // -------------------------------------------------------------------------
  // Quick-Pick Stops & Explore Requests
  // -------------------------------------------------------------------------
  function renderQuickPicks() {
    const chips = [];

    for (const stop of state.seededStops) {
      const selected = state.currentStop && state.currentStop.id === stop.id;
      chips.push(`
        <button type="button" class="pick-chip ${selected ? 'is-selected' : ''}" data-pick-id="${escapeHtml(stop.id)}">
          <span>${escapeHtml(stop.shortLabel || stop.name)}</span>
          <span class="pick-tag">Verified</span>
        </button>
      `);
    }

    for (const idea of LIVE_QUICK_IDEAS) {
      chips.push(`
        <button type="button" class="pick-chip" data-pick-query="${escapeHtml(idea.query)}">
          <span>${escapeHtml(idea.label)}</span>
          <span class="pick-tag is-live-idea">Explore</span>
        </button>
      `);
    }

    dom.quickPickList.innerHTML = chips.join('');
  }

  function showNotice(title, text, isLive = false) {
    if (!text) {
      dom.noticeBanner.hidden = true;
      return;
    }
    dom.noticeTitle.textContent = title;
    dom.noticeText.textContent = text;
    dom.noticeBanner.classList.toggle('is-live-banner', isLive);
    dom.noticeBanner.hidden = false;
  }

  async function exploreLocation(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return;

    dom.exploreSubmitBtn.disabled = true;
    dom.exploreSubmitBtn.classList.add('is-loading');
    dom.exploreSubmitBtn.querySelector('.btn-label').textContent = 'Researching…';

    try {
      const response = await fetch('/api/explore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed })
      });
      const data = await response.json();

      if (!response.ok) {
        showNotice('Could not explore that stop', data.error || 'Please try another address.');
        return;
      }

      if (data.stop) {
        loadDossier(data.stop, data.mode || 'seeded', data.source || 'Wayfinder Archive');
      }

      if (data.notice) {
        showNotice('Preview Fallback Mode', data.notice, false);
      } else if (data.mode === 'live') {
        showNotice(
          `Live Archival Dossier Generated (${data.source})`,
          `Researched "${trimmed}" live. Save it to your Field Book below or export it as Markdown/JSON.`,
          true
        );
      } else {
        dom.noticeBanner.hidden = true;
      }
    } catch (err) {
      showNotice(
        'Connection Interrupted',
        `Unable to reach the Wayfinder Archive server (${err.message}). Your current dossier remains available below.`
      );
    } finally {
      dom.exploreSubmitBtn.disabled = false;
      dom.exploreSubmitBtn.classList.remove('is-loading');
      dom.exploreSubmitBtn.querySelector('.btn-label').textContent = 'Explore Stop';
    }
  }

  // -------------------------------------------------------------------------
  // Main Dossier Renderer
  // -------------------------------------------------------------------------
  function loadDossier(stop, mode = 'seeded', sourceLabel = 'Wayfinder Verified Archive') {
    stopAudio();
    state.currentStop = stop;
    state.currentMode = mode;
    state.currentSource = sourceLabel;
    state.activeGemRank = stop.gems?.[0]?.rank ?? null;
    state.openFunnelTiers = new Set([1]);
    state.activeEraIndex = 0;
    state.triviaAnswers = new Map();
    state.triviaStreak = 0;

    // Header plate
    dom.dossierName.textContent = stop.name;
    dom.dossierSubtitle.textContent = stop.subtitle || '';
    dom.dossierTagline.textContent = stop.tagline || '';
    dom.dossierArchetype.textContent = stop.archetype || 'Historic Location';

    if (stop.verified) {
      dom.dossierSourceBadge.textContent = 'Verified Archival Dossier';
      dom.dossierSourceBadge.className = 'meta-badge badge-verified';
    } else {
      dom.dossierSourceBadge.textContent = `Live Lookup · ${sourceLabel}`;
      dom.dossierSourceBadge.className = 'meta-badge badge-live';
    }

    dom.metaAddress.textContent = stop.address || '—';
    dom.metaNeighborhood.textContent = stop.neighborhood || '—';
    const coordStr = stop.coordinates?.display || '—';
    const elevStr = stop.elevation && stop.elevation !== '—' ? ` · Elev. ${stop.elevation}` : '';
    dom.metaCoords.textContent = `${coordStr}${elevStr}`;
    dom.metaYearBuilt.textContent = stop.yearBuilt || '—';
    dom.metaListenTime.textContent = `~${stop.listenMinutes || 7} min listen`;

    updateSaveButtonUI();
    renderQuickPicks();
    renderNarrative(stop);
    renderWalkingMapAndGems(stop);
    renderFunnelAndScrubber(stop);
    renderTrivia(stop);
    renderSources(stop);
  }

  // -------------------------------------------------------------------------
  // MODULE 1: Narrative & Web Speech API "Listen Along"
  // -------------------------------------------------------------------------
  function renderNarrative(stop) {
    const chapters = Array.isArray(stop.chapters) ? stop.chapters : [];

    // Chapter tabs
    const tabItems = chapters.map(
      (ch, i) => `
        <button type="button" class="chapter-tab ${i === 0 ? 'is-active' : ''}" data-chapter-target="chapter-${escapeHtml(ch.id)}">
          ${ch.number}. ${escapeHtml(ch.title)}
        </button>
      `
    );
    if (stop.pulse?.summary) {
      tabItems.push(
        `<button type="button" class="chapter-tab" data-chapter-target="chapter-pulse">5. Current Pulse</button>`
      );
    }
    dom.chapterTabs.innerHTML = tabItems.join('');

    // Narrative chapters + flattened paragraph list for Web Speech
    state.audio.paragraphs = [];
    let pCounter = 0;

    const sectionsHtml = chapters
      .map((ch) => {
        const parasHtml = (ch.paragraphs || [])
          .map((text) => {
            const idx = pCounter++;
            state.audio.paragraphs.push({
              index: idx,
              chapterTitle: ch.title,
              text
            });
            return `<p class="story-para" data-para-index="${idx}" title="Click to listen from this paragraph">${escapeHtml(text)}</p>`;
          })
          .join('');

        return `
          <article class="chapter-section" id="chapter-${escapeHtml(ch.id)}">
            <h4 class="chapter-heading">
              <span class="chapter-num">0${ch.number}</span>
              <span>${escapeHtml(ch.title)}</span>
            </h4>
            ${parasHtml}
          </article>
        `;
      })
      .join('');

    dom.narrativeContainer.innerHTML = sectionsHtml;

    // Attach DOM refs back to audio paragraphs
    for (const item of state.audio.paragraphs) {
      item.el = dom.narrativeContainer.querySelector(`[data-para-index="${item.index}"]`);
    }

    // Current Pulse section
    if (stop.pulse && (stop.pulse.summary || stop.pulse.highlights?.length)) {
      const items = (stop.pulse.highlights || [])
        .map((h) => `<li>${escapeHtml(h)}</li>`)
        .join('');
      dom.pulseContainer.innerHTML = `
        <div id="chapter-pulse">
          <h4>05 · Current Pulse &amp; Community Chatter</h4>
          <p>${escapeHtml(stop.pulse.summary || '')}</p>
          ${items ? `<ul class="pulse-list">${items}</ul>` : ''}
        </div>
      `;
      dom.pulseContainer.hidden = false;
    } else {
      dom.pulseContainer.hidden = true;
    }

    state.audio.currentIndex = 0;
    updateAudioUI();
  }

  function populateVoices() {
    if (!state.audio.supported) {
      dom.audioStatusLabel.textContent = 'Web Speech audio is not supported in this browser.';
      dom.audioPlayPauseBtn.disabled = true;
      return;
    }

    const voices = window.speechSynthesis.getVoices();
    if (!voices || !voices.length) return;

    const englishVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
    const displayVoices = englishVoices.length ? englishVoices : voices;

    const currentVal = state.audio.voiceURI || dom.audioVoiceSelect.value;
    dom.audioVoiceSelect.innerHTML =
      '<option value="">System Default Voice</option>' +
      displayVoices
        .map(
          (v) =>
            `<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`
        )
        .join('');

    if (currentVal && displayVoices.some((v) => v.voiceURI === currentVal)) {
      dom.audioVoiceSelect.value = currentVal;
    }
  }

  function clearActiveParagraphHighlights() {
    for (const p of state.audio.paragraphs) {
      if (p.el) p.el.classList.remove('is-speaking');
    }
  }

  function updateAudioUI() {
    const total = state.audio.paragraphs.length;
    const idx = Math.min(state.audio.currentIndex, Math.max(0, total - 1));
    const current = state.audio.paragraphs[idx];

    clearActiveParagraphHighlights();

    if ((state.audio.isPlaying || state.audio.isPaused) && current?.el) {
      current.el.classList.add('is-speaking');
    }

    const pct = total > 0 && (state.audio.isPlaying || state.audio.isPaused)
      ? Math.round(((idx + 1) / total) * 100)
      : 0;
    dom.audioProgressFill.style.width = `${pct}%`;

    if (!state.audio.supported) {
      dom.audioStatusLabel.textContent = 'Browser text-to-speech unavailable';
    } else if (state.audio.isPlaying && current) {
      dom.audioStatusLabel.textContent = `Reading paragraph ${idx + 1} of ${total} · ${current.chapterTitle}`;
      dom.audioPlayIcon.textContent = '⏸';
      dom.audioPlayLabel.textContent = 'Pause';
      dom.miniPlayPauseBtn.textContent = '⏸';
      dom.miniPlayerStatus.textContent = `P${idx + 1}/${total} · ${current.chapterTitle}`;
    } else if (state.audio.isPaused && current) {
      dom.audioStatusLabel.textContent = `Paused at paragraph ${idx + 1} of ${total} · ${current.chapterTitle}`;
      dom.audioPlayIcon.textContent = '▶';
      dom.audioPlayLabel.textContent = 'Resume';
      dom.miniPlayPauseBtn.textContent = '▶';
      dom.miniPlayerStatus.textContent = `Paused · P${idx + 1}/${total}`;
    } else {
      dom.audioStatusLabel.textContent = total
        ? `Ready (${total} paragraphs) · Click any paragraph to start listening there`
        : 'Ready';
      dom.audioPlayIcon.textContent = '▶';
      dom.audioPlayLabel.textContent = 'Listen Along';
      dom.miniPlayPauseBtn.textContent = '▶';
    }

    updateMiniPlayerVisibility();
  }

  function updateMiniPlayerVisibility() {
    const shouldShow =
      (state.audio.isPlaying || state.audio.isPaused) &&
      !state.audio.barInView &&
      state.moduleVisibility.story;
    dom.floatingMiniPlayer.hidden = !shouldShow;
  }

  function speakParagraphAt(index, shouldScroll = true) {
    if (!state.audio.supported || !state.audio.paragraphs.length) return;
    const bounded = Math.max(0, Math.min(index, state.audio.paragraphs.length - 1));
    state.audio.generation += 1;
    const gen = state.audio.generation;

    window.speechSynthesis.cancel();

    state.audio.currentIndex = bounded;
    state.audio.isPlaying = true;
    state.audio.isPaused = false;
    updateAudioUI();

    const item = state.audio.paragraphs[bounded];
    if (shouldScroll && item.el) {
      item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.rate = state.audio.rate;

    if (state.audio.voiceURI) {
      const match = window.speechSynthesis
        .getVoices()
        .find((v) => v.voiceURI === state.audio.voiceURI);
      if (match) utterance.voice = match;
    }

    utterance.onend = () => {
      if (gen !== state.audio.generation) return;
      if (state.audio.currentIndex + 1 < state.audio.paragraphs.length) {
        speakParagraphAt(state.audio.currentIndex + 1, true);
      } else {
        stopAudio();
        showToast('Finished reading this dossier');
      }
    };

    utterance.onerror = () => {
      if (gen !== state.audio.generation) return;
      stopAudio();
    };

    window.speechSynthesis.speak(utterance);
  }

  function togglePlayPauseAudio() {
    if (!state.audio.supported) return;
    if (state.audio.isPlaying) {
      window.speechSynthesis.pause();
      state.audio.isPlaying = false;
      state.audio.isPaused = true;
      updateAudioUI();
    } else if (state.audio.isPaused) {
      window.speechSynthesis.resume();
      state.audio.isPlaying = true;
      state.audio.isPaused = false;
      updateAudioUI();
    } else {
      speakParagraphAt(state.audio.currentIndex, true);
    }
  }

  function stopAudio() {
    state.audio.generation += 1;
    if (state.audio.supported) {
      window.speechSynthesis.cancel();
    }
    state.audio.isPlaying = false;
    state.audio.isPaused = false;
    state.audio.currentIndex = 0;
    updateAudioUI();
  }

  function stepAudio(delta) {
    if (!state.audio.paragraphs.length) return;
    const nextIdx = Math.max(
      0,
      Math.min(state.audio.currentIndex + delta, state.audio.paragraphs.length - 1)
    );
    speakParagraphAt(nextIdx, true);
  }

  // -------------------------------------------------------------------------
  // MODULE 2: Interactive SVG Walking Map + Non-Overlapping Pin Layout + Gems
  // -------------------------------------------------------------------------
  function computeNonOverlappingPins(anchor, gems) {
    const MIN_DIST = 44; // Guaranteed minimum center-to-center distance (px)
    const BOUNDS = { minX: 60, maxX: 740, minY: 72, maxY: 384 };

    const pins = gems.map((gem, idx) => ({
      gem,
      x: Number.isFinite(Number(gem.mapX)) ? Number(gem.mapX) : 140 + ((idx * 95) % 520),
      y: Number.isFinite(Number(gem.mapY)) ? Number(gem.mapY) : idx % 2 === 0 ? 128 : 265
    }));

    // Iterative collision resolution against anchor & sibling pins
    for (let iter = 0; iter < 36; iter++) {
      let moved = false;

      // Repel from anchor
      for (const p of pins) {
        const dx = p.x - anchor.x;
        const dy = p.y - anchor.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist < MIN_DIST + 4) {
          const push = (MIN_DIST + 4 - dist) * 0.65;
          p.x += (dx / dist) * push;
          p.y += (dy / dist) * push;
          moved = true;
        }
      }

      // Repel pairwise between gem pins
      for (let i = 0; i < pins.length; i++) {
        for (let j = i + 1; j < pins.length; j++) {
          const a = pins[i];
          const b = pins[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          if (dist < MIN_DIST) {
            const push = (MIN_DIST - dist) * 0.55;
            const nx = dx / dist;
            const ny = dy / dist;
            a.x -= nx * push;
            a.y -= ny * push;
            b.x += nx * push;
            b.y += ny * push;
            moved = true;
          }
        }
      }

      // Keep inside safe SVG frame
      for (const p of pins) {
        p.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, p.x));
        p.y = Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, p.y));
      }

      if (!moved) break;
    }

    return pins;
  }

  function getPinFill(statusType) {
    if (statusType === 'vanished') return '#7b6659';
    if (statusType === 'relic') return '#b58328';
    return '#2d5a4e';
  }

  function renderWalkingMapAndGems(stop) {
    const mapCfg = stop.mapConfig || {};
    const anchor = mapCfg.anchor || { x: 400, y: 210, label: stop.name };
    const gems = Array.isArray(stop.gems) ? stop.gems : [];
    const pins = computeNonOverlappingPins(anchor, gems);

    dom.mapSubtitle.textContent =
      mapCfg.subtitle || `${gems.length} verified nearby gems ordered strictly closest first`;

    // Build SVG
    const streetsSvg = (mapCfg.streets || [])
      .map((st) => {
        const isMain = st.type === 'main';
        const strokeWidth = isMain ? 24 : 14;
        const midX = (st.x1 + st.x2) / 2;
        const midY = (st.y1 + st.y2) / 2;
        const isVertical = Math.abs(st.x1 - st.x2) < Math.abs(st.y1 - st.y2);
        return `
          <g>
            <line x1="${st.x1}" y1="${st.y1}" x2="${st.x2}" y2="${st.y2}" stroke="#dfd3be" stroke-width="${strokeWidth + 4}" stroke-linecap="round" />
            <line x1="${st.x1}" y1="${st.y1}" x2="${st.x2}" y2="${st.y2}" stroke="#fbf7ef" stroke-width="${strokeWidth}" stroke-linecap="round" />
            <line x1="${st.x1}" y1="${st.y1}" x2="${st.x2}" y2="${st.y2}" stroke="#d5c6ad" stroke-width="1" stroke-dasharray="5 5" />
            <text
              x="${isVertical ? st.x1 + 14 : midX}"
              y="${isVertical ? 66 : st.y1 + 4}"
              text-anchor="${isVertical ? 'start' : 'middle'}"
              font-family="Plus Jakarta Sans, sans-serif"
              font-size="${isMain ? '10.5' : '9.5'}"
              font-weight="700"
              letter-spacing="1.2"
              fill="#786a5c"
            >${escapeHtml(st.label || '')}</text>
          </g>
        `;
      })
      .join('');

    const waterwaysSvg = (mapCfg.waterways || [])
      .map(
        (w) => `
        <g>
          <path d="${escapeHtml(w.path)}" fill="none" stroke="#b9d4d9" stroke-width="20" stroke-linecap="round" opacity="0.85" />
          <path d="${escapeHtml(w.path)}" fill="none" stroke="#85aeb7" stroke-width="2" stroke-dasharray="10 6" opacity="0.7" />
          <text x="165" y="368" font-family="Source Serif 4, serif" font-style="italic" font-size="12" fill="#3a636d">${escapeHtml(w.label || '')}</text>
        </g>
      `
      )
      .join('');

    const landmarksSvg = (mapCfg.landmarks || [])
      .map(
        (lm) => `
        <text x="${lm.x}" y="${lm.y}" font-family="Source Serif 4, serif" font-style="italic" font-size="11.5" fill="#584c41">
          ✦ ${escapeHtml(lm.label)}
        </text>
      `
      )
      .join('');

    const pinsSvg = pins
      .map(({ gem, x, y }) => {
        const active = gem.rank === state.activeGemRank;
        const fill = getPinFill(gem.statusType);
        const dashed = gem.statusType === 'vanished' ? 'stroke-dasharray="3 2"' : '';
        return `
          <g
            class="map-pin-group ${active ? 'is-active' : ''}"
            data-pin-rank="${gem.rank}"
            data-pin-x="${x.toFixed(1)}"
            data-pin-y="${y.toFixed(1)}"
            tabindex="0"
            role="button"
            aria-label="Pin ${gem.rank}: ${escapeHtml(gem.name)} (${escapeHtml(gem.distance)})"
          >
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${active ? 18 : 15}" fill="${fill}" stroke="#fcf9f2" stroke-width="2.5" ${dashed} class="map-pin-circle" />
            <text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12.5" font-weight="700" fill="#fffdf9">${gem.rank}</text>
          </g>
        `;
      })
      .join('');

    const activePin = pins.find((p) => p.gem.rank === state.activeGemRank);
    const routeSvg = activePin
      ? `<path id="activeMapRoute" class="map-route-line" d="M ${anchor.x} ${anchor.y} Q ${((anchor.x + activePin.x) / 2).toFixed(1)} ${(Math.min(anchor.y, activePin.y) - 18).toFixed(1)} ${activePin.x.toFixed(1)} ${activePin.y.toFixed(1)}" />`
      : '<path id="activeMapRoute" class="map-route-line" d="" />';

    // Place anchor label cleanly below or above anchor depending on neighbors
    const anchorLabelY = anchor.y + 34;

    dom.svgMapMount.innerHTML = `
      <svg class="heritage-map-svg" viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="parchmentGrid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e4d9c4" stroke-width="0.6" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="800" height="420" fill="#f3ead8" />
        <rect x="0" y="0" width="800" height="420" fill="url(#parchmentGrid)" />

        <!-- Subtle contour lines -->
        <path d="M -10 88 C 190 50, 420 96, 810 42" fill="none" stroke="#d9ccb4" stroke-width="1" />
        <path d="M -10 402 C 240 370, 520 412, 810 365" fill="none" stroke="#d9ccb4" stroke-width="1" />

        ${waterwaysSvg}
        ${streetsSvg}
        ${landmarksSvg}

        <!-- Active dashed walking path -->
        ${routeSvg}

        <!-- Primary Anchor Pin -->
        <g class="map-anchor" data-anchor-x="${anchor.x}" data-anchor-y="${anchor.y}">
          <circle cx="${anchor.x}" cy="${anchor.y}" r="20" fill="#b54d2d" fill-opacity="0.16" />
          <circle cx="${anchor.x}" cy="${anchor.y}" r="15" fill="#b54d2d" stroke="#fcf9f2" stroke-width="2.5" />
          <text x="${anchor.x}" y="${anchor.y + 5}" text-anchor="middle" font-size="14" fill="#fffdf9">★</text>
          <rect x="${anchor.x - 74}" y="${anchorLabelY - 12}" width="148" height="19" rx="9" fill="#241d17" opacity="0.9" />
          <text x="${anchor.x}" y="${anchorLabelY + 1}" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="10" font-weight="700" fill="#fcf9f2">${escapeHtml(anchor.label || stop.name)}</text>
        </g>

        <!-- Non-overlapping Numbered Gem Pins -->
        ${pinsSvg}

        <!-- Compass Rose -->
        <g transform="translate(744, 58)">
          <circle cx="0" cy="0" r="22" fill="#fcf9f2" fill-opacity="0.9" stroke="#c8bba6" stroke-width="1" />
          <path d="M 0 -15 L 4 -2 L 0 -5 L -4 -2 Z" fill="#b54d2d" />
          <path d="M 0 15 L 4 2 L 0 5 L -4 2 Z" fill="#786a5c" />
          <text x="0" y="-17" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8.5" font-weight="700" fill="#241d17">N</text>
        </g>

        <!-- Scale Bar -->
        <g transform="translate(36, 396)">
          <line x1="0" y1="0" x2="76" y2="0" stroke="#584c41" stroke-width="2" />
          <line x1="0" y1="-4" x2="0" y2="4" stroke="#584c41" stroke-width="1.5" />
          <line x1="76" y1="-4" x2="76" y2="4" stroke="#584c41" stroke-width="1.5" />
          <text x="84" y="4" font-family="JetBrains Mono, monospace" font-size="10" fill="#584c41">${escapeHtml(mapCfg.scaleLabel || '150 ft / ~45 m')}</text>
        </g>
      </svg>
    `;

    // Render Closest-First Gem Cards
    dom.gemsList.innerHTML = gems
      .map((gem) => {
        const active = gem.rank === state.activeGemRank;
        const statusClass = `survival-${gem.statusType || 'intact'}`;
        return `
          <article class="gem-card status-${escapeHtml(gem.statusType || 'intact')} ${active ? 'is-active' : ''}" data-gem-rank="${gem.rank}" tabindex="0">
            <div class="gem-card-head">
              <span class="gem-rank">${gem.rank}</span>
              <div class="gem-title-wrap">
                <h4 class="gem-name">${escapeHtml(gem.name)}</h4>
                <p class="gem-address">${escapeHtml(gem.address)} · ${escapeHtml(gem.year || 'Historic')}</p>
              </div>
            </div>

            <div class="gem-meta-row">
              <span class="gem-pill mono">${escapeHtml(gem.distance)}</span>
              <span class="gem-pill">${escapeHtml(gem.walkTime)}</span>
              <span class="survival-badge ${statusClass}">${escapeHtml(gem.status)}</span>
            </div>

            <p class="gem-story">${escapeHtml(gem.story)}</p>

            <div class="spotter-tip">
              <strong>On-Site Spotter Tip</strong>
              ${escapeHtml(gem.spotterTip)}
            </div>
          </article>
        `;
      })
      .join('');

    updateActiveGemSelection(state.activeGemRank, false);
  }

  function updateActiveGemSelection(rank, scrollToCard = false) {
    if (!state.currentStop || rank == null) return;
    state.activeGemRank = Number(rank);
    const gem = (state.currentStop.gems || []).find((g) => g.rank === state.activeGemRank);
    if (!gem) return;

    // Sync SVG pins & route line
    const anchorEl = dom.svgMapMount.querySelector('.map-anchor');
    const routeEl = dom.svgMapMount.querySelector('#activeMapRoute');
    const ax = Number(anchorEl?.dataset.anchorX || 400);
    const ay = Number(anchorEl?.dataset.anchorY || 210);

    dom.svgMapMount.querySelectorAll('.map-pin-group').forEach((pinEl) => {
      const isMatch = Number(pinEl.dataset.pinRank) === state.activeGemRank;
      pinEl.classList.toggle('is-active', isMatch);
      const circle = pinEl.querySelector('.map-pin-circle');
      if (circle) circle.setAttribute('r', isMatch ? '18' : '15');

      if (isMatch && routeEl) {
        const px = Number(pinEl.dataset.pinX);
        const py = Number(pinEl.dataset.pinY);
        const midX = ((ax + px) / 2).toFixed(1);
        const ctrlY = (Math.min(ay, py) - 20).toFixed(1);
        routeEl.setAttribute('d', `M ${ax} ${ay} Q ${midX} ${ctrlY} ${px} ${py}`);
        pinEl.parentNode.appendChild(pinEl); // Bring active pin to top of SVG z-order
      }
    });

    // Sync Gem Cards
    dom.gemsList.querySelectorAll('.gem-card').forEach((cardEl) => {
      const isMatch = Number(cardEl.dataset.gemRank) === state.activeGemRank;
      cardEl.classList.toggle('is-active', isMatch);
      if (isMatch && scrollToCard) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    dom.mapActiveBar.innerHTML = `
      <span>
        <strong>#${gem.rank} ${escapeHtml(gem.name)}</strong> · ${escapeHtml(gem.distance)} (${escapeHtml(gem.walkTime)}) — <em>${escapeHtml(gem.spotterTip)}</em>
      </span>
    `;
  }

  // -------------------------------------------------------------------------
  // MODULE 3: Peel Back Time (65/35 Funnel + Era Scrubber)
  // -------------------------------------------------------------------------
  function renderFunnelAndScrubber(stop) {
    const funnel = stop.funnel || { contextShare: 35, localShare: 65, tiers: [] };
    const ctxShare = funnel.contextShare || 35;
    const locShare = funnel.localShare || 65;

    dom.ratioContextBar.style.width = `${ctxShare}%`;
    dom.ratioContextBar.innerHTML = `<strong>${ctxShare}%</strong> Deep Ground &amp; Regional Context`;
    dom.ratioLocalBar.style.width = `${locShare}%`;
    dom.ratioLocalBar.innerHTML = `<strong>${locShare}%</strong> Immediate Block, Exact Parcel &amp; People`;

    const tiers = Array.isArray(funnel.tiers) ? funnel.tiers : [];
    dom.funnelTiers.innerHTML = tiers
      .map((tier) => {
        const isOpen = state.openFunnelTiers.has(tier.tier);
        const detailsHtml = (tier.details || []).map((d) => `<li>${escapeHtml(d)}</li>`).join('');
        return `
          <div class="funnel-tier-card ${isOpen ? 'is-open' : ''}" data-tier="${tier.tier}" role="button" tabindex="0" aria-expanded="${isOpen}">
            <div class="funnel-tier-top">
              <span class="funnel-tier-label">Tier ${tier.tier} · ${escapeHtml(tier.label)}</span>
              <span class="funnel-tier-share">${escapeHtml(tier.share)} · ${isOpen ? 'Hide notes ▲' : 'Inspect ▼'}</span>
            </div>
            <h4 class="funnel-tier-title">${escapeHtml(tier.title)}</h4>
            <p class="funnel-tier-summary">${escapeHtml(tier.summary)}</p>
            ${isOpen && detailsHtml ? `<ul class="funnel-tier-details">${detailsHtml}</ul>` : ''}
          </div>
        `;
      })
      .join('');

    // Era Scrubber
    const eras = Array.isArray(stop.eras) ? stop.eras : [];
    dom.eraSlider.min = '0';
    dom.eraSlider.max = String(Math.max(0, eras.length - 1));
    dom.eraSlider.value = String(state.activeEraIndex);

    dom.eraTicks.innerHTML = eras
      .map(
        (era, idx) => `
          <button type="button" class="era-tick-btn ${idx === state.activeEraIndex ? 'is-active' : ''}" data-era-index="${idx}">
            ${escapeHtml(era.year)}
          </button>
        `
      )
      .join('');

    renderActiveEraLens(eras[state.activeEraIndex]);
  }

  function renderActiveEraLens(era) {
    if (!era) {
      dom.eraActiveTitle.textContent = 'Timeline unavailable';
      dom.eraActiveYear.textContent = '—';
      dom.eraLensCard.innerHTML = '';
      return;
    }

    dom.eraActiveTitle.textContent = era.eraTitle;
    dom.eraActiveYear.textContent = era.year;
    dom.eraSlider.value = String(state.activeEraIndex);

    dom.eraTicks.querySelectorAll('.era-tick-btn').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.eraIndex) === state.activeEraIndex);
    });

    dom.eraLensCard.innerHTML = `
      <div class="lens-tile">
        <h5>Standing on This Exact Lot</h5>
        <p>${escapeHtml(era.standingHere)}</p>
      </div>
      <div class="lens-tile">
        <h5>Street-Level Scene</h5>
        <p>${escapeHtml(era.scene)}</p>
      </div>
      <div class="lens-tile">
        <h5>Key People</h5>
        <p>${escapeHtml(era.keyPeople)}</p>
      </div>
      <div class="lens-tile">
        <h5>Surviving Clue / Artifact</h5>
        <p>${escapeHtml(era.artifact)}</p>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // MODULE 4: Playable "Fact or Tall Tale?" 3D Flip Cards
  // -------------------------------------------------------------------------
  function verdictClassSuffix(verdict) {
    if (verdict === 'Verified Fact') return 'fact';
    if (verdict === 'Local Lore') return 'lore';
    return 'tale';
  }

  function renderTrivia(stop) {
    const cards = Array.isArray(stop.trivia) ? stop.trivia : [];

    dom.triviaGrid.innerHTML = cards
      .map((card, idx) => {
        const suffix = verdictClassSuffix(card.verdict);
        const answer = state.triviaAnswers.get(card.id);
        const flipped = Boolean(answer);
        const resultLabel = answer
          ? answer.correct
            ? '✓ Spot on!'
            : `Guessed: ${answer.guess}`
          : '';

        return `
          <div class="flip-card verdict-${suffix} ${flipped ? 'is-flipped' : ''}" data-card-id="${escapeHtml(card.id)}">
            <div class="flip-card-inner">
              <div class="flip-face flip-front">
                <div>
                  <div class="flip-card-num">ARCHIVE CARD 0${idx + 1} / 0${cards.length}</div>
                  <p class="flip-claim">“${escapeHtml(card.claim)}”</p>
                </div>
                <div class="flip-choices">
                  <button type="button" class="choice-btn" data-card-id="${escapeHtml(card.id)}" data-guess="Verified Fact">Verified Fact</button>
                  <button type="button" class="choice-btn" data-card-id="${escapeHtml(card.id)}" data-guess="Local Lore">Local Lore</button>
                  <button type="button" class="choice-btn" data-card-id="${escapeHtml(card.id)}" data-guess="Tall Tale">Tall Tale</button>
                </div>
              </div>

              <div class="flip-face flip-back">
                <div>
                  <div class="verdict-row">
                    <span class="verdict-badge is-${suffix}">${escapeHtml(card.verdict)}</span>
                    <span class="guess-result ${answer?.correct ? 'is-correct' : 'is-wrong'}">${escapeHtml(resultLabel)}</span>
                  </div>
                  <p class="flip-explanation">${escapeHtml(card.explanation)}</p>
                </div>
                <div class="flip-back-foot">
                  <span>${escapeHtml(card.sourceNote || 'Archival record')}</span>
                  <button type="button" class="btn-link" data-unflip="${escapeHtml(card.id)}">Read Claim</button>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    updateTriviaScoreboard();
  }

  function updateTriviaScoreboard() {
    const totalAnswered = state.triviaAnswers.size;
    let correctCount = 0;
    for (const ans of state.triviaAnswers.values()) {
      if (ans.correct) correctCount += 1;
    }
    dom.triviaScore.textContent = `${correctCount} / ${totalAnswered}`;
    dom.triviaStreak.textContent = String(state.triviaStreak);
  }

  // -------------------------------------------------------------------------
  // MODULE 5: Primary Sources & Export Generators
  // -------------------------------------------------------------------------
  function renderSources(stop) {
    const consulted = stop.sources?.consulted || [];
    const digDeeper = stop.sources?.digDeeper || [];

    dom.sourcesCountBadge.textContent = `${consulted.length} sources`;
    dom.sourcesList.innerHTML = consulted
      .map(
        (s) => `
          <li>
            <strong>
              ${
                s.url
                  ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title)} ↗</a>`
                  : escapeHtml(s.title)
              }
            </strong>
            <p>${escapeHtml(s.detail || '')}</p>
          </li>
        `
      )
      .join('');

    dom.digDeeperList.innerHTML = digDeeper
      .map(
        (d) => `
          <li>
            <strong>${escapeHtml(d.label)}</strong>
            <p>${escapeHtml(d.instruction)}</p>
          </li>
        `
      )
      .join('');
  }

  function buildMarkdownExport(stop) {
    const lines = [
      `# Location Dossier: ${stop.name}`,
      `**Address:** ${stop.address}`,
      `**District / Micro-Area:** ${stop.neighborhood}`,
      `**Coordinates:** ${stop.coordinates?.display || '—'} · **Elevation:** ${stop.elevation || '—'}`,
      `**Built / Era:** ${stop.yearBuilt || '—'}`,
      '',
      `> ${stop.tagline || ''}`,
      ''
    ];

    for (const ch of stop.chapters || []) {
      lines.push(`## ${ch.number}. ${ch.title}`);
      lines.push('');
      for (const p of ch.paragraphs || []) {
        lines.push(p);
        lines.push('');
      }
    }

    if (stop.pulse?.summary) {
      lines.push('## 5. Current Pulse & Community Chatter');
      lines.push('');
      lines.push(stop.pulse.summary);
      lines.push('');
      for (const h of stop.pulse.highlights || []) {
        lines.push(`- ${h}`);
      }
      lines.push('');
    }

    lines.push('## 6. Nearby Hidden Gems, Closest First');
    lines.push('');
    for (const gem of stop.gems || []) {
      lines.push(
        `${gem.rank}. **${gem.name}** — ${gem.distance} (${gem.walkTime}), ${gem.address} [${gem.status}]. ${gem.story} *On-Site Spotter Tip:* ${gem.spotterTip}`
      );
    }
    lines.push('');

    lines.push('## 7. Sources & Where to Dig Deeper');
    lines.push('');
    for (const s of stop.sources?.consulted || []) {
      lines.push(`- **${s.title}**: ${s.detail}${s.url ? ` (${s.url})` : ''}`);
    }
    if (stop.sources?.digDeeper?.length) {
      lines.push('');
      lines.push('### Dig-Deeper Leads');
      for (const d of stop.sources.digDeeper) {
        lines.push(`- **${d.label}**: ${d.instruction}`);
      }
    }

    return lines.join('\n');
  }

  function triggerFileDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyNotesToClipboard() {
    if (!state.currentStop) return;
    const text = buildMarkdownExport(state.currentStop);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      showToast('Copied full Wayfinder field notes to clipboard');
    } catch {
      showToast('Could not copy automatically — try Download .md instead');
    }
  }

  // -------------------------------------------------------------------------
  // Event Binding
  // -------------------------------------------------------------------------
  function bindEvents() {
    // Search form
    dom.exploreForm.addEventListener('submit', (e) => {
      e.preventDefault();
      exploreLocation(dom.addressInput.value);
    });

    // Quick-pick chips
    dom.quickPickList.addEventListener('click', (e) => {
      const chip = e.target.closest('.pick-chip');
      if (!chip) return;
      if (chip.dataset.pickId) {
        const found = state.seededStops.find((s) => s.id === chip.dataset.pickId);
        if (found) {
          dom.addressInput.value = found.address;
          dom.noticeBanner.hidden = true;
          loadDossier(found, 'seeded', 'Wayfinder Verified Archive');
          showToast(`Loaded verified dossier: ${found.name}`);
        }
      } else if (chip.dataset.pickQuery) {
        dom.addressInput.value = chip.dataset.pickQuery;
        exploreLocation(chip.dataset.pickQuery);
      }
    });

    // Dismiss notice
    dom.dismissNoticeBtn.addEventListener('click', () => {
      dom.noticeBanner.hidden = true;
    });

    // Save / Jump to Saved Field Book
    dom.saveStopBtn.addEventListener('click', toggleSaveCurrentStop);
    dom.jumpSavedBtn.addEventListener('click', () => {
      state.moduleVisibility.archives = true;
      applyModuleVisibility();
      dom.savedStopsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Saved stops list interactions
    dom.savedStopsList.addEventListener('click', (e) => {
      const loadBtn = e.target.closest('[data-load-saved]');
      if (loadBtn) {
        const entry = state.savedStops.find((s) => s.id === loadBtn.dataset.loadSaved);
        if (entry?.stop) {
          dom.noticeBanner.hidden = true;
          loadDossier(entry.stop, entry.stop.verified ? 'seeded' : 'saved', 'Saved Field Book');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          showToast(`Opened "${entry.stop.name}" from your Field Book`);
        }
        return;
      }
      const removeBtn = e.target.closest('[data-remove-saved]');
      if (removeBtn) {
        const id = removeBtn.dataset.removeSaved;
        state.savedStops = state.savedStops.filter((s) => s.id !== id);
        safeWriteStorage(STORAGE_SAVED_KEY, state.savedStops);
        renderSavedStops();
        updateSaveButtonUI();
        showToast('Removed stop from Field Book');
      }
    });

    // Chapter tabs jump
    dom.chapterTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.chapter-tab');
      if (!tab) return;
      dom.chapterTabs.querySelectorAll('.chapter-tab').forEach((t) => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const target = document.getElementById(tab.dataset.chapterTarget);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Click any narrative paragraph to start listening there
    dom.narrativeContainer.addEventListener('click', (e) => {
      const para = e.target.closest('.story-para');
      if (!para) return;
      const idx = Number(para.dataset.paraIndex);
      if (Number.isFinite(idx)) {
        speakParagraphAt(idx, false);
      }
    });

    // Audio controls (main bar + floating mini-player)
    dom.audioPlayPauseBtn.addEventListener('click', togglePlayPauseAudio);
    dom.audioStopBtn.addEventListener('click', stopAudio);
    dom.audioPrevBtn.addEventListener('click', () => stepAudio(-1));
    dom.audioNextBtn.addEventListener('click', () => stepAudio(1));

    dom.miniPlayPauseBtn.addEventListener('click', togglePlayPauseAudio);
    dom.miniStopBtn.addEventListener('click', stopAudio);
    dom.miniPrevBtn.addEventListener('click', () => stepAudio(-1));
    dom.miniNextBtn.addEventListener('click', () => stepAudio(1));

    dom.audioSpeedSelect.addEventListener('change', () => {
      state.audio.rate = Number(dom.audioSpeedSelect.value) || 1.0;
      if (state.audio.isPlaying) {
        speakParagraphAt(state.audio.currentIndex, false);
      }
    });

    dom.audioVoiceSelect.addEventListener('change', () => {
      state.audio.voiceURI = dom.audioVoiceSelect.value;
      if (state.audio.isPlaying) {
        speakParagraphAt(state.audio.currentIndex, false);
      }
    });

    if (state.audio.supported && 'onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = populateVoices;
    }

    // Observe audio bar scroll position for floating mini-player
    if ('IntersectionObserver' in window && dom.audioBar) {
      const observer = new IntersectionObserver(
        (entries) => {
          state.audio.barInView = entries[0]?.isIntersecting ?? true;
          updateMiniPlayerVisibility();
        },
        { threshold: 0.1 }
      );
      observer.observe(dom.audioBar);
    }

    // Map pin click/hover & keyboard sync
    dom.svgMapMount.addEventListener('click', (e) => {
      const pin = e.target.closest('.map-pin-group');
      if (!pin) return;
      updateActiveGemSelection(Number(pin.dataset.pinRank), true);
    });

    dom.svgMapMount.addEventListener('mouseover', (e) => {
      const pin = e.target.closest('.map-pin-group');
      if (!pin) return;
      updateActiveGemSelection(Number(pin.dataset.pinRank), false);
    });

    dom.svgMapMount.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const pin = e.target.closest('.map-pin-group');
      if (!pin) return;
      e.preventDefault();
      updateActiveGemSelection(Number(pin.dataset.pinRank), true);
    });

    // Gem card click/hover sync
    dom.gemsList.addEventListener('click', (e) => {
      const card = e.target.closest('.gem-card');
      if (!card) return;
      updateActiveGemSelection(Number(card.dataset.gemRank), false);
    });

    dom.gemsList.addEventListener('mouseenter', (e) => {
      const card = e.target.closest('.gem-card');
      if (!card) return;
      updateActiveGemSelection(Number(card.dataset.gemRank), false);
    }, true);

    // 65/35 Funnel tier expand/collapse
    dom.funnelTiers.addEventListener('click', (e) => {
      const card = e.target.closest('.funnel-tier-card');
      if (!card) return;
      const tier = Number(card.dataset.tier);
      if (state.openFunnelTiers.has(tier)) {
        state.openFunnelTiers.delete(tier);
      } else {
        state.openFunnelTiers.add(tier);
      }
      renderFunnelAndScrubber(state.currentStop);
    });

    // Era Scrubber slider & ticks
    dom.eraSlider.addEventListener('input', () => {
      state.activeEraIndex = Number(dom.eraSlider.value) || 0;
      renderActiveEraLens(state.currentStop?.eras?.[state.activeEraIndex]);
    });

    dom.eraTicks.addEventListener('click', (e) => {
      const btn = e.target.closest('.era-tick-btn');
      if (!btn) return;
      state.activeEraIndex = Number(btn.dataset.eraIndex) || 0;
      renderActiveEraLens(state.currentStop?.eras?.[state.activeEraIndex]);
    });

    // Fact or Tall Tale 3D flip cards
    dom.triviaGrid.addEventListener('click', (e) => {
      const guessBtn = e.target.closest('.choice-btn');
      if (guessBtn && state.currentStop) {
        const cardId = guessBtn.dataset.cardId;
        const guess = guessBtn.dataset.guess;
        const card = (state.currentStop.trivia || []).find((c) => c.id === cardId);
        if (!card) return;

        // Only score first attempt per card
        if (!state.triviaAnswers.has(cardId)) {
          const correct = card.verdict === guess;
          state.triviaAnswers.set(cardId, { guess, correct });
          state.triviaStreak = correct ? state.triviaStreak + 1 : 0;
        }
        renderTrivia(state.currentStop);
        return;
      }

      const unflipBtn = e.target.closest('[data-unflip]');
      if (unflipBtn) {
        const cardEl = dom.triviaGrid.querySelector(
          `.flip-card[data-card-id="${CSS.escape(unflipBtn.dataset.unflip)}"]`
        );
        if (cardEl) cardEl.classList.toggle('is-flipped');
      }
    });

    dom.resetTriviaBtn.addEventListener('click', () => {
      state.triviaAnswers = new Map();
      state.triviaStreak = 0;
      if (state.currentStop) renderTrivia(state.currentStop);
      showToast('Fact or Tall Tale deck reset');
    });

    // Export actions
    dom.exportMdBtn.addEventListener('click', () => {
      if (!state.currentStop) return;
      const md = buildMarkdownExport(state.currentStop);
      triggerFileDownload(`${state.currentStop.slug || 'wayfinder'}-dossier.md`, md, 'text/markdown;charset=utf-8');
      showToast('Downloaded Markdown dossier (.md)');
    });

    dom.exportJsonBtn.addEventListener('click', () => {
      if (!state.currentStop) return;
      const json = JSON.stringify(state.currentStop, null, 2);
      triggerFileDownload(`${state.currentStop.slug || 'wayfinder'}-dossier.json`, json, 'application/json;charset=utf-8');
      showToast('Downloaded JSON dossier (.json)');
    });

    dom.copyNotesBtn.addEventListener('click', copyNotesToClipboard);
    dom.printPdfBtn.addEventListener('click', () => window.print());

    // Stop speech when leaving page
    window.addEventListener('beforeunload', () => {
      if (state.audio.supported) window.speechSynthesis.cancel();
    });
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------
  async function init() {
    loadModulePreferences();
    loadSavedStops();
    bindFieldKitControls();
    bindEvents();
    populateVoices();

    try {
      const res = await fetch('/api/stops');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      state.seededStops = Array.isArray(data.stops) ? data.stops : [];
      state.providers = data.providers || { liveSearchReady: false, activeProvider: 'none' };

      if (state.providers.liveSearchReady) {
        const label =
          state.providers.activeProvider === 'gemini'
            ? 'Live Search Ready · Gemini 2.5 Flash'
            : 'Live Search Ready · OpenAI';
        dom.providerStatus.textContent = label;
        dom.providerStatus.classList.add('is-live');
      } else {
        dom.providerStatus.textContent = 'Pre-Seeded Archive Mode';
      }

      if (state.seededStops.length) {
        loadDossier(state.seededStops[0], 'seeded', 'Wayfinder Verified Archive');
      } else {
        dom.dossierName.textContent = 'No pre-seeded stops found';
      }
    } catch (err) {
      dom.providerStatus.textContent = 'Offline';
      showNotice('Startup Notice', `Could not load pre-seeded stops from /api/stops (${err.message}).`);
    }
  }

  init();
})();
