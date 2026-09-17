// ==========================================
// Estado Global del Cliente
// ==========================================
const selectedTracks = new Map();
let collectionCache = [];
let currentActiveTrackObj = null;

// Estado Global para Edición de Playlists
let currentEditingPlaylist = null; // null | { filename: string, name: string, tracks: Array }

// Instancia de Socket.IO para comunicación en tiempo real
let socket = null;

// Escuchar inicio de la aplicación
document.addEventListener('DOMContentLoaded', () => {
  loadCollection();
  initGlobalAudioPlayer();
  initLiveSocketUpdates();
  initDashboardButtons();
});

// ==========================================
// Integración WebSocket (Socket.IO Live Sync)
// ==========================================
function initLiveSocketUpdates() {
  if (typeof io !== 'undefined') {
    socket = io();

    socket.on('catalog-updated', (data) => {
      console.log('🔄 [LIVE SYNC] Cambio detectado en la biblioteca. Actualizando catálogo...');
      
      if (data && data.stats && data.stats.totalTracks !== undefined) {
        updateDashboardCounter(data.stats.totalTracks);
      } else {
        fetchStatsSilently();
      }

      loadCollection();
    });

    socket.on('stats-updated', (stats) => {
      if (stats && stats.totalTracks !== undefined) {
        updateDashboardCounter(stats.totalTracks);
      }
    });

    socket.on('log', (logData) => {
      if (logData && logData.text) {
        appendConsoleLog(logData.text, logData.type);
      }
    });
  } else {
    console.warn('Socket.io script no detectado en el cliente web.');
  }
}

function initDashboardButtons() {
  const buttons = document.querySelectorAll('button, a, .btn');
  buttons.forEach(btn => {
    const txt = btn.textContent.trim().toLowerCase();
    
    if (txt.includes('tagging.ps1')) {
      btn.onclick = (e) => {
        e.preventDefault();
        runScriptManual('Tagging.ps1');
      };
    } else if (txt.includes('audio.ps1')) {
      btn.onclick = (e) => {
        e.preventDefault();
        runScriptManual('Audio.ps1');
      };
    } else if (txt.includes('run import.ps1') || txt.includes('import.ps1')) {
      btn.onclick = (e) => {
        e.preventDefault();
        runScriptManual('Import.ps1');
      };
    }
  });
}

function runScriptManual(scriptName) {
  if (socket) {
    appendConsoleLog(`[USER] Solicitando ejecución manual de ${scriptName}...`, 'warning');
    socket.emit('run-script', { script: scriptName });
  } else {
    console.error('Socket.io no disponible para ejecutar scripts.');
  }
}

function appendConsoleLog(text, type = 'info') {
  const consoleLogContainer = document.querySelector('.console-logs, #console-logs, .realtime-console-logs');
  if (consoleLogContainer) {
    const logLine = document.createElement('div');
    logLine.className = `log-entry log-${type}`;
    logLine.style.margin = '2px 0';
    logLine.style.fontFamily = 'monospace';
    
    if (type === 'error') logLine.style.color = '#ff5555';
    else if (type === 'success') logLine.style.color = '#50fa7b';
    else if (type === 'warning') logLine.style.color = '#ffb86c';
    else logLine.style.color = '#8be9fd';

    logLine.textContent = text;
    consoleLogContainer.appendChild(logLine);
    consoleLogContainer.scrollTop = consoleLogContainer.scrollHeight;
  }
}

async function fetchStatsSilently() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    if (stats && stats.totalTracks !== undefined) {
      updateDashboardCounter(stats.totalTracks);
    }
  } catch (err) {
    console.error('Error al actualizar estadísticas:', err);
  }
}

function updateDashboardCounter(totalTracks) {
  const counterElement = document.getElementById('total-tracks-count') || 
                         document.querySelector('.total-tracks') || 
                         document.querySelector('[data-stat="total-tracks"]');
  
  if (counterElement) {
    counterElement.textContent = totalTracks;
    return;
  }

  const allCards = document.querySelectorAll('div, section, article');
  allCards.forEach(card => {
    if (card.textContent && card.textContent.includes('TOTAL TRACKS')) {
      const numEl = Array.from(card.querySelectorAll('h1, h2, h3, div, span, p'))
                         .find(el => el.children.length === 0 && !isNaN(parseInt(el.textContent.trim())));
      if (numEl) {
        numEl.textContent = totalTracks;
      }
    }
  });
}

