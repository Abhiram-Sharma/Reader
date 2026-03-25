/**
 * app.js — Personal Book Reader
 * ──────────────────────────────
 * Main application logic: library rendering, PDF.js integration,
 * page navigation, zoom controls, theme persistence, keyboard shortcuts,
 * and touch gesture support.
 */

/* ═══════════════════════════════════════════════════════════════
   PDF.js Setup
   ═══════════════════════════════════════════════════════════════ */

// Import PDF.js from CDN (loaded as ES module)
const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs');

// Set the worker source for PDF.js (required for rendering)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';

/* ═══════════════════════════════════════════════════════════════
   DOM Element References
   ═══════════════════════════════════════════════════════════════ */

const DOM = {
  // Views
  libraryView: document.getElementById('library-view'),
  readerView: document.getElementById('reader-view'),

  // Library
  bookGrid: document.getElementById('book-grid'),
  libraryEmpty: document.getElementById('library-empty'),

  // Reader
  canvas: document.getElementById('pdf-canvas'),
  readerContainer: document.getElementById('reader-container'),
  loadingSpinner: document.getElementById('loading-spinner'),
  bookTitleDisplay: document.getElementById('book-title-display'),

  // Controls
  btnBack: document.getElementById('btn-back'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnFitWidth: document.getElementById('btn-fit-width'),
  pageInput: document.getElementById('page-input'),
  pageTotal: document.getElementById('page-total'),
  zoomLevel: document.getElementById('zoom-level'),

  // Theme toggles (both library and reader)
  themeToggles: [
    document.getElementById('theme-toggle-library'),
    document.getElementById('theme-toggle-reader'),
  ],
};

/* ═══════════════════════════════════════════════════════════════
   Application State
   ═══════════════════════════════════════════════════════════════ */

const state = {
  /** @type {import('pdfjs-dist').PDFDocumentProxy | null} */
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  scale: 1.5,        // Default zoom scale
  rendering: false,   // Guard to prevent concurrent renders
  pendingPage: null,  // Queued page number while rendering
  books: [],          // Loaded book manifest
};

// Zoom constraints
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.25;

/* ═══════════════════════════════════════════════════════════════
   Theme Management
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initializes theme from localStorage or system preference.
 */
function initTheme() {
  const saved = localStorage.getItem('reader-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else {
    // Respect system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  }
}

/**
 * Toggles between light and dark themes.
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('reader-theme', next);
}

/* ═══════════════════════════════════════════════════════════════
   Library — Book Grid
   ═══════════════════════════════════════════════════════════════ */

/**
 * Fetches books.json and renders book cards into the grid.
 */
async function loadLibrary() {
  try {
    const response = await fetch('books.json');
    if (!response.ok) throw new Error('books.json not found');
    state.books = await response.json();

    if (state.books.length === 0) {
      DOM.libraryEmpty.style.display = 'block';
      return;
    }

    DOM.bookGrid.innerHTML = '';
    state.books.forEach((book, index) => {
      const card = createBookCard(book, index);
      DOM.bookGrid.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load library:', err);
    DOM.libraryEmpty.style.display = 'block';
  }
}

/**
 * Creates a single book card element.
 * @param {Object} book - Book data from manifest
 * @param {number} index - Index for staggered animation
 * @returns {HTMLElement}
 */
function createBookCard(book, index) {
  const card = document.createElement('div');
  card.className = 'book-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Read ${book.title}`);
  card.style.animationDelay = `${index * 0.08}s`;

  // Gradient colors from manifest
  const [colorA, colorB] = book.colors || ['#667eea', '#764ba2'];

  card.innerHTML = `
    <div class="book-cover" style="background: linear-gradient(135deg, ${colorA}, ${colorB});">
      <span class="book-cover-icon">📖</span>
    </div>
    <div class="book-info">
      <div class="book-title">${escapeHtml(book.title)}</div>
      <div class="book-subtitle">PDF • Click to read</div>
    </div>
  `;

  // Click handler → open book in reader
  card.addEventListener('click', () => openBook(book));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openBook(book);
    }
  });

  return card;
}

/**
 * Escapes HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════
   Reader — PDF Rendering with PDF.js
   ═══════════════════════════════════════════════════════════════ */

/**
 * Opens a book in the reader view.
 * @param {Object} book - Book data { title, file }
 */
async function openBook(book) {
  // Switch views
  DOM.libraryView.classList.add('hidden');
  DOM.readerView.classList.remove('hidden');

  // Update title display
  DOM.bookTitleDisplay.textContent = book.title;

  // Show loading spinner
  DOM.loadingSpinner.classList.remove('fade-out');
  DOM.loadingSpinner.style.display = 'flex';

  // Push state for browser back navigation
  history.pushState({ view: 'reader', book: book.file }, '', `#read/${encodeURIComponent(book.title)}`);

  try {
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument(book.file);
    state.pdfDoc = await loadingTask.promise;
    state.totalPages = state.pdfDoc.numPages;
    state.currentPage = 1;

    // Update page total display
    DOM.pageTotal.textContent = state.totalPages;
    DOM.pageInput.max = state.totalPages;

    // Calculate fit-to-width scale
    await calculateFitWidth();

    // Render the first page
    await renderPage(state.currentPage);

    // Hide spinner with fade animation
    DOM.loadingSpinner.classList.add('fade-out');
    setTimeout(() => {
      DOM.loadingSpinner.style.display = 'none';
    }, 350);
  } catch (err) {
    console.error('Failed to load PDF:', err);
    DOM.loadingSpinner.innerHTML = `
      <p style="color: var(--text-secondary);">❌ Failed to load book. The file may be missing or corrupted.</p>
    `;
  }
}

/**
 * Renders a specific page of the loaded PDF onto the canvas.
 * @param {number} pageNum - 1-based page number
 */
async function renderPage(pageNum) {
  if (!state.pdfDoc) return;

  // Guard against concurrent renders
  if (state.rendering) {
    state.pendingPage = pageNum;
    return;
  }
  state.rendering = true;

  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });

    // Set canvas dimensions (use devicePixelRatio for sharp rendering)
    const dpr = window.devicePixelRatio || 1;
    const canvas = DOM.canvas;
    const ctx = canvas.getContext('2d');

    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Render the page
    await page.render({
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    // Update UI state
    state.currentPage = pageNum;
    DOM.pageInput.value = pageNum;
    updateNavigationButtons();
    updateZoomDisplay();

    // Scroll to top of page
    DOM.readerContainer.scrollTop = 0;

  } catch (err) {
    console.error(`Failed to render page ${pageNum}:`, err);
  } finally {
    state.rendering = false;

    // If a page was queued during render, render it now
    if (state.pendingPage !== null) {
      const pending = state.pendingPage;
      state.pendingPage = null;
      renderPage(pending);
    }
  }
}

