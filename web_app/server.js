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

// Registro global para liberación estricta de File Handles y kill de streams
const activeAudioStreams = new Map();

// Rutas principales
const MUSIC_ROOT_DIRECTORY = 'D:\\Music Library';
const TARGET_PLAYLISTS_DIR = path.join(MUSIC_ROOT_DIRECTORY, 'playlistnexusmusic');
const DEFAULT_COVER_PATH = path.join(__dirname, 'public', 'images', 'default-cover.png');

if (!fs.existsSync(TARGET_PLAYLISTS_DIR)) {
  fs.mkdirSync(TARGET_PLAYLISTS_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Helpers de tiempo y stats
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

function getCurrentStats() {
  let collection = getInternalCollection();
  return {
    totalTracks: Array.isArray(collection) ? collection.length : 0,
    totalPlaylists: fs.existsSync(TARGET_PLAYLISTS_DIR) ? fs.readdirSync(TARGET_PLAYLISTS_DIR).filter(f => f.endsWith('.m3u8')).length : 0
  };
}

function getInternalCollection() {
  if (typeof dataManager.getCollectionData === 'function') return dataManager.getCollectionData();
  if (typeof dataManager.getCollection === 'function') return dataManager.getCollection();
  if (typeof dataManager.getAllTracks === 'function') return dataManager.getAllTracks();
  if (typeof dataManager.getTracks === 'function') return dataManager.getTracks();
  return [];
}

// Helper para resolver la ruta absoluta de una playlist de manera segura (admite puntos internos en el nombre)
function resolvePlaylistPath(filename) {
  let cleanName = String(filename || '').trim();
  if (!cleanName.toLowerCase().endsWith('.m3u8')) {
    cleanName += '.m3u8';
  }
  return path.join(TARGET_PLAYLISTS_DIR, path.basename(cleanName));
}

// ==========================================
// WATCHDOG (Solo Sincronización Silenciosa)
// ==========================================
let watchDebounceTimeout = null;

if (fs.existsSync(MUSIC_ROOT_DIRECTORY)) {
  try {
    fs.watch(MUSIC_ROOT_DIRECTORY, { recursive: true }, (eventType, filename) => {
      if (filename && filename.includes('playlistnexusmusic')) return;

      clearTimeout(watchDebounceTimeout);
      watchDebounceTimeout = setTimeout(async () => {
        console.log(`🔄 [AUTO-SYNC] Cambio detectado (${eventType}: ${filename}). Recargando catálogo...`);

        if (typeof dataManager.loadCollection === 'function') {
          await dataManager.loadCollection();
        } else if (typeof dataManager.init === 'function') {
          await dataManager.init();
        }

        const stats = getCurrentStats();
        io.emit('catalog-updated', { time: Date.now(), stats: stats });
        io.emit('stats-updated', stats);
      }, 1500);
    });
    console.log(`👁️ [WATCHDOG] Monitoreo pasivo activo en ${MUSIC_ROOT_DIRECTORY}`);
  } catch (err) {
    console.warn(`[WATCHDOG WARN] No se pudo inicializar fs.watch:`, err.message);
  }
}

// API Routes
app.get('/api/stats', (req, res) => res.json(getCurrentStats()));

app.get('/api/collection', (req, res) => res.json(getInternalCollection()));

app.get('/api/search', (req, res) => {
  const query = req.query.q || req.query.query || '';
  if (typeof dataManager.searchTracks === 'function') {
    return res.json(dataManager.searchTracks(query));
  }
  res.json([]);
});

app.get('/api/cover', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (rawPath) {
      let fullFilePath = path.normalize(decodeURIComponent(rawPath).trim());
      const trackDir = path.dirname(fullFilePath);
      const imageNames = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'artwork.jpg', 'album.jpg'];
      for (const imgName of imageNames) {
        const imgPath = path.join(trackDir, imgName);
        if (fs.existsSync(imgPath)) return res.sendFile(imgPath);
      }
    }
    if (fs.existsSync(DEFAULT_COVER_PATH)) return res.sendFile(DEFAULT_COVER_PATH);
    res.status(404).send('No cover found');
  } catch (err) {
    res.status(500).send('Error retrieving cover');
  }
});