// ==========================================
// Cargar Colección de Música con Auto-Refresco de Búsqueda
// ==========================================
async function loadCollection() {
  try {
    const res = await fetch('/api/collection');
    collectionCache = await res.json();
    
    const queryInput = document.getElementById('search-input') || document.getElementById('searchInput');
    if (queryInput && queryInput.value.trim() !== '') {
      handleSearch();
    } else {
      renderTrackList(collectionCache);
    }
  } catch (err) {
    console.error('Error al cargar la colección:', err);
  }
}

// ==========================================
// Búsqueda y Filtrado en Tiempo Real
// ==========================================
function handleSearch() {
  const queryInput = document.getElementById('search-input') || document.getElementById('searchInput');
  if (!queryInput) return;
  
  const query = queryInput.value.toLowerCase().trim();
  if (!query) {
    renderTrackList(collectionCache);
    return;
  }

  const filtered = collectionCache.filter(track => {
    const title = (track.title || track.name || '').toLowerCase();
    const artist = (track.artist || '').toLowerCase();
    const album = (track.album || '').toLowerCase();
    const key = (track.key || track.initialKey || '').toLowerCase();
    const bpm = String(track.bpm || '');
    const path = (track.path || track.filePath || '').toLowerCase();

    return title.includes(query) || 
           artist.includes(query) || 
           album.includes(query) || 
           key.includes(query) || 
           bpm.includes(query) || 
           path.includes(query);
  });

  renderTrackList(filtered);
}

// ==========================================
// Renderizado de Pistas en Tabla/Lista
// ==========================================
function renderTrackList(tracks) {
  const container = document.getElementById('track-list-container') || document.querySelector('.library-list');
  if (!container) return;
  
  container.innerHTML = '';

  if (!tracks || tracks.length === 0) {
    container.innerHTML = '<p style="padding: 15px; color: #888;">No tracks found.</p>';
    return;
  }

  tracks.forEach(track => {
    const trackPath = typeof track === 'object' ? (track.path || track.filePath) : track;
    const isChecked = selectedTracks.has(trackPath);
    const isMissing = track.missing || false;
    
    const title = isMissing ? 'Error to found the file' : (track.title || track.name || (typeof trackPath === 'string' ? trackPath.split('\\').pop() : 'Unknown Track'));
    const artist = track.artist || (isMissing ? (typeof trackPath === 'string' ? trackPath.split('\\').pop() : 'Missing File') : 'Unknown Artist');
    const album = track.album || '';
    const bpm = track.bpm ? track.bpm : '--';
    const key = (track.key || track.initialKey) ? (track.key || track.initialKey) : '--';
    const format = track.format ? track.format.toUpperCase() : (trackPath ? trackPath.split('.').pop().toUpperCase() : 'AUDIO');
    const bits = track.bits || track.bitrate || 'N/A';
    const coverUrl = isMissing ? '/images/default-cover.png' : `/api/cover?path=${encodeURIComponent(trackPath)}`;
    const folderName = trackPath ? trackPath.split('\\').slice(-2, -1)[0] || 'Root' : 'Root';

    const card = document.createElement('div');
    card.className = 'track-card';
    if (isMissing) {
      card.style.border = '1px solid #ff5555';
      card.style.background = 'rgba(255, 85, 85, 0.08)';
    }
    
    const safePath = String(trackPath).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    card.innerHTML = `
      <div class="track-select">
        <input 
          type="checkbox" 
          class="track-checkbox" 
          ${isChecked ? 'checked' : ''} 
          onchange="toggleTrackSelection('${safePath}', this.checked, this)"
        />
      </div>

      <div class="track-action">
        ${isMissing ? `
          <button class="btn-play" style="opacity: 0.4; cursor: not-allowed;" title="Archivo no encontrado" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          </button>
        ` : `
          <button class="btn-play" onclick="playAudio('${safePath}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
        `}
      </div>

      <div class="track-format">
        <span class="format-badge ${isMissing ? 'error' : format.toLowerCase()}" style="${isMissing ? 'background: #ff5555; color: #fff;' : ''}">${isMissing ? 'MISSING' : format}</span>
      </div>

      <div class="track-folder">
        <span class="folder-name">${folderName}</span>
      </div>

      <div class="track-artwork">
        <img src="${coverUrl}" alt="Cover" onerror="this.src='/images/default-cover.png';" />
      </div>

      <div class="track-details">
        <div class="track-title" style="${isMissing ? 'color: #ff5555; font-weight: bold;' : ''}">${title}</div>
        <div class="track-artist">${artist} ${album ? ' - ' + album : ''}</div>
      </div>

      <div class="track-meta">
        <span class="meta-item bpm">${bpm}</span>
      </div>

      <div class="track-meta">
        <span class="key-badge">${key}</span>
      </div>

      <div class="track-meta">
        <span class="bits-badge">${bits}</span>
      </div>
    `;

    container.appendChild(card);
  });
}

