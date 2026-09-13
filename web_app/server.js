const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const dataManager = require('./data_manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Ruta principal de tu biblioteca musical en disco
const MUSIC_ROOT_DIRECTORY = 'D:\\Music Library';

// Ruta centralizada para guardar playlists de respaldo y lectura directa en Rekordbox
const TARGET_PLAYLISTS_DIR = path.join(MUSIC_ROOT_DIRECTORY, 'playlistnexusmusic');

// Asegurar existencia del directorio físico de Playlists en D:\Music Library
if (!fs.existsSync(TARGET_PLAYLISTS_DIR)) {
  fs.mkdirSync(TARGET_PLAYLISTS_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// API: Estadísticas principales
// ==========================================
app.get('/api/stats', (req, res) => {
  try {
    let stats = {};
    if (typeof dataManager.getStats === 'function') {
      stats = dataManager.getStats();
    }
    res.json(stats || { totalTracks: 0, totalPlaylists: 0 });
  } catch (err) {
    console.error('Error al obtener estadísticas:', err);
    res.json({ totalTracks: 0, totalPlaylists: 0 });
  }
});

// ==========================================
// API: Colección completa (Carga mediante dataManager)
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
    console.log(`[DEBUG] /api/collection llamado. Canciones cargadas: ${count}`);

    if (Array.isArray(collection)) {
      res.json(collection);
    } else {
      console.warn('[WARN] La función de dataManager no devolvió un Array válido.');
      res.json([]);
    }
  } catch (err) {
    console.error('[ERROR EN GETCOLLECTIONDATA]:', err);
    res.json([]);
  }
});

// ==========================================
// API: Streaming de audio seguro (AIFF / WAV / MP3)
// ==========================================
app.get('/audio-stream', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) {
      return res.status(400).send('Ruta de archivo no proporcionada.');
    }

    let cleanPath = decodeURIComponent(rawPath).trim();
    let fullFilePath = path.normalize(cleanPath);

    // Si la ruta es relativa, construir con la raíz D:\Music Library
    if (!fs.existsSync(fullFilePath)) {
      fullFilePath = path.join(MUSIC_ROOT_DIRECTORY, cleanPath);
    }

    if (!fs.existsSync(fullFilePath)) {
      console.error(`[AUDIO STREAM 404] Archivo no encontrado en disco: ${fullFilePath}`);
      return res.status(404).send('El archivo de audio no existe en el disco.');
    }

    const ext = path.extname(fullFilePath).toLowerCase();
    
    // Configurar cabeceras de transmisión para HTML5 y soporte AIFF
    res.setHeader('Accept-Ranges', 'bytes');
    if (ext === '.aiff' || ext === '.aif') {
      res.setHeader('Content-Type', 'audio/x-aiff');
    } else if (ext === '.wav') {
      res.setHeader('Content-Type', 'audio/wav');
    } else if (ext === '.mp3') {
      res.setHeader('Content-Type', 'audio/mpeg');
    }

    res.sendFile(fullFilePath, (err) => {
      if (err) {
        if (err.code !== 'ECONNABORTED' && !res.headersSent) {
          console.error(`[AUDIO STREAM ERROR] Error al enviar archivo (${fullFilePath}):`, err);
          res.status(500).send('Error al transmitir el audio.');
        }
      }
    });
  } catch (error) {
    console.error('Error interno al servir streaming de audio:', error);
    if (!res.headersSent) {
      res.status(500).send('Error interno en el servidor de streaming.');
    }
  }
});

// ==========================================
// API: Crear y guardar Playlist en D:\Music Library\playlistnexusmusic (.m3u8)
// ==========================================
app.post('/api/playlists/create', (req, res) => {
  try {
    const { name, tracks } = req.body;
    const playlistName = name || req.body.playlistName;
    const selectedTracks = tracks || req.body.selectedTracks;

    if (!playlistName || !selectedTracks || !Array.isArray(selectedTracks) || selectedTracks.length === 0) {
      return res.status(400).json({ error: 'Nombre de playlist o canciones seleccionadas no válidas.' });
    }

    // Procesar a través de dataManager si aplica
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
        // Convertir rutas relativas a absolutas basadas en D:\Music Library
        if (!path.isAbsolute(trackPath)) {
          trackPath = path.join(MUSIC_ROOT_DIRECTORY, trackPath);
        }

        // Formatear separadores exactos de Windows (D:\Music Library\...)
        const absolutePath = path.win32.normalize(trackPath);
        const fileNameWithoutExt = path.basename(absolutePath, path.extname(absolutePath));

        // Cabecera extendida para reconocimiento automático en Rekordbox
        m3uContent += `#EXTINF:-1,${fileNameWithoutExt}\n`;
        m3uContent += `${absolutePath}\n`;
      }
    });

    // Guardar exclusivamente .m3u8 con BOM UTF-8
    fs.writeFileSync(filePathM3U8, '\ufeff' + m3uContent, 'utf8');

    console.log(`[PLAYLIST CREADA] "${safeFileName}.m3u8" (${selectedTracks.length} tracks) guardada en ${TARGET_PLAYLISTS_DIR}`);

    res.json({ 
      success: true, 
      count: selectedTracks.length,
      message: `Playlist "${safeFileName}" creada con ${selectedTracks.length} canciones en D:\\Music Library\\playlistnexusmusic`,
      folder: TARGET_PLAYLISTS_DIR,
      playlist: dataManagerResult,
      file: `${safeFileName}.m3u8`
    });
  } catch (err) {
    console.error('Error al crear playlist:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// API: Listar Playlists creadas (.m3u8)
// ==========================================
app.get('/api/playlists', (req, res) => {
  try {
    if (fs.existsSync(TARGET_PLAYLISTS_DIR)) {
      const files = fs.readdirSync(TARGET_PLAYLISTS_DIR).filter(f => f.endsWith('.m3u8'));
      return res.json(files.map(f => ({ name: f.replace(/\.m3u8$/, ''), file: f })));
    }
    res.json([]);
  } catch (err) {
    console.error('Error al leer las playlists:', err);
    res.json([]);
  }
});

// ==========================================
// WebSockets: Ejecución de scripts de PowerShell
// ==========================================
io.on('connection', (socket) => {
  socket.emit('log', { type: 'info', text: '[SYSTEM] Conexión establecida con la consola en vivo.' });

  socket.on('run-script', ({ script }) => {
    const scriptPath = path.resolve(__dirname, '../scripts', script);
    
    if (!fs.existsSync(scriptPath)) {
      socket.emit('log', { type: 'error', text: `[ERROR] El script ${script} no fue encontrado en /scripts.` });
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

    ps.on('close', (code) => {
      if (code === 0) {
        socket.emit('log', { type: 'success', text: `[SUCCESS] ${script} finalizó correctamente.` });
      } else {
        socket.emit('log', { type: 'error', text: `[ERROR] ${script} terminó con código de salida ${code}.` });
      }
    });
  });
});

// Ruta de fallback universal (Middleware 404/SPA compatible con Node.js v24)
app.use((req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Servidor activo. Revisa que la carpeta public/ contenga index.html');
  }
});

// Iniciar servidor HTTP con Socket.IO
server.listen(PORT, () => {
  console.log(`Server corriendo en http://localhost:${PORT}`);
  console.log(`Ruta raíz de música configurada en: ${MUSIC_ROOT_DIRECTORY}`);
  console.log(`Carpeta de playlists configurada en: ${TARGET_PLAYLISTS_DIR}`);
});