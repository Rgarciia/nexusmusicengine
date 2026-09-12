# 🎵 Nexus Music Engine (`nexusmusicengine`)

**Nexus Music Engine** es un centro de mando local y motor de inteligencia musical diseñado para automatizar la ingesta, organización, análisis armónico y gestión de archivos de audio para DJs y productores. 

Combina la potencia de automatización de scripts en **PowerShell** con una interfaz web moderna inspirada en la estética *Dark/Minimal* de **Armada Music**, permitiendo monitorear procesamientos en tiempo real, generar playlists `.m3u8` y mantener sincronizado un histórico XML unificado para **Rekordbox** y **Engine DJ**.

---

### ✨ Características Principales

* ⚡ **Ingesta y Procesamiento Automatizado:** Ejecución y monitoreo en tiempo real de scripts de PowerShell (`Import.ps1`, `Tagging.ps1`, `Audio.ps1`).
* 📊 **Terminal Web en Tiempo Real:** Transmisión vía WebSockets (`Socket.io`) de los logs de consola, advertencias y alertas de análisis.
* 🧠 **Aprendizaje Continuo de Metadata:** Lectura dinámica de formatos (AIFF, FLAC, MP3), bitrates, fechas de ingesta, rangos de BPM y compatibilidad armónica Camelot.
* 🎛️ **Compatibilidad DJ Multi-Plataforma:**
  * Carpeta `/playlists` dedicada para exportación automática de archivos `.m3u8`.
  * Carpeta `/collection` para la gestión acumulativa de la colección en `master_collection.xml`.
* 💻 **Acceso Híbrido:** Disponible como aplicación ejecutable de escritorio (`.exe`) y accesible vía navegador local (`http://nexusmusicengine.local`).
