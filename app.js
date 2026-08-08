/**
 * app.js — UI logic for Pressed. Talks to storage only through DB
 * (see db.js). No network calls anywhere in this file.
 */
(() => {
  'use strict';

  /* ---------------------------------------------------------
     Small DOM helpers
     --------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const views = {
    library: $('#view-library'),
    add: $('#view-add'),
    details: $('#view-details'),
    post: $('#view-post'),
  };

  let activeObjectUrls = new Set();
  function trackedObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    activeObjectUrls.add(url);
    return url;
  }
  function revokeUrl(url) {
    if (activeObjectUrls.has(url)) {
      URL.revokeObjectURL(url);
      activeObjectUrls.delete(url);
    }
  }
  function revokeAllTracked() {
    activeObjectUrls.forEach((u) => URL.revokeObjectURL(u));
    activeObjectUrls.clear();
  }

  /* ---------------------------------------------------------
     Toast / loading / dialog utilities
     --------------------------------------------------------- */
  let toastTimer = null;
  function toast(message, { error = false } = {}) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    el.className = 'toast' + (error ? ' toast--error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function setLoading(isLoading) {
    $('#loading-veil').hidden = !isLoading;
  }

  function showDialog({ title, body, confirmLabel = 'Delete', danger = true, onConfirm }) {
    const backdrop = $('#dialog-backdrop');
    $('#dialog-title').textContent = title;
    $('#dialog-body').textContent = body;
    const confirmBtn = $('#dialog-confirm');
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = 'btn btn--block ' + (danger ? 'btn--danger' : 'btn--primary');
    backdrop.hidden = false;

    const cleanup = () => {
      backdrop.hidden = true;
      confirmBtn.removeEventListener('click', onOk);
      $('#dialog-cancel').removeEventListener('click', onCancel);
    };
    const onOk = () => { cleanup(); onConfirm(); };
    const onCancel = () => cleanup();
    confirmBtn.addEventListener('click', onOk);
    $('#dialog-cancel').addEventListener('click', onCancel);
  }

  function friendlyError(err, fallback) {
    if (err && err.name === 'DBError') return err.message;
    if (err && err.message) return fallback + ' (' + err.message + ')';
    return fallback;
  }

  /* ---------------------------------------------------------
     Router — simple hash-based navigation so the device Back
     button and browser history work as expected.
     Routes: #/library  #/add  #/edit/:id  #/flower/:id  #/post/:id
     --------------------------------------------------------- */
  function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [view, param] = hash.split('/');
    return { view: view || 'library', param };
  }

  function navigate(path) {
    location.hash = path;
  }

  async function router() {
    const { view, param } = currentRoute();
    closeActionSheet();

    Object.values(views).forEach((v) => v.classList.remove('is-active'));

    try {
      if (view === 'add') {
        await enterAddView(param || null);
        views.add.classList.add('is-active');
      } else if (view === 'flower' && param) {
        await enterDetailsView(param);
        views.details.classList.add('is-active');
      } else if (view === 'post' && param) {
        await enterPostView(param);
        views.post.classList.add('is-active');
      } else {
        await enterLibraryView();
        views.library.classList.add('is-active');
      }
    } catch (err) {
      toast(friendlyError(err, 'Something went wrong opening that screen.'), { error: true });
      views.library.classList.add('is-active');
      renderLibrary().catch(() => {});
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', router);

  /* ---------------------------------------------------------
     LIBRARY VIEW
     --------------------------------------------------------- */
  let allFlowers = [];
  let searchTerm = '';
  let sortMode = 'dateDesc';
  let libraryGridUrls = [];

  async function enterLibraryView() {
    $('#sort-select').value = sortMode;
    await renderLibrary();
  }

  async function renderLibrary() {
    setLoading(true);
    try {
      allFlowers = await DB.getAllFlowers();
    } catch (err) {
      setLoading(false);
      toast(friendlyError(err, 'Your flower library could not be loaded.'), { error: true });
      allFlowers = [];
    }
    setLoading(false);
    paintLibrary();
  }

  function applySearchAndSort(list) {
    let result = list;
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      result = result.filter((f) =>
        (f.name || '').toLowerCase().includes(q) ||
        (f.scientificName || '').toLowerCase().includes(q) ||
        (f.symbolism || '').toLowerCase().includes(q) ||
        (f.note || '').toLowerCase().includes(q)
      );
    }
    const sorted = [...result];
    switch (sortMode) {
      case 'dateAsc': sorted.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded)); break;
      case 'nameAsc': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'nameDesc': sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
      default: sorted.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
    }
    return sorted;
  }

  function paintLibrary() {
    const grid = $('#flower-grid');
    libraryGridUrls.forEach(revokeUrl);
    libraryGridUrls = [];
    grid.innerHTML = '';

    const list = applySearchAndSort(allFlowers);
    $('#flower-count').textContent = `${allFlowers.length} flower${allFlowers.length === 1 ? '' : 's'}`;

    const hasAny = allFlowers.length > 0;
    const hasResults = list.length > 0;

    $('#empty-state').hidden = hasAny;
    $('#no-results-state').hidden = !hasAny || hasResults;
    grid.hidden = !hasResults;

    list.forEach((flower, i) => {
      const card = document.createElement('div');
      card.className = 'flower-card';
      card.style.animationDelay = Math.min(i, 10) * 25 + 'ms';
      card.setAttribute('role', 'listitem');
      card.tabIndex = 0;

      const photoWrap = document.createElement('div');
      photoWrap.className = 'flower-card__photo-wrap';

      if (flower.photoBlob) {
        const url = trackedObjectUrl(flower.photoBlob);
        libraryGridUrls.push(url);
        const img = document.createElement('img');
        img.className = 'flower-card__photo';
        img.loading = 'lazy';
        img.src = url;
        img.alt = flower.name;
        photoWrap.appendChild(img);
      } else {
        photoWrap.style.background = 'var(--ivory-deep)';
      }

      const tag = document.createElement('span');
      tag.className = 'flower-card__tag';
      tag.textContent = formatShortDate(flower.dateAdded);
      photoWrap.appendChild(tag);

      const label = document.createElement('div');
      label.className = 'flower-card__label';
      const name = document.createElement('p');
      name.className = 'flower-card__name';
      name.textContent = flower.name;
      label.appendChild(name);
      if (flower.scientificName) {
        const sci = document.createElement('p');
        sci.className = 'flower-card__species';
        sci.textContent = flower.scientificName;
        label.appendChild(sci);
      }

      card.appendChild(photoWrap);
      card.appendChild(label);

      const open = () => navigate(`/flower/${flower.id}`);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });

      grid.appendChild(card);
    });
  }

  function formatShortDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }
  function formatLongDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    } catch {
      return 'an unknown date';
    }
  }

  // search UI
  $('#btn-open-search').addEventListener('click', () => {
    $('#search-row').hidden = false;
    $('#search-input').focus();
  });
  $('#btn-close-search').addEventListener('click', () => {
    $('#search-row').hidden = true;
    $('#search-input').value = '';
    searchTerm = '';
    paintLibrary();
  });
  $('#search-input').addEventListener('input', (e) => {
    searchTerm = e.target.value;
    paintLibrary();
  });
  $('#btn-clear-search').addEventListener('click', () => {
    $('#btn-close-search').click();
  });
  $('#sort-select').addEventListener('change', (e) => {
    sortMode = e.target.value;
    paintLibrary();
  });
  $('#btn-add-flower').addEventListener('click', () => navigate('/add'));
  $('#btn-empty-add').addEventListener('click', () => navigate('/add'));

  /* ---------------------------------------------------------
     ADD / EDIT FLOWER
     --------------------------------------------------------- */
  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.85;
  const MAX_SOURCE_BYTES = 40 * 1024 * 1024; // 40MB sanity ceiling before we even try to decode

  let editingId = null;
  let pendingPhotoBlob = null;

  async function enterAddView(editId) {
    editingId = editId;
    pendingPhotoBlob = null;
    const form = $('#add-form');
    form.reset();
    setPhotoPreview(null);
    $('#photo-error').hidden = true;

    if (editId) {
      $('#add-title').textContent = 'Edit flower';
      $('#btn-save-flower').textContent = 'Save';
      setLoading(true);
      const flower = await DB.getFlower(editId);
      setLoading(false);
      if (!flower) {
        throw new DB.DBError('That flower could not be found — it may have already been deleted.');
      }
      $('#field-name').value = flower.name || '';
      $('#field-scientific').value = flower.scientificName || '';
      $('#field-symbolism').value = flower.symbolism || '';
      $('#field-note').value = flower.note || '';
      if (flower.photoBlob) {
        pendingPhotoBlob = flower.photoBlob;
        setPhotoPreview(flower.photoBlob);
      }
    } else {
      $('#add-title').textContent = 'Add a flower';
      $('#btn-save-flower').textContent = 'Save';
    }
  }

  function setPhotoPreview(blob) {
    const preview = $('#photo-preview');
    preview.innerHTML = '';
    if (blob) {
      const url = trackedObjectUrl(blob);
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Selected flower photo';
      img.onload = () => revokeUrl(url) || true; // keep alive; revoked on next preview swap instead
      preview.appendChild(img);
      preview.dataset.hasPhoto = 'true';
    } else {
      preview.innerHTML = `
        <svg viewBox="0 0 24 24" class="photo-picker__icon"><use href="#svg-camera"/></svg>
        <p>Add a photo</p>`;
      preview.dataset.hasPhoto = 'false';
    }
  }

  function resizeImageToBlob(file) {
    return new Promise((resolve, reject) => {
      if (!file.type || !file.type.startsWith('image/')) {
        reject(new Error('That file is not a photo Pressed can use. Please choose a JPEG, PNG, or WebP image.'));
        return;
      }
      if (file.size > MAX_SOURCE_BYTES) {
        reject(new Error('That photo is too large to import. Try a smaller photo or a screenshot of it.'));
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        try {
          let { width, height } = img;
          if (width <= 0 || height <= 0) {
            throw new Error('invalid dimensions');
          }
          const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
          const outW = Math.max(1, Math.round(width * scale));
          const outH = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, outW, outH);

          canvas.toBlob((blob) => {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              reject(new Error('Pressed could not process that photo. Please try a different one.'));
              return;
            }
            resolve(blob);
          }, 'image/jpeg', JPEG_QUALITY);
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('That photo appears to be corrupted or unreadable.'));
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('That photo could not be opened. It may be corrupted or in an unsupported format.'));
      };

      img.src = objectUrl;
    });
  }

  async function handleFileInput(input) {
    const file = input.files && input.files[0];
    input.value = ''; // allow re-selecting the same file later
    if (!file) return; // user cancelled — camera/gallery permission denial lands here too

    const errEl = $('#photo-error');
    errEl.hidden = true;
    setLoading(true);
    try {
      const blob = await resizeImageToBlob(file);
      pendingPhotoBlob = blob;
      setPhotoPreview(blob);
    } catch (err) {
      errEl.textContent = err.message || 'That photo could not be imported.';
      errEl.hidden = false;
      errEl.classList.add('field-hint--error');
    } finally {
      setLoading(false);
    }
  }

  $('#btn-choose-photo').addEventListener('click', () => $('#file-input-gallery').click());
  $('#btn-take-photo').addEventListener('click', () => {
    if (!navigator.mediaDevices && !('capture' in document.createElement('input'))) {
      toast('Camera capture is not supported on this device. Choose a photo instead.', { error: true });
      return;
    }
    $('#file-input-camera').click();
  });
  $('#file-input-gallery').addEventListener('change', (e) => handleFileInput(e.target));
  $('#file-input-camera').addEventListener('change', (e) => handleFileInput(e.target));

  $('#btn-add-back').addEventListener('click', () => history.back());

  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveFlowerFromForm();
  });
  $('#btn-save-flower').addEventListener('click', async () => {
    await saveFlowerFromForm();
  });

  async function saveFlowerFromForm() {
    const name = $('#field-name').value.trim();
    if (!name) {
      toast('Give this flower a name before saving.', { error: true });
      $('#field-name').focus();
      return;
    }
    if (!pendingPhotoBlob) {
      $('#photo-error').textContent = 'Add a photo before saving this flower.';
      $('#photo-error').hidden = false;
      $('#photo-error').classList.add('field-hint--error');
      window.scrollTo(0, 0);
      return;
    }

    const payload = {
      name,
      scientificName: $('#field-scientific').value.trim(),
      symbolism: $('#field-symbolism').value.trim(),
      note: $('#field-note').value.trim(),
      photoBlob: pendingPhotoBlob,
    };

    setLoading(true);
    try {
      let saved;
      if (editingId) {
        saved = await DB.updateFlower(editingId, payload);
        toast('Flower updated.');
      } else {
        saved = await DB.addFlower(payload);
        toast('Flower added to your journal.');
      }
      setLoading(false);
      navigate(`/flower/${saved.id}`);
    } catch (err) {
      setLoading(false);
      toast(friendlyError(err, 'That flower could not be saved.'), { error: true });
    }
  }

  /* ---------------------------------------------------------
     FLOWER DETAILS
     --------------------------------------------------------- */
  let currentFlower = null;
  let currentDetailsUrl = null;

  async function enterDetailsView(id) {
    if (currentDetailsUrl) { revokeUrl(currentDetailsUrl); currentDetailsUrl = null; }
    setLoading(true);
    const flower = await DB.getFlower(id);
    setLoading(false);
    if (!flower) {
      throw new DB.DBError('That flower could not be found — it may have already been deleted.');
    }
    currentFlower = flower;

    const photoEl = $('#details-photo');
    if (flower.photoBlob) {
      currentDetailsUrl = trackedObjectUrl(flower.photoBlob);
      photoEl.style.backgroundImage = `url("${currentDetailsUrl}")`;
    } else {
      photoEl.style.backgroundImage = 'none';
    }

    $('#details-date').textContent = 'Added ' + formatLongDate(flower.dateAdded);
    $('#details-name').textContent = flower.name;
    $('#details-scientific').textContent = flower.scientificName || '';
    $('#details-scientific').style.display = flower.scientificName ? '' : 'none';

    const symBlock = $('#details-symbolism-block');
    if (flower.symbolism) {
      $('#details-symbolism').textContent = flower.symbolism;
      symBlock.hidden = false;
    } else symBlock.hidden = true;

    const noteBlock = $('#details-note-block');
    if (flower.note) {
      $('#details-note').textContent = flower.note;
      noteBlock.hidden = false;
    } else noteBlock.hidden = true;
  }

  $('#btn-details-back').addEventListener('click', () => navigate('/library'));
  $('#btn-create-post').addEventListener('click', () => {
    if (currentFlower) navigate(`/post/${currentFlower.id}`);
  });
  $('#btn-edit-flower').addEventListener('click', () => {
    if (currentFlower) navigate(`/add/${currentFlower.id}`);
  });
  $('#btn-delete-flower').addEventListener('click', () => confirmDeleteCurrent());

  function confirmDeleteCurrent() {
    if (!currentFlower) return;
    showDialog({
      title: `Delete “${currentFlower.name}”?`,
      body: 'This removes it from Pressed on this device only. It will not delete the original photo from your gallery.',
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        setLoading(true);
        try {
          await DB.deleteFlower(currentFlower.id);
          setLoading(false);
          toast('Flower deleted from your journal.');
          navigate('/library');
        } catch (err) {
          setLoading(false);
          toast(friendlyError(err, 'That flower could not be deleted.'), { error: true });
        }
      },
    });
  }

  // action sheet (mobile "more" menu)
  function openActionSheet() {
    $('#sheet-backdrop').hidden = false;
    $('#details-sheet').hidden = false;
  }
  function closeActionSheet() {
    $('#sheet-backdrop').hidden = true;
    $('#details-sheet').hidden = true;
  }
  $('#btn-details-menu').addEventListener('click', openActionSheet);
  $('#sheet-backdrop').addEventListener('click', closeActionSheet);
  $('#sheet-cancel').addEventListener('click', closeActionSheet);
  $('#sheet-edit').addEventListener('click', () => {
    closeActionSheet();
    if (currentFlower) navigate(`/add/${currentFlower.id}`);
  });
  $('#sheet-delete').addEventListener('click', () => {
    closeActionSheet();
    confirmDeleteCurrent();
  });

  /* ---------------------------------------------------------
     CREATE POST — canvas-based templates
     --------------------------------------------------------- */
  const POST_W = 1080, POST_H = 1350;
  let postFlower = null;
  let postImageEl = null; // decoded <img> for drawing, reused across redraws
  let currentTemplate = 'minimal';
  let redrawRaf = null;

  async function enterPostView(id) {
    setLoading(true);
    let flower;
    try {
      flower = await DB.getFlower(id);
    } catch (err) {
      setLoading(false);
      throw err;
    }
    setLoading(false);
    if (!flower) throw new DB.DBError('That flower could not be found — it may have already been deleted.');
    if (!flower.photoBlob) throw new DB.DBError('This flower has no saved photo, so a post cannot be created from it.');

    postFlower = flower;
    currentTemplate = 'minimal';
    $$('.template-chip').forEach((c) => c.classList.toggle('is-active', c.dataset.template === 'minimal'));

    $('#post-field-name').value = flower.name || '';
    $('#post-field-scientific').value = flower.scientificName || '';
    $('#post-field-symbolism').value = flower.symbolism || '';
    $('#post-align').value = 'bottom';

    const url = trackedObjectUrl(flower.photoBlob);
    postImageEl = await loadImage(url).catch(() => null);
    revokeUrl(url);
    if (!postImageEl) {
      toast('This photo could not be loaded for the post preview.', { error: true });
    }
    scheduleRedraw();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  $('#btn-post-back').addEventListener('click', () => history.back());
  $$('.template-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      currentTemplate = chip.dataset.template;
      $$('.template-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      scheduleRedraw();
    });
  });
  ['post-field-name', 'post-field-scientific', 'post-field-symbolism', 'post-align'].forEach((id) => {
    $('#' + id).addEventListener('input', scheduleRedraw);
    $('#' + id).addEventListener('change', scheduleRedraw);
  });

  function scheduleRedraw() {
    if (redrawRaf) cancelAnimationFrame(redrawRaf);
    redrawRaf = requestAnimationFrame(drawPost);
  }

  function getPostText() {
    return {
      name: $('#post-field-name').value.trim() || postFlower?.name || '',
      scientific: $('#post-field-scientific').value.trim(),
      symbolism: $('#post-field-symbolism').value.trim(),
      align: $('#post-align').value,
    };
  }

  // ---- drawing helpers ----
  function coverDraw(ctx, img, x, y, w, h) {
    const ir = img.width / img.height, r = w / h;
    let sx, sy, sw, sh;
    if (ir > r) { sh = img.height; sw = sh * r; sy = 0; sx = (img.width - sw) / 2; }
    else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
  function wrapText(ctx, text, x, y, maxWidth, lineHeight, align = 'left') {
    if (!text) return y;
    const words = text.split(/\s+/);
    let line = '';
    let cy = y;
    const lines = [];
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    if (line) lines.push(line);
    lines.forEach((l) => {
      ctx.textAlign = align;
      ctx.fillText(l, x, cy);
      cy += lineHeight;
    });
    return cy;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPost() {
    const canvas = $('#post-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = POST_W; canvas.height = POST_H;
    ctx.clearRect(0, 0, POST_W, POST_H);

    const t = getPostText();
    const templates = {
      minimal: drawMinimal,
      journal: drawJournal,
      editorial: drawEditorial,
      polaroid: drawPolaroid,
      simple: drawSimple,
      plate: drawPlate,
      postcard: drawPostcard,
      quote: drawQuote,
      field: drawFieldGuide,
    };
    (templates[currentTemplate] || drawMinimal)(ctx, t);
  }

  function drawMinimal(ctx, t) {
    ctx.fillStyle = '#f3f0e6';
    ctx.fillRect(0, 0, POST_W, POST_H);
    const pad = 90;
    const photoH = t.align === 'center' ? POST_H - pad * 2 : 860;
    if (postImageEl) coverDraw(ctx, postImageEl, pad, pad, POST_W - pad * 2, photoH);

    if (t.align === 'center') {
      ctx.fillStyle = 'rgba(38,38,31,0.34)';
      ctx.fillRect(pad, pad, POST_W - pad * 2, photoH);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f3f0e6';
      ctx.font = '64px Georgia, serif';
      ctx.fillText(t.name, POST_W / 2, POST_H / 2 - 10);
      ctx.font = 'italic 32px Georgia, serif';
      ctx.fillStyle = '#cdd8c2';
      ctx.fillText(t.scientific, POST_W / 2, POST_H / 2 + 40);
      return;
    }

    let y = pad + photoH + 70;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1f3325';
    ctx.font = '58px Georgia, serif';
    ctx.fillText(t.name, POST_W / 2, y);
    y += 50;
    if (t.scientific) {
      ctx.font = 'italic 30px Georgia, serif';
      ctx.fillStyle = '#7c9473';
      ctx.fillText(t.scientific, POST_W / 2, y);
      y += 44;
    }
    if (t.symbolism) {
      ctx.strokeStyle = '#ddd5bf'; ctx.beginPath();
      ctx.moveTo(POST_W / 2 - 40, y + 10); ctx.lineTo(POST_W / 2 + 40, y + 10); ctx.stroke();
      ctx.font = '24px -apple-system, sans-serif';
      ctx.fillStyle = '#57574c';
      wrapText(ctx, t.symbolism, POST_W / 2, y + 60, POST_W - pad * 2.4, 34, 'center');
    }
  }

  function drawJournal(ctx, t) {
    ctx.fillStyle = '#eae4d2';
    ctx.fillRect(0, 0, POST_W, POST_H);
    // paper texture flecks
    ctx.fillStyle = 'rgba(38,38,31,0.035)';
    for (let i = 0; i < 260; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * POST_W, Math.random() * POST_H, Math.random() * 1.6, 0, 7);
      ctx.fill();
    }
    const pad = 70;
    const photoH = 760;
    ctx.save();
    ctx.shadowColor = 'rgba(38,38,31,0.25)';
    ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#fff';
    ctx.fillRect(pad - 14, pad - 14, POST_W - (pad - 14) * 2, photoH + 28);
    ctx.restore();
    if (postImageEl) coverDraw(ctx, postImageEl, pad, pad, POST_W - pad * 2, photoH);

    let y = pad + photoH + 74;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a9824f';
    ctx.font = '22px Courier, monospace';
    ctx.fillText('SPECIMEN No. 01', pad, y);
    y += 54;
    ctx.fillStyle = '#1f3325';
    ctx.font = '56px Georgia, serif';
    ctx.fillText(t.name, pad, y);
    y += 44;
    if (t.scientific) {
      ctx.font = 'italic 28px Georgia, serif';
      ctx.fillStyle = '#33503c';
      ctx.fillText(t.scientific, pad, y);
      y += 46;
    }
    if (t.symbolism) {
      ctx.font = '23px -apple-system, sans-serif';
      ctx.fillStyle = '#57574c';
      wrapText(ctx, 'Symbolism — ' + t.symbolism, pad, y, POST_W - pad * 2, 33, 'left');
    }
    ctx.strokeStyle = '#ddd5bf';
    ctx.strokeRect(30, 30, POST_W - 60, POST_H - 60);
  }

  function drawEditorial(ctx, t) {
    ctx.fillStyle = '#1f3325';
    ctx.fillRect(0, 0, POST_W, POST_H);
    if (postImageEl) coverDraw(ctx, postImageEl, 0, 0, POST_W, POST_H);
    const grad = ctx.createLinearGradient(0, POST_H * 0.35, 0, POST_H);
    grad.addColorStop(0, 'rgba(20,20,15,0)');
    grad.addColorStop(1, 'rgba(15,15,10,0.86)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, POST_W, POST_H);

    const pad = 80;
    let y = POST_H - 260;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(243,240,230,0.75)';
    ctx.font = '20px Courier, monospace';
    ctx.fillText(new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase(), pad, y);
    y += 66;
    ctx.fillStyle = '#f3f0e6';
    ctx.font = '72px Georgia, serif';
    ctx.fillText(t.name, pad, y);
    y += 50;
    if (t.scientific) {
      ctx.font = 'italic 32px Georgia, serif';
      ctx.fillStyle = '#cdd8c2';
      ctx.fillText(t.scientific, pad, y);
      y += 42;
    }
    if (t.symbolism) {
      ctx.font = '24px -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(243,240,230,0.85)';
      wrapText(ctx, t.symbolism, pad, y + 16, POST_W - pad * 2, 34, 'left');
    }
  }

  function drawPolaroid(ctx, t) {
    ctx.fillStyle = '#ddd5bf';
    ctx.fillRect(0, 0, POST_W, POST_H);
    const frameW = 860, frameH = 1080;
    const fx = (POST_W - frameW) / 2, fy = 90;
    ctx.save();
    ctx.shadowColor = 'rgba(38,38,31,0.35)';
    ctx.shadowBlur = 40; ctx.shadowOffsetY = 22;
    ctx.fillStyle = '#fdfcf7';
    ctx.fillRect(fx, fy, frameW, frameH);
    ctx.restore();

    const photoPad = 40;
    const photoH = frameH - photoPad * 2 - 190;
    if (postImageEl) coverDraw(ctx, postImageEl, fx + photoPad, fy + photoPad, frameW - photoPad * 2, photoH);

    let y = fy + photoPad + photoH + 90;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#26261f';
    ctx.font = '46px Georgia, serif';
    ctx.fillText(t.name, POST_W / 2, y);
    y += 40;
    if (t.scientific) {
      ctx.font = 'italic 26px Georgia, serif';
      ctx.fillStyle = '#7c9473';
      ctx.fillText(t.scientific, POST_W / 2, y);
      y += 36;
    }
    if (t.symbolism) {
      ctx.font = '20px -apple-system, sans-serif';
      ctx.fillStyle = '#57574c';
      wrapText(ctx, t.symbolism, POST_W / 2, y + 6, frameW - photoPad * 2, 28, 'center');
    }
  }

  function drawSimple(ctx, t) {
    ctx.fillStyle = '#faf8f1';
    ctx.fillRect(0, 0, POST_W, POST_H);
    const size = POST_W - 120;
    const x = 60, y = 60;
    if (postImageEl) coverDraw(ctx, postImageEl, x, y, size, size);

    let ty = y + size + 76;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f3325';
    ctx.font = '50px Georgia, serif';
    ctx.fillText(t.name, x, ty);
    if (t.scientific) {
      ctx.textAlign = 'right';
      ctx.font = 'italic 28px Georgia, serif';
      ctx.fillStyle = '#7c9473';
      ctx.fillText(t.scientific, x + size, ty);
    }
    ty += 50;
    if (t.symbolism) {
      ctx.textAlign = 'left';
      ctx.font = '23px -apple-system, sans-serif';
      ctx.fillStyle = '#57574c';
      wrapText(ctx, t.symbolism, x, ty, size, 32, 'left');
    }
  }

  // ---- Botanical Plate: oval-cropped photo in a lithograph-style ring,
  // captioned like a plate from a 19th-century botanical volume ----
  function drawPlate(ctx, t) {
    ctx.fillStyle = '#faf8f1';
    ctx.fillRect(0, 0, POST_W, POST_H);
    ctx.strokeStyle = '#ddd5bf';
    ctx.lineWidth = 2;
    ctx.strokeRect(50, 50, POST_W - 100, POST_H - 100);
    ctx.strokeRect(62, 62, POST_W - 124, POST_H - 124);

    const cx = POST_W / 2, cy = 560, rx = 330, ry = 400;
    if (postImageEl) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      coverDraw(ctx, postImageEl, cx - rx, cy - ry, rx * 2, ry * 2);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = '#1f3325'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#a9824f'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx + 14, ry + 14, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    let y = cy + ry + 90;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#a9824f';
    ctx.font = '20px Courier, monospace';
    ctx.fillText('BOTANICAL PLATE', POST_W / 2, y);
    y += 46;
    ctx.fillStyle = '#1f3325';
    ctx.font = '50px Georgia, serif';
    ctx.fillText(t.name.toUpperCase(), POST_W / 2, y);
    y += 38;
    if (t.scientific) {
      ctx.font = 'italic 27px Georgia, serif';
      ctx.fillStyle = '#57574c';
      ctx.fillText(t.scientific, POST_W / 2, y);
    }
  }

  // ---- Postcard: deckle-white border, a small pressed-flower "stamp"
  // in the corner, and the note set like a postcard message ----
  function drawPostcard(ctx, t) {
    ctx.fillStyle = '#cdd8c2';
    ctx.fillRect(0, 0, POST_W, POST_H);
    const bx = 46, by = 46, bw = POST_W - 92, bh = POST_H - 92;
    ctx.save();
    ctx.shadowColor = 'rgba(38,38,31,0.3)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#fdfcf7';
    ctx.fillRect(bx, by, bw, bh);
    ctx.restore();

    const photoPad = 30;
    const photoH = 900;
    if (postImageEl) coverDraw(ctx, postImageEl, bx + photoPad, by + photoPad, bw - photoPad * 2, photoH);

    // postage-stamp mark, upper right of the photo
    const stampW = 150, stampH = 110, sx = bx + bw - photoPad - stampW, sy = by + photoPad + 20;
    ctx.save();
    ctx.fillStyle = 'rgba(250,248,241,0.92)';
    ctx.fillRect(sx, sy, stampW, stampH);
    ctx.strokeStyle = '#1f3325'; ctx.setLineDash([6, 5]); ctx.lineWidth = 2.5;
    ctx.strokeRect(sx, sy, stampW, stampH);
    ctx.setLineDash([]);
    ctx.fillStyle = '#1f3325';
    ctx.textAlign = 'center';
    ctx.font = '15px Courier, monospace';
    ctx.fillText('PRESSED', sx + stampW / 2, sy + 34);
    ctx.font = '13px Courier, monospace';
    ctx.fillStyle = '#7c9473';
    ctx.fillText(new Date().getFullYear().toString(), sx + stampW / 2, sy + 84);
    ctx.restore();

    let y = by + photoPad + photoH + 78;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f3325';
    ctx.font = '52px Georgia, serif';
    ctx.fillText(t.name, bx + photoPad, y);
    y += 42;
    if (t.scientific) {
      ctx.font = 'italic 27px Georgia, serif';
      ctx.fillStyle = '#7c9473';
      ctx.fillText(t.scientific, bx + photoPad, y);
      y += 20;
    }
    ctx.strokeStyle = '#ddd5bf'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx + photoPad, y + 24); ctx.lineTo(bx + bw - photoPad, y + 24); ctx.stroke();
    if (t.symbolism) {
      ctx.font = 'italic 24px Georgia, serif';
      ctx.fillStyle = '#57574c';
      wrapText(ctx, t.symbolism, bx + photoPad, y + 66, bw - photoPad * 2, 34, 'left');
    }
  }

  // ---- Quote: the symbolism is the hero, set as a pull-quote over a
  // dimmed full-bleed photo, with the flower name as a small byline ----
  function drawQuote(ctx, t) {
    ctx.fillStyle = '#1f3325';
    ctx.fillRect(0, 0, POST_W, POST_H);
    if (postImageEl) coverDraw(ctx, postImageEl, 0, 0, POST_W, POST_H);
    ctx.fillStyle = 'rgba(20,24,18,0.56)';
    ctx.fillRect(0, 0, POST_W, POST_H);

    const pad = 110;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(243,240,230,0.65)';
    ctx.font = '90px Georgia, serif';
    ctx.fillText('“', POST_W / 2, 430);

    const quoteText = t.symbolism || t.name;
    ctx.fillStyle = '#f3f0e6';
    ctx.font = 'italic 54px Georgia, serif';
    const endY = wrapText(ctx, quoteText, POST_W / 2, 500, POST_W - pad * 2, 66, 'center');

    let y = endY + 50;
    ctx.strokeStyle = 'rgba(243,240,230,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(POST_W / 2 - 46, y); ctx.lineTo(POST_W / 2 + 46, y); ctx.stroke();
    y += 46;
    ctx.font = '30px Georgia, serif';
    ctx.fillStyle = '#f3f0e6';
    ctx.fillText(t.name, POST_W / 2, y);
    if (t.scientific) {
      y += 38;
      ctx.font = 'italic 24px Georgia, serif';
      ctx.fillStyle = '#cdd8c2';
      ctx.fillText(t.scientific, POST_W / 2, y);
    }
  }

  // ---- Field Guide: photo on top, an index-card panel below laid out
  // like a field-guide entry with labeled rows ----
  function drawFieldGuide(ctx, t) {
    ctx.fillStyle = '#faf8f1';
    ctx.fillRect(0, 0, POST_W, POST_H);
    const photoH = 700;
    if (postImageEl) coverDraw(ctx, postImageEl, 0, 0, POST_W, photoH);

    const pad = 80;
    let y = photoH + 76;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a9824f';
    ctx.font = '19px Courier, monospace';
    ctx.fillText('FIELD NOTES', pad, y);
    ctx.textAlign = 'right';
    ctx.fillText(formatFieldDate(), POST_W - pad, y);
    y += 20;
    ctx.strokeStyle = '#ddd5bf'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(POST_W - pad, y); ctx.stroke();

    y += 62;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1f3325';
    ctx.font = '54px Georgia, serif';
    ctx.fillText(t.name, pad, y);

    if (t.scientific) {
      y += 44;
      ctx.font = 'italic 28px Georgia, serif';
      ctx.fillStyle = '#7c9473';
      ctx.fillText(t.scientific, pad, y);
    }

    if (t.symbolism) {
      y += 56;
      ctx.font = '16px Courier, monospace';
      ctx.fillStyle = '#57574c';
      ctx.fillText('SYMBOLISM', pad, y);
      y += 34;
      ctx.font = '25px -apple-system, sans-serif';
      ctx.fillStyle = '#26261f';
      wrapText(ctx, t.symbolism, pad, y, POST_W - pad * 2, 35, 'left');
    }
  }
  function formatFieldDate() {
    return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  }

  // ---- export ----
  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error('The post image could not be created.'));
        else resolve(blob);
      }, 'image/png');
    });
  }

  $('#btn-download-post').addEventListener('click', async () => {
    const canvas = $('#post-canvas');
    setLoading(true);
    try {
      const blob = await canvasToBlob(canvas);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (postFlower?.name || 'flower').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = url;
      a.download = `pressed-${safeName}-${currentTemplate}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      try { await DB.savePost({ flowerId: postFlower.id, template: currentTemplate, imageBlob: blob }); } catch {}
      setLoading(false);
      toast('Post image saved.');
    } catch (err) {
      setLoading(false);
      toast(friendlyError(err, 'This post could not be exported.'), { error: true });
    }
  });

  $('#btn-share-post').addEventListener('click', async () => {
    const canvas = $('#post-canvas');
    setLoading(true);
    try {
      const blob = await canvasToBlob(canvas);
      const safeName = (postFlower?.name || 'flower').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const file = new File([blob], `pressed-${safeName}.png`, { type: 'image/png' });
      setLoading(false);

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: postFlower?.name || 'A flower from Pressed',
          text: postFlower?.symbolism ? `${postFlower.name} — ${postFlower.symbolism}` : postFlower?.name,
        });
      } else {
        toast('Sharing is not supported here — saving the image instead.');
        $('#btn-download-post').click();
      }
    } catch (err) {
      setLoading(false);
      if (err && err.name === 'AbortError') return; // user cancelled the share sheet
      toast(friendlyError(err, 'This post could not be shared.'), { error: true });
    }
  });

  /* ---------------------------------------------------------
     INSTALL APP (PWA) — this is a downloadable app, not just a
     page, so surface a real install affordance rather than
     leaving people to find it in a browser menu.
     --------------------------------------------------------- */
  const installBtn = $('#btn-install-app');
  let deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // iOS Safari
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  if (!isStandalone()) {
    if (isIOS()) {
      // No beforeinstallprompt on iOS — show the button immediately
      // and explain the manual step instead.
      installBtn.hidden = false;
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    deferredInstallPrompt = null;
    toast('Pressed is installed. Look for it on your home screen.');
  });

  installBtn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      installBtn.disabled = true;
      deferredInstallPrompt.prompt();
      try {
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          installBtn.hidden = true;
        }
      } catch {
        // ignore — the browser's own UI already communicated the result
      } finally {
        deferredInstallPrompt = null;
        installBtn.disabled = false;
      }
    } else if (isIOS()) {
      $('#install-dialog-backdrop').hidden = false;
    } else {
      toast('This browser can install Pressed from its menu — look for "Install app" or "Add to Home Screen."');
    }
  });

  $('#install-dialog-ok').addEventListener('click', () => {
    $('#install-dialog-backdrop').hidden = true;
  });

  /* ---------------------------------------------------------
     Service worker registration (offline support)
     --------------------------------------------------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Offline caching just won't be available this session; the app
        // still works normally since all data lives in IndexedDB.
      });
    });
  }

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */
  window.addEventListener('beforeunload', revokeAllTracked);

  if (!('indexedDB' in window)) {
    toast('This browser does not support local storage, so Pressed cannot save flowers here.', { error: true });
  }

  router();
})();
