const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dataManager = require('./data_manager');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Main root music library directory
const MUSIC_ROOT_DIRECTORY = 'D:\\Music Library';

// Centralized target directory to store backup playlists and direct Rekordbox reads
const TARGET_PLAYLISTS_DIR = path.join(MUSIC_ROOT_DIRECTORY, 'playlistnexusmusic');
const DEFAULT_COVER_PATH = path.join(__dirname, 'public', 'images', 'default-cover.png');

// Ensure physical existence of target playlists directory in D:\Music Library
if (!fs.existsSync(TARGET_PLAYLISTS_DIR)) {
  fs.mkdirSync(TARGET_PLAYLISTS_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// BACKGROUND WATCHDOG / AUTO-SYNC SYSTEM
// ==========================================
let watchDebounceTimeout = null;

if (fs.existsSync(MUSIC_ROOT_DIRECTORY)) {
  try {
    fs.watch(MUSIC_ROOT_DIRECTORY, { recursive: true }, (eventType, filename) => {
      // Ignorar cambios en la propia carpeta de playlists para evitar bucles infinitos
      if (filename && filename.includes('playlistnexusmusic')) return;
      if (filename && !/\.(mp3|wav|flac|m4a|aac|ogg|aiff|aif)$/i.test(filename)) return;

      // Anti-rebote (debounce) para esperar a que terminen de copiarse los archivos
      clearTimeout(watchDebounceTimeout);
      watchDebounceTimeout = setTimeout(() => {
        console.log(`🔄 [AUTO-SYNC] Change detected (${eventType}: ${filename}). Reloading catalog...`);
        
        if (typeof dataManager.loadCollection === 'function') {
          dataManager.loadCollection();
        } else if (typeof dataManager.init === 'function') {
          dataManager.init();
        } else if (typeof dataManager.reload === 'function') {
          dataManager.reload();
        }

        io.emit('catalog-updated', { time: Date.now() });
      }, 1500);
    });
    console.log(`👁️ [WATCHDOG] Active file watcher listening on ${MUSIC_ROOT_DIRECTORY}`);
  } catch (err) {
    console.warn(`[WATCHDOG WARN] Could not initialize fs.watch:`, err.message);
  }
}

// ==========================================
// API: Main Statistics
// ==========================================
app.get('/api/stats', (req, res) => {
  try {
    let stats = {};
    if (typeof dataManager.getStats === 'function') {
      stats = dataManager.getStats();
    }
    res.json(stats || { totalTracks: 0, totalPlaylists: 0 });
  } catch (err) {
    console.error('Error fetching statistics:', err);
    res.json({ totalTracks: 0, totalPlaylists: 0 });
  }
});

// ==========================================
// API: Full Collection Retrieval
// ==========================================
app.get('/api/collection', (req, res) => {
  try {
    let collection = [];

    if (typeof dataManager.getCollectionData === 'function') {
      collection = dataManager.getCollectionData();
    } else if (typeof dataManager.getCollection === 'function') {
      collection = dataManager.getCollection();
    } else if (typeof dataManager.getAllTracks === 'function') {
      collection = dataManager.getAllTracks();
    } else if (typeof dataManager.getTracks === 'function') {
      collection = dataManager.getTracks();
    }

    const count = Array.isArray(collection) ? collection.length : 0;
    console.log(`[DEBUG] /api/collection requested. Tracks loaded: ${count}`);

    if (Array.isArray(collection)) {
      res.json(collection);
    } else {
      console.warn('[WARN] dataManager method did not return a valid Array.');
      res.json([]);
    }
  } catch (err) {
    console.error('[ERROR IN GETCOLLECTIONDATA]:', err);
    res.json([]);
  }
});

// ==========================================
// API: Search Tracks (Windows Explorer Style)
// ==========================================
app.get('/api/search', (req, res) => {
  try {
    const query = req.query.q || req.query.query || '';

    if (typeof dataManager.searchTracks === 'function') {
      const results = dataManager.searchTracks(query);
      return res.json(results);
    }

    // Fallback por si la función no estuviera disponible
    res.json([]);
  } catch (err) {
    console.error('[ERROR IN /api/search]:', err);
    res.json([]);
  }
});

// ==========================================
// API: Album Cover / Artwork Stream + Default Fallback
// ==========================================
app.get('/api/cover', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (rawPath) {
      let fullFilePath = path.normalize(decodeURIComponent(rawPath).trim());
      const trackDir = path.dirname(fullFilePath);

      // Buscar imágenes de portada comunes en la carpeta de la canción
      const imageNames = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'artwork.jpg', 'album.jpg', 'Cover.jpg', 'Folder.jpg'];
      let foundCover = null;

      for (const imgName of imageNames) {
        const imgPath = path.join(trackDir, imgName);
        if (fs.existsSync(imgPath)) {
          foundCover = imgPath;
          break;
        }
      }

      if (foundCover) {
        return res.sendFile(foundCover);
      }
    }

    // Fallback: Si no existe la carátula o no se especificó ruta, entrega la imagen por defecto
    if (fs.existsSync(DEFAULT_COVER_PATH)) {
      return res.sendFile(DEFAULT_COVER_PATH);
    }

    res.status(404).send('No cover found');
  } catch (err) {
    if (fs.existsSync(DEFAULT_COVER_PATH)) {
      return res.sendFile(DEFAULT_COVER_PATH);
    }
    res.status(500).send('Error retrieving cover');
  }
});