// STREAMING CON CONTROL Y CERRADO DE HANDLES
app.get('/audio-stream', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) return res.status(400).send('Ruta de archivo requerida.');

    let cleanPath = decodeURIComponent(rawPath).trim();
    let fullFilePath = path.normalize(cleanPath);

    if (!fs.existsSync(fullFilePath)) {
      fullFilePath = path.join(MUSIC_ROOT_DIRECTORY, cleanPath);
    }

    if (!fs.existsSync(fullFilePath)) return res.status(404).send('Archivo de audio no encontrado.');

    const stat = fs.statSync(fullFilePath);
    const fileSize = stat.size;
    const ext = path.extname(fullFilePath).toLowerCase();
    const range = req.headers.range;

    const streamId = `${req.ip}-${Date.now()}`;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Accept-Ranges', 'bytes');

    // Manejo para AIFF con FFmpeg
    if (ext === '.aiff' || ext === '.aif') {
      res.setHeader('Content-Type', 'audio/wav');
      
      const ffmpegCommand = ffmpeg(fullFilePath).toFormat('wav');
      activeAudioStreams.set(streamId, ffmpegCommand);

      ffmpegCommand.on('error', (err) => {
        if (err.message && err.message.includes('SIGKILL')) return;
        if (!res.headersSent) {
          try { res.status(500).send('Error en la transcodificación.'); } catch (e) {}
        }
      });

      const cleanupFFmpeg = () => {
        if (activeAudioStreams.has(streamId)) {
          try {
            const cmd = activeAudioStreams.get(streamId);
            if (cmd && typeof cmd.kill === 'function') cmd.kill('SIGKILL');
          } catch (e) {}
          activeAudioStreams.delete(streamId);
        }
      };

      req.on('close', cleanupFFmpeg);
      req.on('end', cleanupFFmpeg);
      res.on('finish', cleanupFFmpeg);

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const startByte = parseInt(parts[0], 10);
        res.writeHead(206, {
          'Content-Range': `bytes ${startByte}-${fileSize - 1}/${fileSize}`,
          'Content-Type': 'audio/wav',
        });
      }

      ffmpegCommand.pipe(res, { end: true });
      return;
    }

    const mimeTypes = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4' };
    const contentType = mimeTypes[ext] || 'audio/mpeg';

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      const stream = fs.createReadStream(fullFilePath, { start, end });
      activeAudioStreams.set(streamId, stream);

      const cleanupStream = () => {
        if (activeAudioStreams.has(streamId)) {
          try {
            const s = activeAudioStreams.get(streamId);
            if (s && typeof s.destroy === 'function') s.destroy();
          } catch (e) {}
          activeAudioStreams.delete(streamId);
        }
      };

      req.on('close', cleanupStream);
      req.on('end', cleanupStream);
      res.on('finish', cleanupStream);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': contentType });
      const stream = fs.createReadStream(fullFilePath);
      activeAudioStreams.set(streamId, stream);

      const cleanupStream = () => {
        if (activeAudioStreams.has(streamId)) {
          try {
            const s = activeAudioStreams.get(streamId);
            if (s && typeof s.destroy === 'function') s.destroy();
          } catch (e) {}
          activeAudioStreams.delete(streamId);
        }
      };

      req.on('close', cleanupStream);
      req.on('end', cleanupStream);
      res.on('finish', cleanupStream);

      stream.pipe(res);
    }
  } catch (error) {
    if (!res.headersSent) res.status(500).send('Error de streaming de audio.');
  }
});

