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

// Ensure physical existence of target playlists directory in D:\Music Library
if (!fs.existsSync(TARGET_PLAYLISTS_DIR)) {
  fs.mkdirSync(TARGET_PLAYLISTS_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
// API: Secure Audio Streaming (AIFF / WAV / MP3)
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

    // ON-THE-FLY TRANSCODING FOR AIFF / AIF FILES
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

    // DIRECT NATIVE STREAMING (MP3, WAV, ETC.)
    res.setHeader('Accept-Ranges', 'bytes');
    if (ext === '.wav') {
      res.setHeader('Content-Type', 'audio/wav');
    } else if (ext === '.mp3') {
      res.setHeader('Content-Type', 'audio/mpeg');
    }

    res.sendFile(fullFilePath, (err) => {
      if (err) {
        if (err.code !== 'ECONNABORTED' && !res.headersSent) {
          console.error(`[AUDIO STREAM ERROR] Failed to send audio file (${fullFilePath}):`, err);
          res.status(500).send('Error streaming audio file.');
        }
      }
    });

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