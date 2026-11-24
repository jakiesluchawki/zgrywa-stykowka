'use strict';
const $ = id => document.getElementById(id);
const icon = id => '<svg class="icon" aria-hidden="true"><use href="#icon-' + id + '"/></svg>';
const selectionKey = 'zgrywa-stykowka-v1-mieszko';
let key, photos = [], groups = [], visible = [], activeFilter = 'all', current = null;
let selected = new Set(), lookup = new Map(), cards = new Map(), filters = new Map();
let stageVersion = 0, fullUrl = '', toastTimer;
const thumbQueue = new Set();
const thumbStates = new Map();
let activeThumbs = 0;

function word(n, one, few, many) {
  if (n === 1) return one;
  return n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many;
}
function notify(message) {
  $('notice').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('notice').textContent = ''; }, 3800);
}
async function bytes(path, signal) {
  const response = await fetch(path, {signal});
  if (!response.ok) throw new Error('fetch');
  return new Uint8Array(await response.arrayBuffer());
}
function decrypt(data, secret) {
  return crypto.subtle.decrypt({name:'AES-GCM',iv:data.subarray(0,12)}, secret, data.subarray(12));
}
async function openGallery(password) {
  const response = await fetch('./key-params.json');
  if (!response.ok) throw new Error('fetch');
  const params = await response.json();
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const secret = await crypto.subtle.deriveKey({
    name:'PBKDF2', hash:'SHA-256', iterations:params.iterations,
    salt:Uint8Array.from(atob(params.salt), c => c.charCodeAt(0))
  }, material, {name:'AES-GCM', length:256}, false, ['decrypt']);
  const clear = await decrypt(await bytes('./catalog.bin'), secret);
  const catalog = JSON.parse(new TextDecoder().decode(clear));
  key = secret;
  photos = catalog.photos;
  groups = catalog.groups;
  lookup = new Map(photos.map(p => [p.thumb,p]));
  try {selected = readSelection();} catch {notify('Pamięć przeglądarki jest niedostępna. Pobierz TXT przed zamknięciem.');}
  $('total').textContent = photos.length + ' ' + word(photos.length,'kadr','kadry','kadrów');
  $('gate').hidden = true;
  $('gallery').hidden = false;
  $('private-label').hidden = true;
  $('lock-btn').hidden = false;
  buildFilters();
  showGrid();
  window.scrollTo(0,0);
  $('gallery-title').focus({preventScroll:true});
}
$('login').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('unlock').disabled) return;
  $('unlock').disabled = true;
  $('login-msg').textContent = 'Odszyfrowywanie…';
  try {
    await openGallery($('password').value);
    $('password').value = '';
    $('login-msg').textContent = '';
  } catch (error) {
    $('login-msg').textContent = error.name === 'OperationError' ? 'Błędne hasło. Spróbuj jeszcze raz.' : 'Nie udało się otworzyć galerii. Sprawdź połączenie i spróbuj ponownie.';
    $('password').focus();
    $('password').select();
  } finally {
    $('unlock').disabled = false;
  }
});
$('lock-btn').onclick = () => location.reload();