// ==========================================
// PLAYLISTS API (ROBUSTO Y CON SOPORTE COMPLETO DE RENOMBRADO Y ACTUALIZACIÓN DUAL)
// ==========================================
app.post('/api/playlists/create', (req, res) => {
  try {
    const { name, tracks } = req.body;
    if (!name || !tracks || !Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({ error: 'Nombre o canciones inválidas.' });
    }

    const safeFileName = name.replace(/[^a-zA-Z0-9_\-\s\.]/g, '').trim();
    const filePathM3U8 = resolvePlaylistPath(safeFileName);

    let m3uContent = '#EXTM3U\n';
    tracks.forEach(track => {
      let trackPath = typeof track === 'object' ? (track.filePath || track.path) : track;
      if (trackPath) {
        const absolutePath = path.win32.normalize(trackPath);
        m3uContent += `#EXTINF:-1,${path.basename(absolutePath)}\n${absolutePath}\n`;
      }
    });

    fs.writeFileSync(filePathM3U8, '\ufeff' + m3uContent, 'utf8');
    res.json({ success: true, count: tracks.length, file: path.basename(filePathM3U8) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/playlists', (req, res) => {
  try {
    if (fs.existsSync(TARGET_PLAYLISTS_DIR)) {
      const files = fs.readdirSync(TARGET_PLAYLISTS_DIR).filter(f => f.toLowerCase().endsWith('.m3u8'));
      const result = files.map(f => {
        const fullPath = path.join(TARGET_PLAYLISTS_DIR, f);
        // Quitar BOM de UTF-8 al leer el archivo
        const content = fs.readFileSync(fullPath, 'utf-8').replace(/^\uFEFF/, '');
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        return { filename: f, name: f.replace(/\.m3u8$/i, ''), trackCount: lines.length };
      });
      return res.json(result);
    }
    res.json([]);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/playlists/details', (req, res) => {
  try {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: 'Filename requerido' });

    const filePath = resolvePlaylistPath(filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Playlist no encontrada' });
    }

    // Quitar Byte Order Mark (BOM) para evitar caracteres invisibles al inicio
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/);
    
    const collection = getInternalCollection();
    const tracks = [];

    lines.forEach(line => {
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith('#')) return;

      const normalizedLine = path.win32.normalize(cleanLine);
      
      // Buscar coincidencia en el catálogo
      const matched = collection.find(t => {
        const p = typeof t === 'object' ? (t.path || t.filePath) : t;
        return p && path.win32.normalize(p).toLowerCase() === normalizedLine.toLowerCase();
      });

      if (matched) {
        tracks.push(matched);
      } else {
        tracks.push({
          path: cleanLine,
          filePath: cleanLine,
          title: path.basename(cleanLine),
          name: path.basename(cleanLine),
          missing: true
        });
      }
    });

    return res.json({
      filename: path.basename(filePath),
      name: path.basename(filePath).replace(/\.m3u8$/i, ''),
      tracks: tracks
    });
  } catch (err) {
    console.error('Error al obtener detalles de la playlist:', err);
    res.status(500).json({ error: 'Error al procesar el archivo M3U8' });
  }
});

