import { CDMetadata, TrackInfo } from '../src/types/cd.js';

/**
 * Search VGMdb API (vgmdb.info) for soundtracks, anime, game, and vocal CDs
 */
export async function searchVGMdb(query: {
  catno?: string;
  title?: string;
  artist?: string;
  trackTitle?: string;
  barcode?: string;
  freeText?: string;
}): Promise<CDMetadata[]> {
  try {
    const qParts: string[] = [];
    if (query.catno) qParts.push(query.catno.trim());
    if (query.title) qParts.push(query.title.trim());
    if (query.artist) qParts.push(query.artist.trim());
    if (query.trackTitle) qParts.push(query.trackTitle.trim());
    if (query.barcode) qParts.push(query.barcode.trim());
    if (query.freeText) qParts.push(query.freeText.trim());

    const searchQuery = qParts.join(' ');
    if (!searchQuery) return [];

    const url = `https://vgmdb.info/search?q=${encodeURIComponent(searchQuery)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'CDMetadataManager/1.0 (Contact: y.yoshiya@gmail.com)',
      },
    }).catch(() => null);

    if (!res || !res.ok) {
      return [];
    }

    const data = await res.json();
    const albums = data.results?.albums || [];

    const results: CDMetadata[] = [];

    // Fetch top 3 album details for complete tracklists
    for (const albumStub of albums.slice(0, 3)) {
      const albumId = albumStub.id;
      if (!albumId) continue;

      try {
        const detailRes = await fetch(`https://vgmdb.info/album/${albumId}`, {
          headers: { 'Accept': 'application/json' },
        }).catch(() => null);
        if (!detailRes || !detailRes.ok) continue;

        const detailData = await detailRes.json();
        const album = detailData;

        const title = album.name || albumStub.title || 'Unknown Album';
        const catalogNumber = album.catalog || query.catno || '';
        const releaseDate = album.release_date || '';
        const coverUrl = album.picture_full || album.picture_small || '';
        const publisher = album.publisher?.name || album.label || '';
        
        let artist = 'Various Artists';
        if (album.artist) artist = album.artist;
        else if (album.composers && album.composers.length > 0) {
          artist = album.composers.map((c: any) => c.name).join(', ');
        }

        const tracks: TrackInfo[] = [];
        if (album.discs && Array.isArray(album.discs)) {
          let globalTrackNum = 1;
          for (const disc of album.discs) {
            if (disc.tracks && Array.isArray(disc.tracks)) {
              for (const tr of disc.tracks) {
                tracks.push({
                  trackNumber: globalTrackNum++,
                  title: tr.name || tr.track || `Track ${globalTrackNum}`,
                  duration: tr.length || '',
                });
              }
            }
          }
        }

        results.push({
          id: `vgmdb-${albumId}`,
          catalogNumber,
          title,
          artist,
          label: publisher,
          releaseDate,
          coverUrl,
          format: 'CD (Soundtrack/Anime)',
          country: 'JP',
          tracks,
          source: 'vgmdb',
          sourceDetails: {
            vgmdbId: String(albumId),
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(`Failed to fetch VGMdb album detail for ID ${albumId}:`, err);
      }
    }

    return results;
  } catch {
    return [];
  }
}
