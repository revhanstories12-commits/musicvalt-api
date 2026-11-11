addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const CORS = { 'Access-Control-Allow-Origin': '*' }
const CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20231214.00.00", hl: "id", gl: "ID" }
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": UA,
  "Origin": "https://music.youtube.com",
  "Referer": "https://music.youtube.com/"
}

async function handleRequest(request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')

  if (!query) {
    return new Response(JSON.stringify({ error: "Parameter 'q' wajib diisi!" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS }
    })
  }

  try {
    const ytResponse = await fetch("https://music.youtube.com/youtubei/v1/search?alt=json", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        context: { client: CLIENT },
        query: query,
        params: "EgWKAQIIAWoKEAkQBRAKEAMQBA==" // filter resmi "Songs"
      })
    })

    if (!ytResponse.ok) throw new Error("Gagal terhubung ke YouTube Music API")

    const data = await ytResponse.json()
    const candidates = []

    function searchItems(obj) {
      if (!obj || typeof obj !== 'object') return

      if (obj.musicResponsiveListItemRenderer) {
        const item = obj.musicResponsiveListItemRenderer
        const endpoint = item.playlistItemData ||
                         item.doubleTapCommand?.watchEndpoint ||
                         item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint
        const id = endpoint?.videoId

        const runs2 = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
        const artistRun = runs2.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
        const albumRun = runs2.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'))
        const artis = artistRun?.text || runs2[0]?.text || "Unknown Artist"
        const album = albumRun?.text || ""

        if (id && !candidates.some(c => c.id === id)) {
          const judul = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown Title"
          const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
          let coverArt = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : ""
          if (coverArt.includes("googleusercontent.com")) {
            coverArt = `${coverArt.split("=")[0]}=w544-h544-l90-rj-l90-rj`
          }
          candidates.push({ id, judul, artis, album: album || artis, coverArt })
        }
      }

      for (const key of Object.keys(obj)) searchItems(obj[key])
    }

    searchItems(data)

    // Buang hanya jika channel jelas bukan "... - Topic". Jika gagal dicek, hasil tetap dipertahankan.
    const verdicts = await Promise.all(candidates.map(c => checkTopic(c.id)))
    const formattedResults = candidates.filter((_, i) => verdicts[i] !== false)

    return new Response(JSON.stringify(formattedResults, null, 2), {
      headers: { 'Content-Type': 'application/json', ...CORS }
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: "Gagal mengambil data dari YouTube Music.", detail: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS }
    })
  }
}

// Mengembalikan true (Topic), false (bukan Topic), atau null (tidak bisa dicek)
async function checkTopic(videoId) {
  try {
    const res = await fetch("https://music.youtube.com/youtubei/v1/player?alt=json", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ context: { client: CLIENT }, videoId })
    })
    if (!res.ok) return null
    const data = await res.json()
    const author = data?.videoDetails?.author
    if (!author) return null
    return author.endsWith(" - Topic")
  } catch {
    return null
  }
}
