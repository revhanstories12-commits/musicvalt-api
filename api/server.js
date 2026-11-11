addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const CORS = { 'Access-Control-Allow-Origin': '*' }
const RELEASE_TYPES = ['Song', 'Single', 'EP', 'Album']

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
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Origin": "https://music.youtube.com",
        "Referer": "https://music.youtube.com/"
      },
      body: JSON.stringify({
        context: {
          client: { clientName: "WEB_REMIX", clientVersion: "1.20231214.00.00", hl: "id", gl: "ID" }
        },
        query: query,
        params: "EgWKAQIIAWoKEAkQBRAKEAMQBA==" // filter resmi "Songs"
      })
    })

    if (!ytResponse.ok) throw new Error("Gagal terhubung ke YouTube Music API")

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

        // Subtitle kolom kedua memuat tipe rilis, misalnya "Song • Artis • 3:45"
        const flex2Runs = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
        const subtitleText = flex2Runs.map(r => r.text).join('')
        const isRelease = RELEASE_TYPES.some(t => subtitleText.includes(t))

        // Artis resmi wajib punya link channel UC...
        const hasArtistChannel = flex2Runs.some(r =>
          r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')
        )

        if (id && isRelease && hasArtistChannel && !formattedResults.some(r => r.id === id)) {
          const judul = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown Title"
          const artis = flex2Runs.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))?.text || "Unknown Artist"

          let album = judul
          const albumRun = flex2Runs.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('MPRE'))
          if (albumRun) album = albumRun.text

          const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
          let coverArt = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : ""
          if (coverArt.includes("googleusercontent.com")) {
            coverArt = `${coverArt.split("=")[0]}=w544-h544-l90-rj-l90-rj`
          }

          formattedResults.push({ id, judul, artis, album, coverArt })
        }
      }

      for (const key of Object.keys(obj)) searchItems(obj[key])
    }

    searchItems(data)

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
