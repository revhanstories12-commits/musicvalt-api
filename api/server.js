function renderAudioPage(videoId) {
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "");

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audio Player - ${safeId}</title>
  <style>
    body {
      margin: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      background-color: #121212;
      color: #ffffff;
      font-family: sans-serif;
    }
    audio {
      width: 90%;
      max-width: 400px;
    }
    #status {
      margin-top: 12px;
      font-size: 13px;
      color: #aaaaaa;
    }
  </style>
</head>
<body>
  <audio id="player" controls autoplay></audio>
  <div id="status">Memuat audio...</div>

  <script>
    const videoId = "${safeId}";
    const player = document.getElementById("player");
    const statusText = document.getElementById("status");

    // Daftar server proxy audio publik (Invidious / Piped)
    const proxyList = [
      \`https://inv.nadeko.net/latest_version?id=\${videoId}&itag=140\`,
      \`https://invidious.nerdvpn.de/latest_version?id=\${videoId}&itag=140\`,
      \`https://iv.ggtyler.dev/latest_version?id=\${videoId}&itag=140\`
    ];

    let currentIndex = 0;

    function tryNextSource() {
      if (currentIndex >= proxyList.length) {
        statusText.textContent = "Semua server proxy audio sedang sibuk.";
        return;
      }

      statusText.textContent = \`Menghubungkan ke server audio (\${currentIndex + 1}/\${proxyList.length})...\`;
      player.src = proxyList[currentIndex];
      player.load();
      player.play().catch(() => {
        // Browser menahan autoplay sebelum diklik, biarkan user klik play manual
      });
    }

    // Jika server pertama gagal/lambat, otomatis pindah ke server cadangan berikutnya
    player.addEventListener("error", () => {
      currentIndex++;
      tryNextSource();
    });

    player.addEventListener("loadedmetadata", () => {
      statusText.textContent = "Siap diputar";
    });

    tryNextSource();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...CORS
    }
  });
}
