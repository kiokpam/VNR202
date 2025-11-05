// Image-based magazine viewer with hotspot editor and read-aloud
// This version assumes page images are named 1.png .. 12.png (cover=1.png). If your filenames differ, either rename or import a hotspots JSON that references your filenames.

const TOTAL_PAGES = 12; // adjust if necessary
const viewer = document.getElementById('viewer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageIndicator = document.getElementById('pageIndicator');
const editToggle = document.getElementById('editToggle');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');
const rateInput = document.getElementById('rate');
const pitchInput = document.getElementById('pitch');
const voiceSelect = document.getElementById('voiceSelect');
const autoViBtn = document.getElementById('autoViBtn');
const stopBtn = document.getElementById('stopBtn');

let availableVoices = [];
let selectedVoiceURI = localStorage.getItem('mag-voice-uri') || null;

function populateVoices() {
  if (!('speechSynthesis' in window)) return;
  availableVoices = speechSynthesis.getVoices() || [];
  // clear
  if (!voiceSelect) return;
  voiceSelect.innerHTML = '';
  availableVoices.forEach((v, idx) => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI || v.name || String(idx);
    opt.textContent = `${v.name} — ${v.lang}` + (v.default ? ' (default)' : '');
    voiceSelect.appendChild(opt);
  });
  // restore selection if available
  if (selectedVoiceURI) {
    const match = Array.from(voiceSelect.options).find(o => o.value === selectedVoiceURI);
    if (match) voiceSelect.value = selectedVoiceURI;
  }
}

function getSelectedVoice() {
  if (!availableVoices || !availableVoices.length) return null;
  const val = voiceSelect && voiceSelect.value;
  if (!val) return availableVoices[0];
  return availableVoices.find(v => (v.voiceURI || v.name) === val) || availableVoices[0];
}

// auto-select Vietnamese voice if available
function autoSelectVietnamese() {
  if (!availableVoices || !availableVoices.length) return false;
  const vi = availableVoices.find(v => (v.lang && v.lang.toLowerCase().startsWith('vi')) || /viet/i.test(v.name));
  if (vi) {
    const id = vi.voiceURI || vi.name;
    selectedVoiceURI = id;
    localStorage.setItem('mag-voice-uri', id);
    if (voiceSelect) voiceSelect.value = id;
    return true;
  }
  return false;
}

// react to voiceschanged
if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener('voiceschanged', populateVoices);
}

if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    selectedVoiceURI = voiceSelect.value;
    localStorage.setItem('mag-voice-uri', selectedVoiceURI);
  });
}

if (autoViBtn) {
  autoViBtn.addEventListener('click', () => {
    const ok = autoSelectVietnamese();
    if (!ok) alert('No Vietnamese voice found in your browser. Try installing or enabling Vietnamese voices in system settings.');
  });
}

// Trigger initial populate (may be empty until voiceschanged fires)
setTimeout(populateVoices, 0);

let current = 0; // index 0..TOTAL_PAGES-1 (cover is 0 -> image '1.png')
let editMode = false;
// By default do not visually show hotspot rectangles. They remain clickable.
let showHotspots = false;
let pages = [];
let hotspots = {}; // map image filename -> array of hotspot objects {x,y,w,h,text}
let drawing = null; // {startX,startY,el,container,img}
let activeUtterance = null;
let activeHotspotEl = null;
let activeAudio = null;
let audioManifest = {};

// Build fallback pages array referencing images named 1.png..N.png
for (let i = 1; i <= TOTAL_PAGES; i++) {
  const filename = `${i}.png`;
  pages.push({img: filename });
}

// Try to load a local hotspots.json file (next to index.html) and use it by default.
// If not available, fall back to localStorage or the generated pages above.
async function tryLoadHotspotsFile() {
  try {
    const resp = await fetch('./hotspots.json', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.pages && Array.isArray(data.pages)) pages = data.pages;
    if (data.hotspots) hotspots = data.hotspots;
    console.log('Loaded hotspots from hotspots.json');
  } catch (err) {
    // fetch may fail on file:// in some browsers — ignore and continue
    console.warn('Could not load hotspots.json (ok if running file://):', err);
  }
}