/**
 * Calculates the scale needed to fit the PDF page width to the container.
 */
async function calculateFitWidth() {
  if (!state.pdfDoc) return;

  const page = await state.pdfDoc.getPage(1);
  const unscaledViewport = page.getViewport({ scale: 1 });
  const containerWidth = DOM.readerContainer.clientWidth - 48; // account for padding

  state.scale = Math.min(containerWidth / unscaledViewport.width, ZOOM_MAX);
  state.scale = Math.max(state.scale, ZOOM_MIN);
}

/* ═══════════════════════════════════════════════════════════════
   Navigation Controls
   ═══════════════════════════════════════════════════════════════ */

/** Go to the previous page */
function prevPage() {
  if (state.currentPage > 1) {
    renderPage(state.currentPage - 1);
  }
}

/** Go to the next page */
function nextPage() {
  if (state.currentPage < state.totalPages) {
    renderPage(state.currentPage + 1);
  }
}

/** Navigate to a specific page number */
function goToPage(pageNum) {
  const num = parseInt(pageNum, 10);
  if (isNaN(num) || num < 1 || num > state.totalPages) return;
  renderPage(num);
}

/** Updates the disabled state of prev/next buttons */
function updateNavigationButtons() {
  DOM.btnPrev.disabled = state.currentPage <= 1;
  DOM.btnNext.disabled = state.currentPage >= state.totalPages;
}

/* ═══════════════════════════════════════════════════════════════
   Zoom Controls
   ═══════════════════════════════════════════════════════════════ */

/** Zoom in by one step */
function zoomIn() {
  if (state.scale < ZOOM_MAX) {
    state.scale = Math.min(state.scale + ZOOM_STEP, ZOOM_MAX);
    renderPage(state.currentPage);
  }
}

