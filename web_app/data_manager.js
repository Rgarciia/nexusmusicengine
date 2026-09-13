const fs = require('fs');
const path = require('path');

const MUSIC_ROOT = 'D:\\Music Library';

const ALLOWED_FOLDERS = [
    '2008-2017',
    '2020',
    '2022',
    '2024',
    '2025',
    '2026',
    '2026_IA_Music'
];

const EXTENSIONS = ['.mp3', '.wav', '.aiff', '.flac', '.m4a'];

function getAudioFilesRecursively(dir, folderFilter = null, currentCategory = '') {
    let results = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
            if (folderFilter) {
                if (folderFilter.includes(file)) {
                    results = results.concat(getAudioFilesRecursively(filePath, null, file));
                }
            } else {
                results = results.concat(getAudioFilesRecursively(filePath, null, currentCategory));
            }
        } else {
            const ext = path.extname(file).toLowerCase();
            if (EXTENSIONS.includes(ext)) {
                const relativePath = path.relative(MUSIC_ROOT, filePath).replace(/\\/g, '/');
                
                const nameWithoutExt = path.basename(file, ext);
                const parts = nameWithoutExt.split(' - ');
                const artist = parts.length > 1 ? parts[0].trim() : 'Desconocido';
                const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : nameWithoutExt;

                results.push({
                    filename: file,
                    title: title,
                    artist: artist,
                    folder: currentCategory || 'Raíz',
                    filePath: relativePath,
                    fullPath: filePath,
                    extension: ext,
                    size: (stat.size / (1024 * 1024)).toFixed(2) + ' MB'
                });
            }
        }
    });

    return results;
}

module.exports = {
    getCollection: () => {
        return getAudioFilesRecursively(MUSIC_ROOT, ALLOWED_FOLDERS);
    },
    getStats: () => {
        const collection = getAudioFilesRecursively(MUSIC_ROOT, ALLOWED_FOLDERS);
        const playlistsDir = path.join(__dirname, '../playlists');
        let playlistCount = 0;

        if (fs.existsSync(playlistsDir)) {
            playlistCount = fs.readdirSync(playlistsDir).filter(f => f.endsWith('.m3u8')).length;
        }

        return {
            totalTracks: collection.length,
            totalPlaylists: playlistCount
        };
    },
    getPlaylists: () => {
        const playlistsDir = path.join(__dirname, '../playlists');
        if (!fs.existsSync(playlistsDir)) return [];
        return fs.readdirSync(playlistsDir).filter(f => f.endsWith('.m3u8'));
    }
};