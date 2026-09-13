// ==========================================
// Estado Global del Cliente
// ==========================================
const selectedTracks = new Map(); // Guarda pares key: ruta, value: objeto track o ruta
let collectionCache = [];

// Escuchar inicio de la aplicación
document.addEventListener('DOMContentLoaded', () => {
  loadCollection();
  initGlobalAudioPlayer();
});

// ==========================================
// Cargar Colección de Música
// ==========================================
async function loadCollection() {
  try {
    const res = await fetch('/api/collection');
    collectionCache = await res.json();
    renderTrackList(collectionCache);
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
    const path = (track.path || track.filePath || '').toLowerCase();
    return title.includes(query) || artist.includes(query) || path.includes(query);
  });

  renderTrackList(filtered);
}

// ==========================================
// Renderizado de Pistas con Persistencia de Selección
// ==========================================
function renderTrackList(tracks) {
  const container = document.getElementById('track-list-container');
  if (!container) return;
  
  container.innerHTML = '';

  if (!tracks || tracks.length === 0) {
    container.innerHTML = '<p style="padding: 10px; color: #888;">tracks not found.</p>';
    return;
  }

  tracks.forEach(track => {
    const trackPath = typeof track === 'object' ? (track.path || track.filePath) : track;
    const isChecked = selectedTracks.has(trackPath);
    const title = track.title || track.name || trackPath.split('\\').pop();

    const trackRow = document.createElement('div');
    trackRow.className = 'track-row';
    trackRow.style.cssText = 'display: flex; align-items: center; padding: 8px; border-bottom: 1px solid #333; gap: 10px;';

    // Escapar barras para llamada inline
    const safePath = trackPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    trackRow.innerHTML = `
      <input 
        type="checkbox" 
        class="track-checkbox" 
        ${isChecked ? 'checked' : ''} 
        onchange="toggleTrackSelection('${safePath}', this.checked)"
      />
      <span style="flex-grow: 1;">${title}</span>
      <button onclick="playAudio('${safePath}')" style="padding: 4px 8px; cursor: pointer;">▶ Play</button>
    `;

    container.appendChild(trackRow);
  });
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
  const counterElement = document.getElementById('selected-counter');
  const clearBtn = document.getElementById('clear-selection-btn');
  const count = selectedTracks.size;

  if (counterElement) {
    counterElement.textContent = `${count} ${count === 1 ? 'pista seleccionada' : 'pistas seleccionadas'}`;
  }

  if (clearBtn) {
    clearBtn.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

function clearAllSelections() {
  selectedTracks.clear();

  // Desmarcar elementos visibles en pantalla
  const checkboxes = document.querySelectorAll('.track-checkbox');
  checkboxes.forEach(cb => cb.checked = false);

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
// Reproductor Global y Streaming de Audio Ultra-Rápido
// ==========================================
function initGlobalAudioPlayer() {
  let player = document.getElementById('global-audio-player');
  if (!player) {
    player = document.createElement('audio');
    player.id = 'global-audio-player';
    player.controls = true;
    player.style.cssText = 'position: fixed; bottom: 10px; right: 10px; z-index: 9999; background: #222; border-radius: 4px; padding: 4px;';
    document.body.appendChild(player);
  }
}

function playAudio(trackPath) {
  const streamUrl = `/audio-stream?path=${encodeURIComponent(trackPath)}`;
  let player = document.getElementById('global-audio-player');

  if (!player) {
    initGlobalAudioPlayer();
    player = document.getElementById('global-audio-player');
  }

  // Detener la reproducción anterior e inyectar el nuevo flujo sin demoras
  player.pause();
  player.src = streamUrl;
  player.load(); // Forzar reinicio de buffer en el navegador
  
  player.play().catch(e => {
    if (e.name !== 'AbortError') {
      console.error('Error reproducing track:', e);
    }
  });
}