/** Zoom out by one step */
function zoomOut() {
  if (state.scale > ZOOM_MIN) {
    state.scale = Math.max(state.scale - ZOOM_STEP, ZOOM_MIN);
    renderPage(state.currentPage);
  }
}

/** Fit the page width to the container */
async function fitWidth() {
  await calculateFitWidth();
  renderPage(state.currentPage);
}

/** Updates the zoom level percentage display */
function updateZoomDisplay() {
  const percent = Math.round(state.scale * 100 / 1.5 * 100) / 100;
  DOM.zoomLevel.textContent = `${Math.round(percent)}%`;
}

/* ═══════════════════════════════════════════════════════════════
   View Switching
   ═══════════════════════════════════════════════════════════════ */

/** Returns to the library view */
function backToLibrary() {
  DOM.readerView.classList.add('hidden');
  DOM.libraryView.classList.remove('hidden');

  // Clean up PDF document
  if (state.pdfDoc) {
    state.pdfDoc.destroy();
    state.pdfDoc = null;
  }

  // Reset URL hash
  history.pushState({ view: 'library' }, '', window.location.pathname);
}

/* ═══════════════════════════════════════════════════════════════
   Event Listeners
   ═══════════════════════════════════════════════════════════════ */

// ─── Theme toggles ──────────────────────────────────────────
DOM.themeToggles.forEach(btn => {
  if (btn) btn.addEventListener('click', toggleTheme);
});

// ─── Reader controls ────────────────────────────────────────
DOM.btnBack.addEventListener('click', backToLibrary);
DOM.btnPrev.addEventListener('click', prevPage);
DOM.btnNext.addEventListener('click', nextPage);
DOM.btnZoomIn.addEventListener('click', zoomIn);
DOM.btnZoomOut.addEventListener('click', zoomOut);
DOM.btnFitWidth.addEventListener('click', fitWidth);

// ─── Page input (Enter to navigate, blur to navigate) ───────
DOM.pageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    goToPage(DOM.pageInput.value);
    DOM.pageInput.blur();
  }
});

DOM.pageInput.addEventListener('change', () => {
  goToPage(DOM.pageInput.value);
});

// ─── Keyboard shortcuts (only in reader view) ───────────────
document.addEventListener('keydown', (e) => {
  // Only handle shortcuts when reader is visible
  if (DOM.readerView.classList.contains('hidden')) return;

  // Don't capture when typing in page input
  if (document.activeElement === DOM.pageInput) return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault();
      prevPage();
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault();
      nextPage();
      break;
    case '+':
    case '=':
      e.preventDefault();
      zoomIn();
      break;
    case '-':
    case '_':
      e.preventDefault();
      zoomOut();
      break;
    case '0':
      e.preventDefault();
      fitWidth();
      break;
    case 'Escape':
      backToLibrary();
      break;
  }
});

// ─── Browser back/forward navigation ────────────────────────
window.addEventListener('popstate', (e) => {
  if (!e.state || e.state.view === 'library') {
    // Show library
    DOM.readerView.classList.add('hidden');
    DOM.libraryView.classList.remove('hidden');
    if (state.pdfDoc) {
      state.pdfDoc.destroy();
      state.pdfDoc = null;
    }
  }
});

// ─── Touch gestures for mobile swipe navigation ─────────────
let touchStartX = 0;
let touchStartY = 0;

DOM.readerContainer.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

DOM.readerContainer.addEventListener('touchend', (e) => {
  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;

  const deltaX = touchEndX - touchStartX;
  const deltaY = touchEndY - touchStartY;

  // Require a minimum horizontal swipe distance, and horizontal > vertical
  if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
    if (deltaX > 0) {
      prevPage();  // Swipe right → previous page
    } else {
      nextPage();  // Swipe left → next page
    }
  }
}, { passive: true });

// ─── Window resize → recalculate fit-width if in reader ─────
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(async () => {
    if (!DOM.readerView.classList.contains('hidden') && state.pdfDoc) {
      await fitWidth();
    }
  }, 250);
});

/* ═══════════════════════════════════════════════════════════════
   Initialization
   ═══════════════════════════════════════════════════════════════ */

initTheme();
loadLibrary();