function readSelection() {
  const saved = JSON.parse(localStorage.getItem(selectionKey) || '[]');
  return new Set(Array.isArray(saved) ? saved.filter(id => lookup.has(id)) : []);
}
function chip(id, label) {
  const tag = document.createElement('span');
  tag.className = 'chip ' + id;
  tag.innerHTML = '<i class="swatch" aria-hidden="true"></i>';
  tag.append(label);
  return tag;
}
function displayTags(container, photo) {
  const tags = groups.filter(group => photo.picks.includes(group.id)).map(group => chip(group.id,group.label));
  if (selected.has(photo.thumb)) tags.push(chip('m','Mieszko'));
  container.replaceChildren(...tags);
}
function groupChoice(definition) {
  const label = document.createElement('label');
  label.className = 'common-choice ' + definition.id;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.name = 'group';
  checkbox.value = definition.id;
  label.append(checkbox,definition.id === 'm' ? 'Mieszko' : definition.label);
  return label;
}
function buildFilters() {
  const definitions = [{id:'all',label:'Wszystkie'}, ...groups, {id:'m',label:'Selekcja Mieszka'}];
  const fragment = document.createDocumentFragment();
  for (const def of definitions) {
    const button = document.createElement('button');
    button.className = 'filter ' + def.id;
    if (def.id !== 'all') button.innerHTML = '<i class="swatch" aria-hidden="true"></i>';
    button.append(def.label);
    if (def.id === 't1' || def.id === 't2') button.title = def.id === 't1' ? 'Pierwsza selekcja Tomka' : 'Druga selekcja Tomka';
    const count = document.createElement('small');
    count.textContent = def.id === 'all' ? photos.length : def.id === 'm' ? selected.size : photos.filter(photo => photo.picks.includes(def.id)).length;
    button.append(count);
    button.onclick = () => {
      $('common-form').reset();
      activeFilter = def.id;
      showGrid();
    };
    filters.set(def.id,button);
    fragment.append(button);
  }
  $('filters').replaceChildren(fragment);
  const people = definitions.filter(definition => definition.id !== 'all');
  for (const panel of ['common','exclude']) {
    $(panel + '-choices').replaceChildren(...people.map(groupChoice));
    $(panel + '-panel').open = window.matchMedia('(min-width: 761px)').matches;
    $(panel + '-clear').onclick = () => {
      $(panel + '-form').reset();
      showGrid();
      $(panel + '-choices').querySelector('input').focus({preventScroll:true});
    };
  }
}
function syncGroupPanel(panel, separator) {
  const checked = [...$(panel + '-choices').querySelectorAll('input:checked')];
  const summary = $(panel + '-summary');
  const names = checked.map(input => input.labels[0].textContent);
  summary.textContent = names.length ? names.join(separator) : summary.dataset.hint;
  $(panel + '-clear').hidden = !checked.length;
  return checked.map(input => input.value);
}
function filtersOnMyPicks() {
  return activeFilter === 'm' || document.querySelector('.common-panel input[value="m"]:checked') !== null;
}
function pickedBy(photo, id) {
  return id === 'm' ? selected.has(photo.thumb) : photo.picks.includes(id);
}
$('common-form').onchange = () => {
  activeFilter = 'all';
  showGrid();
};
$('exclude-form').onchange = showGrid;
function syncCounters() {
  filters.get('m').querySelector('small').textContent = selected.size;
  $('export').disabled = !selected.size;
  $('export').querySelector('.export-n').textContent = selected.size;
}
function updatePick(button, photo, wide=false) {
  const isPicked = selected.has(photo.thumb);
  const label = (isPicked ? 'Usuń z selekcji Mieszka' : 'Dodaj do selekcji Mieszka') + ' · ' + photo.name;
  button.setAttribute('aria-pressed', String(isPicked));
  button.setAttribute('aria-label', label);
  button.title = label + (wide ? ' (M)' : '');
  button.innerHTML = icon(isPicked ? 'check' : 'plus');
  if (wide) {
    button.classList.add('m');
    button.append(isPicked ? 'W selekcji Mieszka' : 'Selekcja Mieszka');
  }
}
function updateCard(photo) {
  const card = cards.get(photo.thumb);
  if (!card) return;
  updatePick(card.querySelector('.pick'), photo);
  displayTags(card.querySelector('.tags'), photo);
}
function toggle(photo) {
  const before = visible.indexOf(photo);
  try {selected = readSelection();} catch { /* Keep the in-memory selection if storage is unavailable. */ }
  if (selected.has(photo.thumb)) selected.delete(photo.thumb);
  else selected.add(photo.thumb);
  try {localStorage.setItem(selectionKey, JSON.stringify([...selected]));}
  catch {notify('Wybór jest w pamięci tej karty. Pobierz TXT przed zamknięciem.');}
  if (filtersOnMyPicks()) {
    showGrid();
    if (current && !visible.includes(current)) {
      if (visible.length) openPhoto(visible[Math.min(Math.max(0,before),visible.length-1)]);
      else $('viewer').close();
    }
  } else {
    syncCounters();
    updateCard(photo);
  }
  if (current) syncViewerControls();
}
window.addEventListener('storage', event => {
  if (!key || (event.key !== selectionKey && event.key !== null)) return;
  const idx = visible.indexOf(current);
  try {selected = readSelection();} catch {return;}
  if (filtersOnMyPicks()) {
    showGrid();
    if (current && !visible.includes(current)) {
      if (visible.length) openPhoto(visible[Math.min(Math.max(0,idx),visible.length-1)]);
      else $('viewer').close();
    }
  } else {
    syncCounters();
    for (const p of visible) updateCard(p);
  }
  if (current) syncViewerControls();
});
async function photoUrl(token, signal) {
  const buffer = await decrypt(await bytes('./frames/' + token + '.bin', signal), key);
  return URL.createObjectURL(new Blob([buffer],{type:'image/webp'}));
}
function releaseThumb(img) {
  thumbQueue.delete(img);
  const state = thumbStates.get(img);
  if (!state) return;
  state.abort.abort();
  if (state.url) URL.revokeObjectURL(state.url);
  img.removeAttribute('src');
  thumbStates.delete(img);
}
async function loadThumb(img) {
  const state = {abort:new AbortController(),url:null};
  thumbStates.set(img,state);
  try {
    const url = await photoUrl(img.dataset.token,state.abort.signal);
    if (thumbStates.get(img) !== state) {URL.revokeObjectURL(url); return;}
    state.url = url;
    img.src = url;
  } catch (error) {
    if (error.name !== 'AbortError' && thumbStates.get(img) === state) {
      img.parentElement.title = 'Nie udało się pobrać miniatury. Kliknij, aby otworzyć zdjęcie.';
      img.parentElement.classList.add('failed');
    }
  }
}
function drainThumbs() {
  while (activeThumbs < 6 && thumbQueue.size) {
    const img = thumbQueue.values().next().value;
    thumbQueue.delete(img);
    activeThumbs++;
    loadThumb(img).finally(() => {activeThumbs--; drainThumbs();});
  }
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const img = entry.target;
    if (!img.isConnected || !entry.isIntersecting) releaseThumb(img);
    else if (!thumbStates.has(img)) thumbQueue.add(img);
  }
  drainThumbs();
}, {rootMargin:'650px 0px'});
function makeCard(photo) {
  const item = $('card').content.firstElementChild.cloneNode(true);
  const imageButton = item.querySelector('.photo');
  imageButton.dataset.open = photo.thumb;
  imageButton.setAttribute('aria-label','Powiększ ' + photo.name);
  item.querySelector('img').dataset.token = photo.thumb;
  item.querySelector('.pick').dataset.pick = photo.thumb;
  item.querySelector('.frame-no').textContent = photo.label;
  item.querySelector('.filename').textContent = photo.name;
  cards.set(photo.thumb,item);
  updateCard(photo);
  return item;
}
function showGrid() {
  const query = $('search').value.trim().toLocaleLowerCase('pl');
  const common = syncGroupPanel('common',' + ');
  const excluded = syncGroupPanel('exclude',' lub ');
  const required = activeFilter === 'all' ? common : [activeFilter];
  visible = photos.filter(photo => {
    return required.every(id => pickedBy(photo,id))
      && !excluded.some(id => pickedBy(photo,id))
      && (!query || photo.name.toLocaleLowerCase('pl').includes(query));
  });
  for (const [id,button] of filters) button.setAttribute('aria-pressed',String(!common.length && id === activeFilter));
  observer.disconnect();
  thumbQueue.clear();
  for (const img of thumbStates.keys()) releaseThumb(img);
  cards.clear();
  const fragment = document.createDocumentFragment();
  for (const photo of visible) fragment.append(makeCard(photo));
  $('grid').replaceChildren(fragment);
  for (const img of $('grid').querySelectorAll('img')) observer.observe(img);
  $('empty').hidden = !!visible.length;
  $('empty-hint').textContent = activeFilter === 'm' && !selected.size ? 'Kliknij plus pod zdjęciem, aby dodać je do selekcji Mieszka.' : 'Zmień filtr lub wpisz inny numer.';
  $('empty-title').textContent = common.length > 1 && !query ? 'Brak wspólnych zdjęć.' : 'Brak zdjęć w tym widoku.';
  if (excluded.length && !query) {
    $('empty-title').textContent = 'Brak zdjęć dla tych filtrów.';
    $('empty-hint').textContent = 'Odznacz osobę w sekcji „Pomiń wybrane przez” lub zmień selekcję powyżej.';
  } else if (common.length && !query) {
    $('empty-hint').textContent = common.includes('m') && !selected.size
      ? 'Dodaj zdjęcia do selekcji Mieszka, aby porównać swój wybór.'
      : 'Odznacz jedną z selekcji, aby poszerzyć wyniki.';
  }
  $('n-visible').textContent = visible.length + ' / ' + photos.length;
  syncCounters();
}
$('grid').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.dataset.open) openPhoto(lookup.get(button.dataset.open));
  if (button?.dataset.pick) toggle(lookup.get(button.dataset.pick));
});
$('search').oninput = showGrid;
$('reset').onclick = () => {
  $('common-form').reset();
  $('exclude-form').reset();
  activeFilter = 'all';
  $('search').value = '';
  showGrid();
};
$('top').onclick = () => window.scrollTo({top:0});
function setDensity(fine) {
  $('grid').classList.toggle('fine',fine);
  $('fine-btn').setAttribute('aria-pressed',String(fine));
  $('coarse-btn').setAttribute('aria-pressed',String(!fine));
}
$('fine-btn').onclick = () => setDensity(true);
$('coarse-btn').onclick = () => setDensity(false);
$('export').onclick = () => {
  const picked = photos.filter(photo => selected.has(photo.thumb));
  if (!picked.length) return;
  const lines = ['ZGRYWA — Selekcja Mieszka', 'Fotografie: Tomek Albin', 'Liczba zdjęć: ' + picked.length, '', ...picked.map(p => p.label + '\t' + p.name)];
  const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ZGRYWA-selekcja-Mieszka.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
let stageRequest;
function resetStage() {
  stageVersion++;
  stageRequest?.abort();
  if (fullUrl) URL.revokeObjectURL(fullUrl);
  fullUrl = '';
  $('large').removeAttribute('src');
}
function syncViewerControls() {
  const idx = visible.indexOf(current);
  $('position').textContent = (idx+1) + ' / ' + visible.length;
  $('prev').disabled = idx <= 0;
  $('next').disabled = idx >= visible.length-1;
  updatePick($('view-pick'),current,true);
  displayTags($('view-tags'),current);
}
async function openPhoto(photo) {
  if (!photo) return;
  resetStage();
  current = photo;
  const version = stageVersion;
  stageRequest = new AbortController();
  $('view-label').textContent = photo.label;
  $('view-name').textContent = photo.name;
  $('large').alt = photo.name;
  $('view-msg').textContent = 'Ładowanie podglądu…';
  syncViewerControls();
  if (!$('viewer').open) $('viewer').showModal();
  try {
    const url = await photoUrl(photo.full,stageRequest.signal);
    if (version !== stageVersion) {URL.revokeObjectURL(url); return;}
    fullUrl = url;
    $('large').src = url;
    await $('large').decode();
    if (version === stageVersion) $('view-msg').textContent = '';
  } catch (error) {
    if (version === stageVersion && error.name !== 'AbortError') {
      const retry = document.createElement('button');
      retry.textContent = 'Pobierz ponownie';
      retry.className = 'outline';
      retry.onclick = () => openPhoto(photo);
      $('view-msg').replaceChildren('Nie udało się pobrać zdjęcia. ',retry);
    }
  }
}
function step(n) {
  if (current) openPhoto(visible[visible.indexOf(current)+n]);
}
$('view-pick').onclick = () => {if (current) toggle(current);};
$('close-view').onclick = () => $('viewer').close();
$('viewer').addEventListener('close', () => {
  const last = current;
  resetStage(); current = null;
  if (last) cards.get(last.thumb)?.querySelector('.photo')?.focus({preventScroll:true});
});
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('viewer').addEventListener('keydown', event => {
  if (event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1);
  } else if (event.key.toLowerCase() === 'm' && !event.repeat && current) {
    event.preventDefault(); toggle(current);
  }
});
let touchStart;
$('stage').addEventListener('touchstart', e => {touchStart = e.touches.length === 1 ? [e.touches[0].clientX,e.touches[0].clientY] : null;}, {passive:true});
$('stage').addEventListener('touchend', e => {
  if (!touchStart || e.touches.length) return;
  const dx = e.changedTouches[0].clientX - touchStart[0], dy = e.changedTouches[0].clientY - touchStart[1];
  touchStart = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > 1.5*Math.abs(dy)) step(dx > 0 ? -1 : 1);
}, {passive:true});
