// ==========================================
// Estado Global del Cliente
// ==========================================
const selectedTracks = new Map();
let collectionCache = [];

// Instancia de Socket.IO para comunicación en tiempo real
let socket = null;

// Escuchar inicio de la aplicación
document.addEventListener('DOMContentLoaded', () => {
  loadCollection();
  initGlobalAudioPlayer();
  initLiveSocketUpdates();
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
  } else {
    console.warn('Socket.io script no detectado en el cliente web.');
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
// Cargar Colección de Música
// ==========================================
async function loadCollection() {
  try {
    const res = await fetch('/api/collection');
    collectionCache = await res.json();
    
    const queryInput = document.getElementById('search-input');
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
  const queryInput = document.getElementById('search-input');
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
// Renderizado de Pistas con Diseño UI Original (Badges Key, Bits, BPM)
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
    
    // Extracción de metadatos respetando el formato visual del Dashboard
    const title = track.title || track.name || (typeof trackPath === 'string' ? trackPath.split('\\').pop() : 'Unknown Track');
    const artist = track.artist || 'Unknown Artist';
    const album = track.album || '';
    const bpm = track.bpm ? track.bpm : '--';
    const key = (track.key || track.initialKey) ? (track.key || track.initialKey) : '--';
    const format = track.format ? track.format.toUpperCase() : (trackPath ? trackPath.split('.').pop().toUpperCase() : 'AUDIO');
    const bits = track.bits || track.bitrate || 'N/A';
    const coverUrl = `/api/cover?path=${encodeURIComponent(trackPath)}`;

    // Extraer carpeta de origen
    const folderName = trackPath ? trackPath.split('\\').slice(-2, -1)[0] || 'Root' : 'Root';

    const card = document.createElement('div');
    card.className = 'track-card';
    
    const safePath = String(trackPath).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    card.innerHTML = `
      <div class="track-select">
        <input 
          type="checkbox" 
          class="track-checkbox" 
          ${isChecked ? 'checked' : ''} 
          onchange="toggleTrackSelection('${safePath}', this.checked)"
        />
      </div>

      <div class="track-action">
        <button class="btn-play" onclick="playAudio('${safePath}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>

      <div class="track-format">
        <span class="format-badge ${format.toLowerCase()}">${format}</span>
      </div>

      <div class="track-folder">
        <span class="folder-name">${folderName}</span>
      </div>

      <div class="track-artwork">
        <img src="${coverUrl}" alt="Cover" onerror="this.src='/images/default-cover.png';" />
      </div>

      <div class="track-details">
        <div class="track-title">${title}</div>
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
// Seleccionar Todo / Desmarcar Todo
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

// ==========================================
// Manejo de Estado y Contador de Selección
// ==========================================
function toggleTrackSelection(trackPath, isChecked) {
  if (isChecked) {
    selectedTracks.set(trackPath, trackPath);
  } else {
    selectedTracks.delete(trackPath);
  }
  updateSelectedCounter();
}

function updateSelectedCounter() {
  const counterElement = document.getElementById('selected-counter') || document.querySelector('.selected-count');
  const clearBtn = document.getElementById('clear-selection-btn');
  const count = selectedTracks.size;

  if (counterElement) {
    counterElement.textContent = `${count} tracks selected`;
  }

  if (clearBtn) {
    clearBtn.style.display = count > 0 ? 'inline-block' : 'none';
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
// Crear y Enviar Playlist
// ==========================================
async function submitPlaylist() {
  const nameInput = document.getElementById('playlist-name-input');
  if (!nameInput) return;
  
  const playlistName = nameInput.value.trim();
  const tracksArray = Array.from(selectedTracks.keys());

  if (!playlistName) {
    alert('Please enter a name for the playlist.');
    return;
  }

  if (tracksArray.length === 0) {
    alert('Select at least one track before creating the playlist.');
    return;
  }

  try {
    const res = await fetch('/api/playlists/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: playlistName, tracks: tracksArray })
    });

    const data = await res.json();

    if (data.success) {
      alert(`Playlist "${playlistName}" created successfully with ${data.count} songs!`);
      nameInput.value = '';
      clearAllSelections();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (err) {
    console.error('Error al enviar la playlist:', err);
    alert('An error occurred while trying to save the playlist.');
  }
}

// ==========================================
// Reproductor Global y Streaming de Audio (Con liberador de archivos para Windows)
// ==========================================
function initGlobalAudioPlayer() {
  let player = document.getElementById('global-audio-player');
  if (!player) {
    player = document.createElement('audio');
    player.id = 'global-audio-player';
    player.controls = true;
    player.style.cssText = 'position: fixed; bottom: 10px; right: 10px; z-index: 9999; background: #111; border: 1px solid #333; border-radius: 6px; padding: 4px;';
    document.body.appendChild(player);
  }
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

  player.src = streamUrl;
  player.load();
  
  player.play().catch(e => {
    if (e.name !== 'AbortError') {
      console.error('Error reproducing track:', e);
    }
  });
}