async function tryLoadAudioManifest() {
  try {
    const resp = await fetch('./hotspot_audio_manifest.json', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    audioManifest = data || {};
    console.log('Loaded audio manifest from hotspot_audio_manifest.json');
  } catch (err) {
    console.warn('Could not load hotspot_audio_manifest.json:', err);
  }
}

// Try to load saved hotspots from localStorage
function loadSavedHotspots() {
  try {
    const raw = localStorage.getItem('mag-hotspots');
    if (raw) hotspots = JSON.parse(raw) || {};
  } catch (e) { console.warn('Failed to load hotspots', e); hotspots = {}; }
}

function saveHotspots() {
  try { localStorage.setItem('mag-hotspots', JSON.stringify(hotspots)); } catch(e){ console.warn(e); }
}

function render() {
  viewer.innerHTML = '';
  const total = pages.length;
  pageIndicator.textContent = `Page ${current + 1} / ${total}`;

  if (current === 0) {
    const pageEl = createImagePage(pages[0], true);
    viewer.appendChild(pageEl);
  } else {
    const left = createImagePage(pages[current]);
    viewer.appendChild(left);
    const rightIndex = current + 1;
    if (rightIndex < pages.length) {
      const right = createImagePage(pages[rightIndex]);
      viewer.appendChild(right);
    } else {
      const spacer = document.createElement('div');
      spacer.className = 'page';
      viewer.appendChild(spacer);
    }
  }

  prevBtn.disabled = (current === 0);
  nextBtn.disabled = (current >= pages.length - 1);
}

function createImagePage(page, isCover = false) {
  const pageEl = document.createElement('article');
  pageEl.className = 'page' + (isCover ? ' cover' : '');
  const h = document.createElement('h2');
  pageEl.appendChild(h);

  const container = document.createElement('div');
  container.className = 'image-container';
  const img = document.createElement('img');
  // Resolve image path robustly. Common cases:
  // - page.img is a bare filename like '1.png' -> ./public/pages/1.png
  // - page.img already contains 'public/pages/..' or './public/pages/..' -> keep (normalize to ./)
  // - page.img points elsewhere (data: or absolute) -> use as provided
  let imgSrc = page.img || '';
  if (imgSrc && !imgSrc.startsWith('data:')) {
    // bare filename (no slash) -> assume ./public/pages/<file>
    if (!imgSrc.includes('/') && !imgSrc.startsWith('./') && !imgSrc.startsWith('../')) {
      imgSrc = `./public/pages/${imgSrc}`;
    } else if (imgSrc.startsWith('public/')) {
      // ensure relative path has ./ prefix
      imgSrc = './' + imgSrc;
    } else if (imgSrc.startsWith('pages/')) {
      // migrate old pages/ -> public/pages/
      imgSrc = './public/' + imgSrc.split('/').slice(1).join('/');
    }
  }
  // final assignment
  img.src = imgSrc;
  img.style.zIndex = '1';
  container.appendChild(img);

  // overlay for hotspots
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.position = 'absolute';
  overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.right='0'; overlay.style.bottom='0';
  overlay.style.pointerEvents = 'auto';
  overlay.style.zIndex = '2';
  container.appendChild(overlay);

  // once image sizes, position overlay properly
  img.addEventListener('load', () => {
    overlay.style.width = img.clientWidth + 'px';
    overlay.style.height = img.clientHeight + 'px';
    overlay.style.left = img.offsetLeft + 'px';
    overlay.style.top = img.offsetTop + 'px';
    renderHotspotsForImage(page.img, overlay, img);
  });
  // If image already loaded (cache), ensure overlay is sized and hotspots rendered immediately
  if (img.complete) {
    // run in next tick to ensure layout values are available
    setTimeout(() => {
      overlay.style.width = img.clientWidth + 'px';
      overlay.style.height = img.clientHeight + 'px';
      overlay.style.left = img.offsetLeft + 'px';
      overlay.style.top = img.offsetTop + 'px';
      renderHotspotsForImage(page.img, overlay, img);
    }, 0);
  }

  // keep overlay in sync when image/container resizes using ResizeObserver
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      // update overlay size/position and re-render hotspots
      overlay.style.width = img.clientWidth + 'px';
      overlay.style.height = img.clientHeight + 'px';
      overlay.style.left = img.offsetLeft + 'px';
      overlay.style.top = img.offsetTop + 'px';
      renderHotspotsForImage(page.img, overlay, img);
    });
    try { ro.observe(img); } catch (e) { /* ignore */ }
  }

  // editing handlers
  overlay.addEventListener('mousedown', (ev) => {
    if (!editMode) return;
    ev.preventDefault();
    startDrawing(ev, overlay, img, page.img);
  });

  overlay.addEventListener('mousemove', (ev) => {
    if (!editMode) return;
    continueDrawing(ev);
  });

  window.addEventListener('mouseup', (ev) => {
    if (!editMode) return;
    finishDrawing(ev, page.img);
  });

  pageEl.appendChild(container);
  return pageEl;
}