// ==========================================
// Gestor de Selección de Tracks y Validaciones
// ==========================================
function toggleSelectAll(isChecked) {
  const checkboxes = document.querySelectorAll('.track-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = isChecked;
    const match = cb.getAttribute('onchange').match(/'([^']+)'/);
    if (match && match[1]) {
      const path = match[1];
      if (isChecked) {
        selectedTracks.set(path, path);
      } else {
        selectedTracks.delete(path);
      }
    }
  });
  updateSelectedCounter();
}

function toggleTrackSelection(trackPath, isChecked, checkboxEl = null) {
  if (isChecked) {
    if (currentEditingPlaylist && currentEditingPlaylist.tracks) {
      const alreadyInPlaylist = currentEditingPlaylist.tracks.some(t => {
        const p = typeof t === 'object' ? (t.path || t.filePath) : t;
        return p && p.toLowerCase() === trackPath.toLowerCase();
      });

      if (alreadyInPlaylist) {
        const trackTitle = pathBasename(trackPath);
        const confirmAdd = confirm(
          `This track already exists in your playlist:\n"${trackTitle}"\n\nDo you want to add it again?`
        );

        if (!confirmAdd) {
          if (checkboxEl) checkboxEl.checked = false;
          selectedTracks.delete(trackPath);
          updateSelectedCounter();
          return;
        }
      }
    }

    selectedTracks.set(trackPath, trackPath);
  } else {
    selectedTracks.delete(trackPath);
  }
  updateSelectedCounter();
}

function pathBasename(pathStr) {
  if (!pathStr || typeof pathStr !== 'string') return 'Unknown Track';
  return pathStr.split(/[\\/]/).pop();
}

function updateSelectedCounter() {
  const counterElement = document.getElementById('selected-counter') || document.querySelector('.selected-count') || document.getElementById('selectedCountBadge');
  const count = selectedTracks.size;

  if (counterElement) {
    counterElement.textContent = `${count} tracks selected`;
  }
}

function clearAllSelections() {
  selectedTracks.clear();
  const checkboxes = document.querySelectorAll('.track-checkbox');
  checkboxes.forEach(cb => cb.checked = false);
  
  const mainCheckbox = document.getElementById('select-all-checkbox');
  if (mainCheckbox) mainCheckbox.checked = false;

  updateSelectedCounter();
}

