const fs = require('fs');
const path = require('path');
let parseFile;

// Importación dinámica para compatibilidad con CommonJS y ES Modules en music-metadata
(async () => {
  try {
    const mm = await import('music-metadata');
    parseFile = mm.parseFile;
    // Iniciar parseo de metadatos una vez cargado el módulo
    parseMetadataInBackground();
  } catch (err) {
    console.warn('[WARN] music-metadata not loaded yet or failed to load:', err.message);
  }
})();

const MUSIC_ROOT_DIRECTORY = 'D:\\Music Library';
const SUPPORTED_EXTENSIONS = new Set(['.mp3', '.wav', '.aiff', '.aif', '.flac', '.m4a']);

// ==========================================
// CACHÉ EN MEMORIA (IN-MEMORY DATABASE)
// ==========================================
let cachedCollection = [];
let isParsingMetadata = false;

/**
 * Parsea el nombre del archivo como fallback rápido si no hay tags ID3 cargados.
 */
function parseTrackDetails(fileName) {
  const ext = path.extname(fileName);
  let baseName = path.basename(fileName, ext).trim();

  // Limpiar números de pista al inicio (ej. "01 ", "06 - ", "12. ")
  baseName = baseName.replace(/^\d+[\s\.\-_]+/, '').trim();

  let artist = 'Unknown';
  let title = baseName;

  if (baseName.includes(' - ')) {
    const parts = baseName.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  } else {
    const match = baseName.match(/[\(\[](.*?)(?:Remix|Mix|Mashup|Edit|Bootleg)[\)\]]/i);
    if (match && match[1]) {
      artist = match[1].replace(/vs\.?|feat\.?|&/gi, '').trim();
    }
  }

  if (!title) title = baseName;
  return { artist, title };
}

/**
 * Escanea la carpeta en disco y construye la colección.
 */
function scanMusicDirectory(dirPath = MUSIC_ROOT_DIRECTORY) {
  let results = [];

  if (!fs.existsSync(dirPath)) {
    return results;
  }

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);

      if (item.isDirectory() && item.name.toLowerCase() === 'playlistnexusmusic') {
        continue;
      }

      if (item.isDirectory()) {
        results = results.concat(scanMusicDirectory(fullPath));
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          const relativePath = path.relative(MUSIC_ROOT_DIRECTORY, fullPath);
          const pathParts = relativePath.split(path.sep);
          const folderName = pathParts.length > 1 ? pathParts[0] : 'Raíz';
          const albumFallback = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';

          const { artist, title } = parseTrackDetails(item.name);

          results.push({
            filename: item.name,
            filePath: fullPath,
            path: fullPath,
            folder: folderName,
            album: albumFallback || 'Single / Unknown Album',
            format: ext.replace('.', '').toUpperCase(),
            title: title,
            artist: artist,
            bpm: '--',
            key: '--',
            bitrate: null,
            hasMetadata: false
          });
        }
      }
    }
  } catch (err) {
    console.error(`[ERROR SCANNING DIRECTORY] ${dirPath}:`, err.message);
  }

  return results;
}

/**
 * Carga o refresca la memoria RAM.
 */
function loadCollection() {
  console.log('⚡ [DATA MANAGER] Indexando biblioteca musical en memoria RAM...');
  const start = Date.now();
  cachedCollection = scanMusicDirectory();
  console.log(`🚀 [DATA MANAGER] ${cachedCollection.length} pistas cargadas en RAM (${Date.now() - start}ms).`);
  parseMetadataInBackground();
  return cachedCollection;
}

/**
 * Lee metadatos reales (ID3, BPM, Key, Album) sin bloquear las búsquedas ni el audio.
 */
async function parseMetadataInBackground() {
  if (isParsingMetadata || !parseFile || cachedCollection.length === 0) return;
  isParsingMetadata = true;

  for (let track of cachedCollection) {
    if (track.hasMetadata) continue;
    try {
      const metadata = await parseFile(track.filePath, { skipCovers: true });
      if (metadata.common) {
        if (metadata.common.title) track.title = metadata.common.title;
        if (metadata.common.artist) track.artist = metadata.common.artist;
        if (metadata.common.album) track.album = metadata.common.album;
        if (metadata.common.bpm) track.bpm = Math.round(metadata.common.bpm);
        if (metadata.common.initialKey) track.key = metadata.common.initialKey;
      }
      if (metadata.format && metadata.format.bitrate) {
        track.bitrate = Math.round(metadata.format.bitrate / 1000);
      }
      track.hasMetadata = true;
    } catch (e) {
      track.hasMetadata = true; // Evitar reintentar archivos dañados
    }
  }
  isParsingMetadata = false;
}

// Inicialización automática de la RAM al arrancar el servidor
loadCollection();

/**
 * Búsqueda Inteligente Ultra-Rápida sobre RAM.
 */
function searchTracks(query) {
  const collection = cachedCollection.length > 0 ? cachedCollection : getCollectionData();
  
  if (!query || typeof query !== 'string' || !query.trim()) {
    return collection;
  }

  const keywords = query.toLowerCase().trim().split(/\s+/);

  return collection.filter(track => {
    const titleText = (track.title || '').toLowerCase();
    const artistText = (track.artist || '').toLowerCase();
    const albumText = (track.album || '').toLowerCase();
    const filenameText = (track.filename || '').toLowerCase();
    const folderText = (track.folder || '').toLowerCase();
    const fullPathText = (track.path || '').toLowerCase();

    return keywords.every(keyword => {
      return (
        titleText.includes(keyword) ||
        artistText.includes(keyword) ||
        albumText.includes(keyword) ||
        filenameText.includes(keyword) ||
        folderText.includes(keyword) ||
        fullPathText.includes(keyword)
      );
    });
  }).sort((a, b) => {
    const firstKeyword = keywords[0];
    const aMatchMetadata = (a.title || '').toLowerCase().includes(firstKeyword) || (a.artist || '').toLowerCase().includes(firstKeyword);
    const bMatchMetadata = (b.title || '').toLowerCase().includes(firstKeyword) || (b.artist || '').toLowerCase().includes(firstKeyword);

    if (aMatchMetadata && !bMatchMetadata) return -1;
    if (!aMatchMetadata && bMatchMetadata) return 1;
    return 0;
  });
}

function getCollectionData() {
  if (cachedCollection.length === 0) {
    return loadCollection();
  }
  return cachedCollection;
}

function getStats() {
  const collection = getCollectionData();
  
  let playlistsCount = 0;
  const playlistsDir = path.join(MUSIC_ROOT_DIRECTORY, 'playlistnexusmusic');
  if (fs.existsSync(playlistsDir)) {
    playlistsCount = fs.readdirSync(playlistsDir).filter(f => f.endsWith('.m3u8')).length;
  }

  return {
    totalTracks: collection.length,
    totalPlaylists: playlistsCount
  };
}

module.exports = {
  getCollectionData,
  getCollection: getCollectionData,
  getAllTracks: getCollectionData,
  getTracks: getCollectionData,
  getStats,
  searchTracks,
  loadCollection,
  reload: loadCollection,
  init: loadCollection
};