function renderHotspotsForImage(imgName, overlay, imgEl) {
  // clear existing
  overlay.innerHTML = '';
  const list = hotspots[imgName] || [];
  list.forEach((hs, idx) => {
    const el = document.createElement('div');
    el.className = 'hotspot';
    // position using percentages
    el.style.left = (hs.x * 100) + '%';
    el.style.top = (hs.y * 100) + '%';
    el.style.width = (hs.w * 100) + '%';
    el.style.height = (hs.h * 100) + '%';
    el.title = hs.text || 'Hotspot';
    el.dataset.idx = idx;
  el.dataset.img = imgName;
    // Show rectangles only when explicitly enabled or when in edit mode
    const visible = showHotspots || editMode;
    if (!visible) {
      // make invisible but keep clickable
      el.style.background = 'transparent';
      el.style.border = 'none';
    }
    el.addEventListener('click', (e) => { e.stopPropagation(); onHotspotClick(hs, el); });
    overlay.appendChild(el);
  });
}

function onHotspotClick(hs, el) {
  // toggle reading for this hotspot
  if (activeHotspotEl && activeHotspotEl !== el) stopSpeech();

  // If there is a generated audio clip for this hotspot, play it instead of TTS
  const img = el.dataset.img;
  const idx = parseInt(el.dataset.idx, 10);
  const list = audioManifest[img] || [];
  const entry = list.find(it => it.index === idx);
  if (entry) {
    const raw = entry.audio || '';
    // normalize path separators
    let rel = raw.replace(/\\/g, '/');
    // Build candidate URLs, preferring the explicit public/hotspot_audio folder where pre-generated files live
    const imgBase = (img || '').split('/').pop().split('\\').pop().split('.').slice(0, -1).join('.') || img;
    const cand1 = `./public/hotspot_audio/${imgBase}_${idx}.wav`;
    const cand2 = `./hotspot_audio/${imgBase}_${idx}.wav`;
    const cand3 = `./public/hotspot_audio/${rel.split('/').pop()}`;
  const cand4 = `./${rel}`.replace(/\//g, '/');
    const candidates = [cand1, cand2, cand3, cand4];

    // toggle playback if same
    if (activeAudio && !activeAudio.paused && candidates.includes(activeAudio._src) && activeHotspotEl === el) {
      stopSpeech();
      return;
    }
    stopSpeech();

    const tryPlay = async (list) => {
      for (const u of list) {
        try {
          const audio = new Audio(u);
          audio._src = u;
          // mark as active immediately so stopSpeech() can cancel it if another click happens
          activeAudio = audio; activeHotspotEl = el; el.classList.add('reading');
          audio.addEventListener('ended', () => { if (activeHotspotEl) activeHotspotEl.classList.remove('reading'); activeAudio = null; activeHotspotEl = null; });
          // try to play (must be triggered by user gesture - this click qualifies)
          try {
            await audio.play();
            return true;
          } catch (playErr) {
            // playback failed; clear the active markers we set and try next candidate
            if (activeHotspotEl === el) activeHotspotEl.classList.remove('reading');
            if (activeAudio === audio) activeAudio = null;
            activeHotspotEl = null;
            console.warn('Audio play failed for', u, playErr);
            continue;
          }
        } catch (err) {
          // try next candidate
          console.warn('Audio tryPlay outer error for', u, err);
          // ensure we clear any partial active state
          if (activeHotspotEl === el) activeHotspotEl.classList.remove('reading');
          if (activeAudio && activeAudio._src === u) activeAudio = null;
          activeHotspotEl = null;
          continue;
        }
      }
      return false;
    };

    tryPlay(candidates).then(ok => {
      if (!ok) {
        console.warn('No playable audio candidate found for', img, idx, candidates);
      }
    });
    return;
  }

  // If manifest entry wasn't found, still attempt a sensible default filename in public/hotspot_audio
  // This helps when running the viewer via file:// where fetching the manifest may fail.
  const imgBaseFallback = (img || '').split('/').pop().split('\\').pop().split('.').slice(0, -1).join('.') || img;
  const fallbackCandidates = [
    `./public/hotspot_audio/${imgBaseFallback}_${idx}.wav`,
    `./hotspot_audio/${imgBaseFallback}_${idx}.wav`,
  ];

  const tryPlayFallback = async (list) => {
    for (const u of list) {
      try {
        const audio = new Audio(u);
        audio._src = u;
        // mark active immediately so stopSpeech() can work reliably
        activeAudio = audio; activeHotspotEl = el; el.classList.add('reading');
        audio.addEventListener('ended', () => { if (activeHotspotEl) activeHotspotEl.classList.remove('reading'); activeAudio = null; activeHotspotEl = null; });
        try {
          await audio.play();
          return true;
        } catch (playErr) {
          if (activeHotspotEl === el) activeHotspotEl.classList.remove('reading');
          if (activeAudio === audio) activeAudio = null;
          activeHotspotEl = null;
          console.warn('Fallback audio play failed for', u, playErr);
          continue;
        }
      } catch (err) {
        console.warn('Fallback audio outer error for', u, err);
        if (activeHotspotEl === el) activeHotspotEl.classList.remove('reading');
        if (activeAudio && activeAudio._src === u) activeAudio = null;
        activeHotspotEl = null;
        continue;
      }
    }
    return false;
  };

  tryPlayFallback(fallbackCandidates).then(ok => {
    if (ok) return; // played a fallback audio
    // fallback to speech synthesis if no audio played
    if (activeUtterance && speechSynthesis.speaking && activeHotspotEl === el) { stopSpeech(); return; }
    startSpeech(hs.text, el);
  });
}

function startSpeech(text, el) {
  if (!('speechSynthesis' in window)) { alert('Speech synthesis not supported.'); return; }
  const u = new SpeechSynthesisUtterance(text);
  // read rate/pitch safely (controls may be hidden/removed)
  try { u.rate = rateInput ? parseFloat(rateInput.value) || 1 : 1; } catch (e) { u.rate = 1; }
  try { u.pitch = pitchInput ? parseFloat(pitchInput.value) || 1 : 1; } catch (e) { u.pitch = 1; }
  // attach selected voice if available
  const sel = getSelectedVoice();
  if (sel) u.voice = sel;
  u.onend = () => { if (el) el.classList.remove('reading'); activeUtterance = null; activeHotspotEl = null; };
  u.onerror = () => { if (el) el.classList.remove('reading'); activeUtterance = null; activeHotspotEl = null; };
  activeUtterance = u; activeHotspotEl = el; if (el) el.classList.add('reading'); speechSynthesis.speak(u);
}

function stopSpeech() {
  // stop audio playback if any
  try {
    if (activeAudio) {
      try { activeAudio.pause(); } catch (e) {}
      try { activeAudio.currentTime = 0; } catch (e) {}
      activeAudio = null;
    }
  } catch (e) { /* ignore */ }
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  if (activeHotspotEl) activeHotspotEl.classList.remove('reading');
  activeUtterance = null; activeHotspotEl = null;
}

// Drawing helpers: record start, update rectangle, finalize and prompt for text
function startDrawing(ev, overlay, img, imgName) {
  const rect = overlay.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const el = document.createElement('div');
  el.className = 'drawing-rect';
  el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.width = '0px'; el.style.height = '0px';
  overlay.appendChild(el);
  drawing = { startX: x, startY: y, el, overlay, img, imgName, containerRect: rect };
}

function continueDrawing(ev) {
  if (!drawing) return;
  const rect = drawing.containerRect;
  const x = Math.max(0, Math.min(ev.clientX - rect.left, drawing.overlay.clientWidth));
  const y = Math.max(0, Math.min(ev.clientY - rect.top, drawing.overlay.clientHeight));
  const sx = drawing.startX, sy = drawing.startY;
  const left = Math.min(sx, x), top = Math.min(sy, y);
  const w = Math.abs(x - sx), h = Math.abs(y - sy);
  drawing.el.style.left = left + 'px'; drawing.el.style.top = top + 'px';
  drawing.el.style.width = w + 'px'; drawing.el.style.height = h + 'px';
}

function finishDrawing(ev, imgName) {
  if (!drawing) return;
  const rect = drawing.containerRect;
  const el = drawing.el;
  // convert to normalized coords relative to image displayed size
  const left = parseFloat(el.style.left);
  const top = parseFloat(el.style.top);
  const w = parseFloat(el.style.width);
  const h = parseFloat(el.style.height);
  // normalize by overlay (which matches image display size)
  const nx = left / drawing.overlay.clientWidth;
  const ny = top / drawing.overlay.clientHeight;
  const nw = w / drawing.overlay.clientWidth;
  const nh = h / drawing.overlay.clientHeight;

  // remove drawing rect
  el.remove();
  drawing = null;

  // ignore tiny rects
  if (nw < 0.01 || nh < 0.01) return;

  const text = prompt('Enter passage text for this hotspot:');
  if (!text) return;
  if (!hotspots[imgName]) hotspots[imgName] = [];
  hotspots[imgName].push({ x: nx, y: ny, w: nw, h: nh, text });
  saveHotspots();
  render();
}

// Export/import (only wire handlers if elements exist)
if (typeof exportBtn !== 'undefined' && exportBtn) {
  exportBtn.addEventListener('click', () => {
    const data = { pages, hotspots };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'hotspots.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
}

if (typeof importFile !== 'undefined' && importFile) {
  importFile.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // Accept both {hotspots:...} and full structure
        if (data.pages && Array.isArray(data.pages)) pages = data.pages;
        if (data.hotspots) hotspots = data.hotspots;
        if (!data.hotspots && !data.pages) {
          alert('JSON format not recognized. Expecting {pages: [...], hotspots: {...}} or exported file.');
          return;
        }
        saveHotspots();
        render();
        alert('Hotspots imported.');
      } catch (err) { alert('Failed to read JSON: '+err.message); }
    };
    reader.readAsText(f);
  });
}