// ==========================================
// PLAYLISTS: CREAR, EDITAR Y RENOMBRAR
// ==========================================
async function submitPlaylist() {
  const nameInput = document.getElementById('playlist-name-input');
  let playlistName = nameInput ? nameInput.value.trim() : '';

  if (!playlistName) {
    playlistName = prompt('Ingresa el nombre de la nueva playlist:');
  }

  if (!playlistName || !playlistName.trim()) {
    return;
  }

  const tracksArray = Array.from(selectedTracks.keys());

  if (tracksArray.length === 0) {
    alert('Selecciona al menos una canción antes de crear la playlist.');
    return;
  }

  try {
    const res = await fetch('/api/playlists/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playlistName.trim(), tracks: tracksArray })
    });

    const data = await res.json();

    if (data.success) {
      alert(`Playlist "${playlistName}" creada exitosamente con ${data.count} canción(es)!`);
      if (nameInput) nameInput.value = '';
      clearAllSelections();
      if (typeof loadPlaylists === 'function') loadPlaylists();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (err) {
    console.error('Error al crear la playlist:', err);
    alert('Ocurrió un error al intentar guardar la nueva playlist.');
  }
}

async function startEditingPlaylist(filename) {
  try {
    let data = null;
    
    try {
      const res = await fetch(`/api/playlists/details?filename=${encodeURIComponent(filename)}`);
      if (res.ok) {
        data = await res.json();
      }
    } catch (e) {
      console.warn('Fallo al obtener detalles de la playlist.');
    }

    currentEditingPlaylist = {
      filename: (data && data.filename) ? data.filename : filename,
      name: (data && data.name) ? data.name : filename.replace(/\.m3u8$/i, ''),
      tracks: (data && data.tracks) ? data.tracks : []
    };

    clearAllSelections();

    const displayList = [];

    currentEditingPlaylist.tracks.forEach(track => {
      const trackPath = typeof track === 'object' ? (track.path || track.filePath) : track;
      if (!trackPath) return;

      selectedTracks.set(trackPath, trackPath);

      if (typeof track === 'object' && !track.missing) {
        displayList.push(track);
      } else {
        displayList.push({
          path: trackPath,
          title: track.title || 'Error to found the file',
          artist: trackPath.split('\\').pop() || trackPath,
          album: 'Missing File',
          bpm: '--',
          key: '--',
          missing: true
        });
      }
    });

    collectionCache.forEach(cacheTrack => {
      const cPath = typeof cacheTrack === 'object' ? (cacheTrack.path || cacheTrack.filePath) : cacheTrack;
      if (!selectedTracks.has(cPath)) {
        displayList.push(cacheTrack);
      }
    });

    renderTrackList(displayList);
    updateSelectedCounter();
    showEditingBanner(currentEditingPlaylist.name);
    navigateToLibraryTab();

  } catch (err) {
    console.error('Error al abrir la playlist para edición:', err);
    alert('Ocurrió un error al cargar la playlist para edición.');
  }
}

function showEditingBanner(playlistName) {
  let banner = document.getElementById('editingPlaylistBanner');
  
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'editingPlaylistBanner';
    banner.style.cssText = 'background: #2a1f00; border: 1px solid #ffb86c; color: #ffb86c; padding: 12px 20px; margin: 10px 0 20px 0; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; z-index: 100;';
    
    const targetParent = document.getElementById('track-list-container')?.parentElement || document.body;
    targetParent.insertBefore(banner, targetParent.firstChild);
  }

  banner.innerHTML = `
    <div>
      <strong style="font-size: 15px;">Editing Playlist: "${playlistName}"</strong>
      <div style="font-size: 12px; color: #d4a359; margin-top: 2px;">
        Uncheck missing tracks (flagged red) or select new ones from the list, then click Save Changes.
      </div>
    </div>
    <div style="display: flex; gap: 10px;">
      <button onclick="updateEditingPlaylistTracks()" style="background: #28a745; color: white; border: none; padding: 6px 14px; border-radius: 4px; font-weight: bold; cursor: pointer;">
        Save Changes
      </button>
      <button onclick="cancelEditingPlaylist()" style="background: #dc3545; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer;">
        Cancel
      </button>
    </div>
  `;
  banner.style.display = 'flex';
}

function navigateToLibraryTab() {
  const libraryTabBtn = document.querySelector('[data-tab="library"], [href="#library"], a[title*="Library"]');
  if (libraryTabBtn) {
    libraryTabBtn.click();
  } else {
    const librarySection = document.getElementById('library-section') || document.getElementById('play-library');
    if (librarySection) {
      document.querySelectorAll('section, .tab-content').forEach(s => s.style.display = 'none');
      librarySection.style.display = 'block';
    }
  }
}