// ==========================================
// API: Secure Audio Streaming (HTTP Range 206 + High Performance)
// ==========================================
app.get('/audio-stream', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) {
      return res.status(400).send('File path parameter is required.');
    }

    let cleanPath = decodeURIComponent(rawPath).trim();
    let fullFilePath = path.normalize(cleanPath);

    if (!fs.existsSync(fullFilePath)) {
      fullFilePath = path.join(MUSIC_ROOT_DIRECTORY, cleanPath);
    }

    if (!fs.existsSync(fullFilePath)) {
      console.error(`[AUDIO STREAM 404] Audio file not found on disk: ${fullFilePath}`);
      return res.status(404).send('Audio file does not exist on disk.');
    }

    const ext = path.extname(fullFilePath).toLowerCase();

    // TRANSCODIFICACIÓN EN TIEMPO REAL PARA ARCHIVOS .AIFF / .AIF
    if (ext === '.aiff' || ext === '.aif') {
      res.setHeader('Content-Type', 'audio/wav');
      
      ffmpeg(fullFilePath)
        .toFormat('wav')
        .on('error', (err) => {
          if (err.code !== 'ECONNRESET' && !res.headersSent) {
            console.error('[FFMPEG STREAM ERROR]:', err.message);
          }
        })
        .pipe(res, { end: true });

      return;
    }

    // STREAMING POR RANGOS HTTP (206 PARTIAL CONTENT)
    const stat = fs.statSync(fullFilePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const mimeTypes = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg'
    };
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunksize = (end - start) + 1;
      const stream = fs.createReadStream(fullFilePath, { start, end });
      
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };

      res.writeHead(206, head);
      stream.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      };
      res.writeHead(200, head);
      fs.createReadStream(fullFilePath).pipe(res);
    }

  } catch (error) {
    console.error('Internal server error while processing audio stream:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal audio streaming server error.');
    }
  }
});