// Toggle edit mode (guarded)
if (typeof editToggle !== 'undefined' && editToggle) {
  editToggle.addEventListener('click', () => {
    editMode = !editMode;
    editToggle.textContent = editMode ? 'Exit Edit' : 'Edit Hotspots';
    // briefly notify
    editToggle.style.background = editMode ? '#eef6ff' : '#fff';
  });
}

// Stop button handler (if present)
if (typeof stopBtn !== 'undefined' && stopBtn) {
  stopBtn.addEventListener('click', () => {
    stopSpeech();
  });
}

// Navigation
prevBtn.addEventListener('click', () => {
  if (current === 0) return;
  if (current === 1) current = 0; else current = Math.max(1, current - 2);
  stopSpeech(); render();
});
nextBtn.addEventListener('click', () => {
  if (current === 0) current = 1; else current = Math.min(pages.length - 1, current + 2);
  stopSpeech(); render();
});

window.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') prevBtn.click(); if (e.key === 'ArrowRight') nextBtn.click(); });

// init: try to load hotspots.json first, otherwise load from localStorage
(async () => {
  // load audio manifest and hotspots, then render
  await tryLoadAudioManifest();
  await tryLoadHotspotsFile();
  // If hotspots were not loaded from file, try localStorage
  if (!Object.keys(hotspots).length) loadSavedHotspots();
  render();
})();

// expose for debugging
window.__mag = { pages, hotspots, saveHotspots };