// ==========================================
// Guardar Cambios en Playlist con Filtro Inteligente de Duplicados
// ==========================================
async function updateEditingPlaylistTracks() {
  if (!currentEditingPlaylist || !currentEditingPlaylist.filename) {
    alert('No hay ninguna playlist activa en edición.');
    return;
  }

  // Obtener todas las rutas seleccionadas actualmente
  const selectedPaths = Array.from(selectedTracks.keys());

  if (selectedPaths.length === 0) {
    if (!confirm('No has seleccionado ninguna canción. ¿Deseas guardar la playlist vacía?')) {
      return;
    }
  }

  // 1. Detección de duplicados en la lista seleccionada
  const uniquePaths = [];
  const duplicatePaths = [];
  const seenMap = new Map();

  selectedPaths.forEach(trackPath => {
    const normalized = String(trackPath).trim().toLowerCase();
    if (seenMap.has(normalized)) {
      duplicatePaths.push(trackPath);
    } else {
      seenMap.set(normalized, true);
      uniquePaths.push(trackPath);
    }
  });

  let finalTracksToSave = selectedPaths;

  // 2. Si se detectan duplicados, pedir decisión al usuario
  if (duplicatePaths.length > 0) {
    const duplicateNames = duplicatePaths.map(p => `- ${pathBasename(p)}`).slice(0, 5).join('\n');
    const extraCount = duplicatePaths.length > 5 ? `\n... y ${duplicatePaths.length - 5} más.` : '';

    const keepDuplicates = confirm(
      `Se detectaron ${duplicatePaths.length} canción(es) duplicada(s) en tu selección:\n\n` +
      `${duplicateNames}${extraCount}\n\n` +
      `• Haz clic en [Aceptar] si deseas PERMITIR y mantener los duplicados.\n` +
      `• Haz clic en [Cancelar] para OMITIR e ignorar los duplicados (guardar solo canciones únicas).`
    );

    if (!keepDuplicates) {
      // El usuario eligió OMITIR duplicados: guardamos solo la lista limpia
      finalTracksToSave = uniquePaths;
    }
  }

  // 3. Envío al servidor
  try {
    const res = await fetch('/api/playlists/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: currentEditingPlaylist.filename,
        tracks: finalTracksToSave
      })
    });

    const data = await res.json();

    if (data.success) {
      const omittedCount = selectedPaths.length - finalTracksToSave.length;
      const msgExtra = omittedCount > 0 ? ` (Se omitieron ${omittedCount} duplicados)` : '';
      alert(`Playlist "${currentEditingPlaylist.name}" actualizada con éxito (${data.count} canciones).${msgExtra}`);
      
      cancelEditingPlaylist();
      if (typeof loadPlaylists === 'function') loadPlaylists();
    } else {
      alert(`Error al actualizar: ${data.error}`);
    }
  } catch (err) {
    console.error('Error al guardar cambios de la playlist:', err);
    alert('Ocurrió un error al actualizar la playlist.');
  }
}

function cancelEditingPlaylist() {
  currentEditingPlaylist = null;
  
  const banner = document.getElementById('editingPlaylistBanner');
  if (banner) {
    banner.style.display = 'none';
  }

  clearAllSelections();
  renderTrackList(collectionCache);
}

