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
    const ytResponse = await fetch("https://music.youtube.com/youtubei/v1/search?alt=json", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: "1.20231214.00.00",
            hl: "id",
            gl: "ID"
          }
        },
        query: query,
        params: "egWKAQwIARABGAEgACgAMABqC1RvcGljIFRyYWNr"
      })
    })

    if (!ytResponse.ok) {
      throw new Error("Gagal terhubung ke YouTube Music")
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

        if (id && musicVideoType !== "MUSIC_VIDEO_TYPE_OMV") {
          const judul = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown Title"
          
          const flex2Runs = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
          const artis = flex2Runs.length > 0 ? flex2Runs[0].text : "Unknown Artist"
          
          let album = judul
          if (flex2Runs.length >= 3) {
            album = flex2Runs[flex2Runs.length - 1].text || judul
          }

          // 1. Ambil URL Thumbnail
          const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
          let rawCover = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : ""

          // 2. Format URL Cover Art agar berukuran 544x544 resolusi tinggi
          let coverArt = rawCover
          if (rawCover.includes("googleusercontent.com")) {
            // Ubah / potong parameter ukuran lama dan ganti dengan w544-h544-l90-rj-l90-rj
            const baseUrl = rawCover.split("=")[0]
            coverArt = `${baseUrl}=w544-h544-l90-rj-l90-rj`
          } else if (rawCover.includes("ytimg.com")) {
            // Jika thumbnail bawaan dari i.ytimg.com, ubah ke versi hqdefault / maxresdefault
            coverArt = rawCover.replace(/hqdefault|mqdefault|default/, "maxresdefault")
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
