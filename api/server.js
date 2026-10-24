addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')

  if (!query) {
    return new Response(JSON.stringify({ error: "Parameter 'q' wajib diisi!" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  try {
    // Request KHUSUS ke YouTube Music InnerTube API
    const ytResponse = await fetch("https://music.youtube.com/youtubei/v1/search?alt=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://music.youtube.com",
        "Referer": "https://music.youtube.com/"
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX", // Web App resmi YouTube Music
            clientVersion: "1.20231214.00.00",
            hl: "id",
            gl: "ID"
          }
        },
        query: query,
        // Param ini memfilter hasil pencarian KHUSUS tab "Songs" / Lagu Resmi di YouTube Music
        params: "egWKAQwIARABGAEgACgAMABqC1RvcGljIFRyYWNr"
      })
    })

    if (!ytResponse.ok) {
      throw new Error("Gagal terhubung ke YouTube Music API")
    }

    const data = await ytResponse.json()
    const formattedResults = []

    function searchItems(obj) {
      if (!obj || typeof obj !== 'object') return

      if (obj.musicResponsiveListItemRenderer) {
        const item = obj.musicResponsiveListItemRenderer
        
        const endpoint = item.playlistItemData || 
                         item.doubleTapCommand?.watchEndpoint ||
                         item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint

        const id = endpoint?.videoId
        const musicVideoType = endpoint?.musicVideoType

        // FILTER KETAT: Abaikan video musik biasa (OMV) dan video YouTube standar
        if (id && musicVideoType !== "MUSIC_VIDEO_TYPE_OMV" && musicVideoType !== "MUSIC_VIDEO_TYPE_UGC") {
          // 1. Ambil Judul Lagu
          const judul = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown Title"
          
          // 2. Ambil Nama Artis
          const flex2Runs = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
          const artis = flex2Runs.length > 0 ? flex2Runs[0].text : "Unknown Artist"
          
          // 3. Ambil Nama Album
          let album = judul
          if (flex2Runs.length >= 3) {
            album = flex2Runs[flex2Runs.length - 1].text || judul
          }

          // 4. Ambil dan Format Cover Art khusus YouTube Music (w544-h544)
          const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
          let rawCover = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : ""

          let coverArt = rawCover
          if (rawCover.includes("googleusercontent.com")) {
            // Paksa ukuran menjadi w544-h544-l90-rj-l90-rj
            const baseUrl = rawCover.split("=")[0]
            coverArt = `${baseUrl}=w544-h544-l90-rj-l90-rj`
          }

          if (!formattedResults.some(r => r.id === id)) {
            formattedResults.push({
              id: id,
              judul: judul,
              artis: artis,
              album: album,
              coverArt: coverArt
            })
          }
        }
      }

      for (const key of Object.keys(obj)) {
        searchItems(obj[key])
      }
    }

    searchItems(data)

    return new Response(JSON.stringify(formattedResults, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: "Gagal mengambil data dari YouTube Music.", detail: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }
}