// ==========================================
// API: Create & Save Playlist in D:\Music Library\playlistnexusmusic (.m3u8)
// ==========================================
app.post('/api/playlists/create', (req, res) => {
  try {
    const { name, tracks } = req.body;
    const playlistName = name || req.body.playlistName;
    const selectedTracks = tracks || req.body.selectedTracks;

    if (!playlistName || !selectedTracks || !Array.isArray(selectedTracks) || selectedTracks.length === 0) {
      return res.status(400).json({ error: 'Invalid playlist name or empty tracks selection.' });
    }

    // Process via dataManager if available
    let dataManagerResult = null;
    if (typeof dataManager.createPlaylist === 'function') {
      dataManagerResult = dataManager.createPlaylist(playlistName, selectedTracks);
    }

    const safeFileName = playlistName.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
    const filePathM3U8 = path.join(TARGET_PLAYLISTS_DIR, `${safeFileName}.m3u8`);

    let m3uContent = '#EXTM3U\n';

    selectedTracks.forEach(track => {
      let trackPath = typeof track === 'object' ? (track.path || track.filePath || track.url) : track;
      if (trackPath) {
        // Convert relative paths to absolute based on D:\Music Library
        if (!path.isAbsolute(trackPath)) {
          trackPath = path.join(MUSIC_ROOT_DIRECTORY, trackPath);
        }

        // Format exact Windows separators (D:\Music Library\...)
        const absolutePath = path.win32.normalize(trackPath);
        const fileNameWithoutExt = path.basename(absolutePath, path.extname(absolutePath));

        // Extended M3U header for Rekordbox / Engine DJ compatibility
        m3uContent += `#EXTINF:-1,${fileNameWithoutExt}\n`;
        m3uContent += `${absolutePath}\n`;
      }
    });

    // Write exclusively as .m3u8 with UTF-8 BOM
    fs.writeFileSync(filePathM3U8, '\ufeff' + m3uContent, 'utf8');

    console.log(`[PLAYLIST CREATED] "${safeFileName}.m3u8" (${selectedTracks.length} tracks) saved to ${TARGET_PLAYLISTS_DIR}`);

    res.json({ 
      success: true, 
      count: selectedTracks.length,
      message: `Playlist "${safeFileName}" created with ${selectedTracks.length} track(s) in D:\\Music Library\\playlistnexusmusic`,
      folder: TARGET_PLAYLISTS_DIR,
      playlist: dataManagerResult,
      file: `${safeFileName}.m3u8`
    });
  } catch (err) {
    console.error('Error creating playlist:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API: List Created Playlists (.m3u8)
// ==========================================
app.get('/api/playlists', (req, res) => {
  try {
    if (fs.existsSync(TARGET_PLAYLISTS_DIR)) {
      const files = fs.readdirSync(TARGET_PLAYLISTS_DIR).filter(f => f.endsWith('.m3u8'));
      return res.json(files.map(f => ({ name: f.replace(/\.m3u8$/, ''), file: f })));
    }
    res.json([]);
  } catch (err) {
    console.error('Error reading playlists directory:', err);
    res.json([]);
  }
});

// ==========================================
// WebSockets: Real-time PowerShell Execution
// ==========================================
io.on('connection', (socket) => {
  socket.emit('log', { type: 'info', text: '[SYSTEM] Connection established with live console.' });

  socket.on('run-script', ({ script }) => {
    const scriptPath = path.resolve(__dirname, '../scripts', script);
    
    if (!fs.existsSync(scriptPath)) {
      socket.emit('log', { type: 'error', text: `[ERROR] The script ${script} was not found in /scripts.` });
      return;
    }

    socket.emit('log', { type: 'warning', text: `[EXEC] Executing ${script}...` });

    const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]);

    ps.stdout.on('data', (data) => {
      socket.emit('log', { type: 'info', text: data.toString().trim() });
    });

    ps.stderr.on('data', (data) => {
      socket.emit('log', { type: 'error', text: data.toString().trim() });
    });

    ps.on('close', (code) => {
      if (code === 0) {
        socket.emit('log', { type: 'success', text: `[SUCCESS] ${script} completed successfully.` });
      } else {
        socket.emit('log', { type: 'error', text: `[ERROR] ${script} finished with exit code ${code}.` });
      }
    });
  });
});

// Universal SPA / Static Fallback Route
app.use((req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Server is running. Please check that the public/ folder contains index.html');
  }
});

// Start HTTP & Socket.IO Server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Music root directory configured at: ${MUSIC_ROOT_DIRECTORY}`);
  console.log(`Target playlists directory configured at: ${TARGET_PLAYLISTS_DIR}`);
});