// Manejador flexible de actualización de playlists compatible con POST y PUT
const handleUpdatePlaylist = (req, res) => {
  try {
    const { filename, tracks } = req.body;
    if (!filename || !Array.isArray(tracks)) {
      return res.status(400).json({ error: 'Datos de playlist inválidos.' });
    }

    const filePathM3U8 = resolvePlaylistPath(filename);

    let m3uContent = '#EXTM3U\n';
    tracks.forEach(track => {
      let trackPath = typeof track === 'object' ? (track.filePath || track.path) : track;
      if (trackPath) {
        const absolutePath = path.win32.normalize(trackPath);
        m3uContent += `#EXTINF:-1,${path.basename(absolutePath)}\n${absolutePath}\n`;
      }
    });

    fs.writeFileSync(filePathM3U8, '\ufeff' + m3uContent, 'utf8');

    // Emitir eventos para actualización en vivo vía WebSockets
    const stats = getCurrentStats();
    io.emit('catalog-updated', { time: Date.now(), stats });
    io.emit('stats-updated', stats);

    res.json({ success: true, count: tracks.length, filename: path.basename(filePathM3U8) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/playlists/update', handleUpdatePlaylist);
app.put('/api/playlists/update', handleUpdatePlaylist);

// Manejador flexible de renombrado compatible con cualquier payload del frontend
const handleRenamePlaylist = (req, res) => {
  try {
    const oldFilename = req.body.oldFilename || req.body.filename || req.body.oldName || req.body.playlist;
    const newName = req.body.newName || req.body.name || req.body.newFilename;

    console.log(`[RENAME LOG] Solicitud recibida (${req.method}): oldFilename="${oldFilename}", newName="${newName}"`);

    if (!oldFilename || !newName) {
      return res.status(400).json({ error: 'Nombre antiguo y nuevo requeridos.' });
    }

    const oldPath = resolvePlaylistPath(oldFilename);
    const sanitizedNewName = newName.replace(/[^a-zA-Z0-9_\-\s\.]/g, '').trim();

    if (!sanitizedNewName) {
      return res.status(400).json({ error: 'El nuevo nombre contiene caracteres no válidos.' });
    }

    const newPath = resolvePlaylistPath(sanitizedNewName);

    console.log(`[RENAME LOG] Ruta origen: ${oldPath}`);
    console.log(`[RENAME LOG] Ruta destino: ${newPath}`);

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'La playlist original no fue encontrada en disco.' });
    }

    // Manejo especial para Windows si el cambio es solo en mayúsculas/minúsculas
    if (oldPath.toLowerCase() === newPath.toLowerCase() && oldPath !== newPath) {
      const tempPath = oldPath + '.tmp_' + Date.now();
      fs.renameSync(oldPath, tempPath);
      fs.renameSync(tempPath, newPath);
    } else if (oldPath !== newPath) {
      if (fs.existsSync(newPath)) {
        return res.status(400).json({ error: 'Ya existe una playlist con ese mismo nombre.' });
      }

      try {
        fs.renameSync(oldPath, newPath);
      } catch (renameErr) {
        console.warn(`[RENAME WARN] fs.renameSync falló (${renameErr.message}). Intentando copia manual...`);
        fs.copyFileSync(oldPath, newPath);
        fs.unlinkSync(oldPath);
      }
    }

    const finalNewName = path.basename(newPath).replace(/\.m3u8$/i, '');
    console.log(`[RENAME SUCCESS] Playlist renombrada con éxito a "${finalNewName}"`);

    // Notificar cambios a la interfaz vía WebSockets
    const stats = getCurrentStats();
    io.emit('catalog-updated', { time: Date.now(), stats });
    io.emit('stats-updated', stats);

    res.json({ 
      success: true, 
      oldFilename: path.basename(oldPath), 
      newFilename: path.basename(newPath),
      newName: finalNewName,
      name: finalNewName
    });
  } catch (err) {
    console.error('[RENAME ERROR] Error al renombrar playlist:', err);
    res.status(500).json({ error: `No se pudo renombrar el archivo en el disco: ${err.message}` });
  }
};

// Rutas habilitadas tanto para POST como para PUT para compatibilidad con el cliente
app.post('/api/playlists/rename', handleRenamePlaylist);
app.put('/api/playlists/rename', handleRenamePlaylist);

app.delete('/api/playlists/:filename', (req, res) => {
  try {
    const filePath = resolvePlaylistPath(req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// WEBSOCKETS & SCRIPT EXECUTION
// ==========================================
io.on('connection', (socket) => {
  socket.emit('log', { type: 'info', text: '[SYSTEM] Conexión establecida con consola en vivo.' });

  socket.on('run-script', ({ script }) => {
    let scriptPath = path.resolve(__dirname, '../scripts', script);
    if (!fs.existsSync(scriptPath)) {
      scriptPath = path.resolve(__dirname, 'scripts', script);
    }
    
    if (!fs.existsSync(scriptPath)) {
      socket.emit('log', { type: 'error', text: `[ERROR] No se encontró el script "${script}" en el servidor.` });
      return;
    }

    socket.emit('log', { type: 'warning', text: `[EXEC] Ejecutando ${script}...` });

    const ps = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]);

    ps.stdout.on('data', (data) => {
      socket.emit('log', { type: 'info', text: data.toString().trim() });
    });

    ps.stderr.on('data', (data) => {
      socket.emit('log', { type: 'error', text: data.toString().trim() });
    });

    ps.on('close', async (code) => {
      if (code === 0) {
        socket.emit('log', { type: 'success', text: `[ÉXITO] ${script} finalizado correctamente.` });
        
        if (typeof dataManager.loadCollection === 'function') await dataManager.loadCollection();
        const stats = getCurrentStats();
        io.emit('catalog-updated', { time: Date.now(), stats: stats });
      } else {
        socket.emit('log', { type: 'error', text: `[ERROR] ${script} terminó con código de salida ${code}.` });
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});