async function renamePlaylist(oldFilename) {
  const currentName = oldFilename.replace(/\.m3u8$/i, '');
  const newName = prompt(`Enter new name for playlist "${currentName}":`, currentName);
  
  if (!newName || !newName.trim() || newName.trim() === currentName) return;

  try {
    const res = await fetch('/api/playlists/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldFilename: oldFilename,
        newName: newName.trim()
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      if (typeof loadPlaylists === 'function') loadPlaylists();
    } else {
      alert(`An error occurred while renaming the playlist: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error('Error al renombrar playlist:', err);
    alert('An error occurred while renaming the playlist.');
  }
}

// ==========================================
// Reproductor Global y Streaming de Audio
// ==========================================
function parseTimeToSeconds(timeVal) {
  if (typeof timeVal === 'number' && !isNaN(timeVal)) return timeVal;
  if (!timeVal || typeof timeVal !== 'string') return 0;
  
  const parts = timeVal.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}

function formatSecondsToTime(seconds) {
  if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function getTrackDuration() {
  const player = document.getElementById('global-audio-player');
  if (player && isFinite(player.duration) && !isNaN(player.duration) && player.duration > 0) {
    return player.duration;
  }

  if (currentActiveTrackObj) {
    const meta = currentActiveTrackObj.format || currentActiveTrackObj.metadata || currentActiveTrackObj.tags || {};
    const rawDur = currentActiveTrackObj.durationSeconds 
                || currentActiveTrackObj.duration 
                || currentActiveTrackObj.length 
                || currentActiveTrackObj.time 
                || meta.duration;
    const parsed = parseTimeToSeconds(rawDur);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function initGlobalAudioPlayer() {
  let player = document.getElementById('global-audio-player');
  if (!player) {
    player = document.createElement('audio');
    player.id = 'global-audio-player';
    player.controls = true;
    player.style.cssText = 'position: fixed; bottom: 10px; right: 10px; z-index: 9999; background: #111; border: 1px solid #333; border-radius: 6px; padding: 4px; display: none;';
    document.body.appendChild(player);
  }

  const waveformWrapper = document.getElementById('waveformWrapper') || document.querySelector('.waveform-wrapper');
  if (waveformWrapper) {
    waveformWrapper.onclick = seekAudio;
  }
}

function seekAudio(event) {
  const player = document.getElementById('global-audio-player');
  if (!player) return;

  const totalDuration = getTrackDuration();
  if (!totalDuration || totalDuration <= 0) return;

  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const pct = clickX / rect.width;
  
  player.currentTime = pct * totalDuration;
}

function releaseAudioPlayer() {
  const player = document.getElementById('global-audio-player');
  if (player) {
    player.pause();
    player.removeAttribute('src');
    player.load();
  }
}

function playAudio(trackPath) {
  releaseAudioPlayer();

  const streamUrl = `/audio-stream?path=${encodeURIComponent(trackPath)}`;
  let player = document.getElementById('global-audio-player');

  if (!player) {
    initGlobalAudioPlayer();
    player = document.getElementById('global-audio-player');
  }

  currentActiveTrackObj = collectionCache.find(t => {
    const p = typeof t === 'object' ? (t.path || t.filePath) : t;
    return p === trackPath;
  });

  let fallbackDurationSeconds = 0;
  if (currentActiveTrackObj) {
    const meta = currentActiveTrackObj.format || currentActiveTrackObj.metadata || currentActiveTrackObj.tags || {};
    const rawDuration = currentActiveTrackObj.durationSeconds 
                      || currentActiveTrackObj.duration 
                      || currentActiveTrackObj.length 
                      || currentActiveTrackObj.time 
                      || meta.duration;
    fallbackDurationSeconds = parseTimeToSeconds(rawDuration);
  }

  const applyDurationFix = () => {
    const totalDuration = getTrackDuration();

    if (!isFinite(player.duration) || isNaN(player.duration)) {
      if (fallbackDurationSeconds > 0) {
        try {
          Object.defineProperty(player, 'duration', {
            value: fallbackDurationSeconds,
            writable: true,
            configurable: true
          });
        } catch (e) {}
      }
    }

    const waveformProgress = document.getElementById('waveformProgress') || document.querySelector('.waveform-progress');
    if (waveformProgress && totalDuration > 0) {
      const pct = (player.currentTime / totalDuration) * 100;
      waveformProgress.style.width = `${Math.min(pct, 100)}%`;
    }

    const timeDisplay = document.getElementById('timeDisplay');
    if (timeDisplay) {
      timeDisplay.textContent = `${formatSecondsToTime(player.currentTime)} / ${formatSecondsToTime(totalDuration)}`;
    }

    const allLabels = document.querySelectorAll('span, div, p');
    allLabels.forEach(el => {
      if (el.children.length === 0 && el.textContent && (el.textContent.includes('Infinity') || el.textContent.includes('NaN'))) {
        const curTimeStr = formatSecondsToTime(player.currentTime || 0);
        const durTimeStr = formatSecondsToTime(totalDuration);
        el.textContent = `${curTimeStr} / ${durTimeStr}`;
      }
    });
  };

  player.onloadedmetadata = applyDurationFix;
  player.ondurationchange = applyDurationFix;
  player.ontimeupdate = applyDurationFix;

  player.src = streamUrl;
  player.load();
  
  player.play().catch(e => {
    if (e.name !== 'AbortError') {
      console.error('Error reproducing track:', e);
    }
  });
}