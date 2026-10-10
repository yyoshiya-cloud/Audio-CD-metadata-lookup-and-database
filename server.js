// server.ts
import express from "express";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// server/ndl.ts
async function searchNDL(query) {
  try {
    const queryParts = [];
    if (query.barcode) {
      const cleanBarcode = query.barcode.replace(/\D/g, "");
      if (cleanBarcode) {
        queryParts.push(`(isbn="${cleanBarcode}" OR any="${cleanBarcode}")`);
      }
    }
    if (query.catno) {
      const cleanCat = query.catno.trim();
      queryParts.push(`(any="${cleanCat}" OR title="${cleanCat}")`);
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) queryParts.push(`title="${query.title.trim()}"`);
      if (query.artist) queryParts.push(`creator="${query.artist.trim()}"`);
      if (query.trackTitle) queryParts.push(`any="${query.trackTitle.trim()}"`);
    } else if (query.freeText) {
      queryParts.push(`any="${query.freeText.trim()}"`);
    }
    if (queryParts.length === 0) return [];
    const sruQuery = queryParts.join(" AND ");
    const url = `https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2&recordSchema=dcndl&maximumRecords=10&query=${encodeURIComponent(sruQuery)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e3);
    let res;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "CDCatalogApp/1.0 (https://github.com/aistudio-applet)"
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`NDL API returned status ${res.status}`);
      return [];
    }
    const xmlText = await res.text();
    return parseNDLXmlResponse(xmlText, query.catno);
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("NDL API fetch timed out (12s limit)");
    } else {
      console.error("Error fetching NDL API:", err?.message || err);
    }
    return [];
  }
}
function parseNDLXmlResponse(xml, targetCatno) {
  const records = [];
  const recordMatches = xml.match(/<recordData>[\s\S]*?<\/recordData>/gi) || [];
  for (const recXml of recordMatches) {
    const extract = (tag) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const match = recXml.match(regex);
      return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim() : "";
    };
    const extractAll = (tag) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
      const matches = Array.from(recXml.matchAll(regex));
      return matches.map((m) => m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim());
    };
    const rawTitle = extract("dc:title") || extract("title") || extract("dcterms:title");
    const rawCreators = extractAll("dc:creator").concat(extractAll("creator"));
    const rawPublisher = extract("dcndl:publicationName") || extract("dc:publisher") || extract("publisher");
    const rawIssued = extract("dcterms:issued") || extract("dc:date") || extract("date");
    const rawIdentifiers = extractAll("dc:identifier").concat(extractAll("identifier")).concat(extractAll("dcndl:materialType"));
    const descriptions = extractAll("dcterms:description").concat(extractAll("dc:description"));
    if (!rawTitle) continue;
    const title = rawTitle.replace(/\s*\/\s*.*$/, "").replace(/<[^>]+>/g, "").trim();
    const artist = rawCreators.length > 0 ? rawCreators.join(", ").replace(/<[^>]+>/g, "").trim() : "Unknown Artist";
    let catalogNumber = targetCatno || "";
    let barcode = "";
    for (const idStr of rawIdentifiers) {
      if (/^\d{12,13}$/.test(idStr.replace(/[- ]/g, ""))) {
        barcode = idStr.replace(/[- ]/g, "");
      } else if (/[A-Z]{2,5}[- ]?\d{2,6}/i.test(idStr)) {
        const catMatch = idStr.match(/[A-Z]{2,5}[- ]?\d{2,6}/i);
        if (catMatch && !catalogNumber) {
          catalogNumber = catMatch[0].toUpperCase();
        }
      }
    }
    const tracks = [];
    descriptions.forEach((desc) => {
      const trackLines = desc.split(/[\n;；,]/);
      trackLines.forEach((line) => {
        const match = line.match(/^(\d{1,2})[\.\s：:]\s*(.+)$/);
        if (match) {
          tracks.push({
            trackNumber: parseInt(match[1], 10),
            title: match[2].trim()
          });
        }
      });
    });
    let releaseDate = rawIssued;
    if (releaseDate) {
      const dateMatch = releaseDate.match(/(\d{4})[-.\/]?(\d{2})?[-.\/]?(\d{2})?/);
      if (dateMatch) {
        releaseDate = [dateMatch[1], dateMatch[2], dateMatch[3]].filter(Boolean).join("-");
      }
    }
    records.push({
      id: `ndl-${records.length}-${Date.now()}`,
      catalogNumber: catalogNumber || targetCatno || "",
      title,
      artist,
      label: rawPublisher || "",
      releaseDate,
      barcode,
      country: "JP",
      format: "CD",
      tracks,
      source: "ndl",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return records;
}

// server/musicbrainz.ts
async function searchMusicBrainz(query) {
  try {
    const luceneParts = [];
    const isTrackOnlyOrArtistTrackSearch = Boolean(
      query.trackTitle && query.trackTitle.trim() && !query.catno && !query.barcode && !query.title
    );
    if (isTrackOnlyOrArtistTrackSearch) {
      const recParts = [`recording:"${query.trackTitle.trim()}"`];
      if (query.artist && query.artist.trim()) {
        recParts.push(`artist:"${query.artist.trim()}"`);
      }
      const recQuery = recParts.join(" AND ");
      const recUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(recQuery)}&fmt=json&limit=10`;
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 1e4);
      let recRes;
      try {
        recRes = await fetch(recUrl, {
          signal: controller2.signal,
          headers: {
            "User-Agent": "CDCatalogApp/1.0.0 (https://github.com/aistudio-applet; contact@example.com)",
            "Accept": "application/json"
          }
        });
      } finally {
        clearTimeout(timeout2);
      }
      if (recRes.ok) {
        const recData = await recRes.json();
        const recordings = recData.recordings || [];
        const seenReleaseIds = /* @__PURE__ */ new Set();
        const results2 = [];
        for (const rec of recordings) {
          const recArtist = rec["artist-credit"] ? rec["artist-credit"].map((ac) => ac.name || ac.artist?.name).filter(Boolean).join(", ") : query.artist || "Unknown Artist";
          const releases2 = rec.releases || [];
          for (const rel of releases2) {
            const mbid = rel.id;
            if (!mbid || seenReleaseIds.has(mbid)) continue;
            seenReleaseIds.add(mbid);
            const title = rel.title || "Unknown Title";
            const artist = rel["artist-credit"] ? rel["artist-credit"].map((ac) => ac.name || ac.artist?.name).filter(Boolean).join(", ") : recArtist;
            let label = "";
            let catalogNumber = "";
            if (rel["label-info"] && rel["label-info"].length > 0) {
              const info = rel["label-info"][0];
              label = info.label?.name || "";
              if (info["catalog-number"]) {
                catalogNumber = info["catalog-number"];
              }
            }
            const releaseDate = rel.date || "";
            const country = rel.country || "JP";
            const coverUrl = `https://coverartarchive.org/release/${mbid}/front-500`;
            let tracks = [];
            if (results2.length < 3) {
              tracks = await fetchMBTracklist(mbid);
            }
            if (tracks.length === 0 && rec.title) {
              const lengthMs = rec.length;
              let duration = "";
              if (lengthMs) {
                const totalSec = Math.floor(lengthMs / 1e3);
                const mins = Math.floor(totalSec / 60);
                const secs = totalSec % 60;
                duration = `${mins}:${secs < 10 ? "0" : ""}${secs}`;
              }
              tracks = [
                {
                  trackNumber: 1,
                  title: rec.title,
                  artist: recArtist,
                  duration
                }
              ];
            }
            results2.push({
              id: `mb-${mbid}`,
              catalogNumber,
              title,
              artist,
              label,
              releaseDate,
              barcode: rel.barcode || "",
              country,
              format: rel.media?.[0]?.format || "CD",
              coverUrl,
              tracks,
              source: "musicbrainz",
              sourceDetails: {
                musicbrainzId: mbid
              },
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
            if (results2.length >= 8) break;
          }
          if (results2.length >= 8) break;
        }
        if (results2.length > 0) {
          return results2;
        }
      }
    }
    if (query.barcode) {
      const cleanBarcode = query.barcode.replace(/\D/g, "");
      if (cleanBarcode) {
        luceneParts.push(`barcode:${cleanBarcode}`);
      }
    } else if (query.catno) {
      const cleanCat = query.catno.trim();
      luceneParts.push(`catno:"${cleanCat}" OR catno:"${cleanCat.replace(/[- ]/g, "")}"`);
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) luceneParts.push(`release:"${query.title.trim()}"`);
      if (query.artist) luceneParts.push(`artist:"${query.artist.trim()}"`);
      if (query.trackTitle && !query.title) luceneParts.push(`"${query.trackTitle.trim()}"`);
    } else if (query.freeText) {
      luceneParts.push(`"${query.freeText.trim()}"`);
    }
    if (luceneParts.length === 0) return [];
    const mbQuery = luceneParts.join(" AND ");
    const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(mbQuery)}&fmt=json&limit=8`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1e4);
    let res;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "CDCatalogApp/1.0.0 (https://github.com/aistudio-applet; contact@example.com)",
          "Accept": "application/json"
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`MusicBrainz API returned status ${res.status}`);
      return [];
    }
    const data = await res.json();
    const releases = data.releases || [];
    const results = [];
    for (const rel of releases) {
      const mbid = rel.id;
      const title = rel.title || "Unknown Title";
      const artist = rel["artist-credit"] ? rel["artist-credit"].map((ac) => ac.name || ac.artist?.name).filter(Boolean).join(", ") : "Unknown Artist";
      let label = "";
      let catalogNumber = query.catno || "";
      if (rel["label-info"] && rel["label-info"].length > 0) {
        const info = rel["label-info"][0];
        label = info.label?.name || "";
        if (info["catalog-number"]) {
          catalogNumber = info["catalog-number"];
        }
      }
      const barcode = rel.barcode || query.barcode || "";
      const releaseDate = rel.date || "";
      const country = rel.country || "JP";
      const coverUrl = `https://coverartarchive.org/release/${mbid}/front-500`;
      let tracks = [];
      if (results.length < 3) {
        tracks = await fetchMBTracklist(mbid);
      }
      results.push({
        id: `mb-${mbid}`,
        catalogNumber: catalogNumber || query.catno || "",
        title,
        artist,
        label,
        releaseDate,
        barcode,
        country,
        format: rel.media?.[0]?.format || "CD",
        coverUrl,
        tracks,
        source: "musicbrainz",
        sourceDetails: {
          musicbrainzId: mbid
        },
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return results;
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("MusicBrainz API fetch timed out (10s limit)");
    } else {
      console.error("Error fetching MusicBrainz API:", err?.message || err);
    }
    return [];
  }
}
async function fetchMBTracklist(mbid) {
  try {
    const url = `https://musicbrainz.org/ws/2/release/${mbid}?inc=recordings+media&fmt=json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "CDCatalogApp/1.0.0 (https://github.com/aistudio-applet; contact@example.com)",
        "Accept": "application/json"
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const mediaList = data.media || [];
    const tracks = [];
    let trackCounter = 1;
    for (const media of mediaList) {
      for (const tr of media.tracks || []) {
        const lengthMs = tr.length || tr.recording?.length;
        let duration = "";
        if (lengthMs) {
          const totalSec = Math.floor(lengthMs / 1e3);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          duration = `${mins}:${secs < 10 ? "0" : ""}${secs}`;
        }
        tracks.push({
          trackNumber: trackCounter++,
          title: tr.title || tr.recording?.title || `Track ${trackCounter}`,
          duration
        });
      }
    }
    return tracks;
  } catch (err) {
    return [];
  }
}

// server/discogs.ts
async function searchDiscogs(query) {
  const catno = query.catno || query.catalogNumber;
  const params = new URLSearchParams({
    type: "release",
    per_page: "8"
  });
  const headers = {
    "User-Agent": "CDMetadataManager/1.0 (+https://cd-metadata-app.local)",
    "Accept": "application/json"
  };
  const rawToken = query.apiKeys?.discogsToken?.trim();
  if (rawToken) {
    if (rawToken.includes(":") && !rawToken.startsWith("http")) {
      const [key, secret] = rawToken.split(":");
      headers["Authorization"] = `Discogs key=${key.trim()}, secret=${secret.trim()}`;
    } else if (rawToken.includes("key=") || rawToken.includes("secret=")) {
      headers["Authorization"] = `Discogs ${rawToken}`;
    } else {
      headers["Authorization"] = `Discogs token=${rawToken}`;
      params.append("token", rawToken);
    }
  }
  const cleanBarcode = query.barcode ? query.barcode.replace(/\D/g, "") : "";
  if (catno) {
    params.append("catno", catno.trim());
  } else if (cleanBarcode) {
    params.append("barcode", cleanBarcode);
  } else if (query.title || query.artist || query.trackTitle) {
    if (query.artist) params.append("artist", query.artist.trim());
    if (query.title) params.append("release_title", query.title.trim());
    if (query.trackTitle) params.append("track", query.trackTitle.trim());
    const q = [query.artist, query.title, query.trackTitle].filter(Boolean).join(" ");
    params.append("q", q);
  } else if (query.freeText) {
    params.append("q", query.freeText.trim());
  }
  const url = `https://api.discogs.com/database/search?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1e4);
  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Discogs API\u3078\u306E\u63A5\u7D9A\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F (10\u79D2)");
    }
    throw new Error(`Discogs API\u63A5\u7D9A\u5931\u6557: ${err.message || err}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    let errorDetail = "";
    try {
      const errJson = await res.json();
      errorDetail = errJson.message || "";
    } catch {
    }
    if (res.status === 401) {
      throw new Error(`Discogs\u8A8D\u8A3C\u30A8\u30E9\u30FC(401): \u30C8\u30FC\u30AF\u30F3\u304C\u7121\u52B9\u3067\u3059\u3002${errorDetail ? ` (${errorDetail})` : ""}`);
    } else if (res.status === 429) {
      throw new Error("Discogs\u30EA\u30AF\u30A8\u30B9\u30C8\u5236\u9650\u30A8\u30E9\u30FC(429): \u30EC\u30FC\u30C8\u30EA\u30DF\u30C3\u30C8\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u3057\u3070\u3089\u304F\u5F85\u3063\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
    throw new Error(`Discogs API\u901A\u4FE1\u30A8\u30E9\u30FC (HTTP ${res.status}${errorDetail ? `: ${errorDetail}` : ""})`);
  }
  const data = await res.json();
  const results = data.results || [];
  const items = [];
  for (const r of results) {
    let artist = "Unknown Artist";
    let title = r.title || "Unknown Title";
    if (r.title && r.title.includes(" - ")) {
      const parts = r.title.split(" - ");
      artist = parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    }
    const catalogNumber = r.catno || catno || "";
    const releaseDate = r.year ? String(r.year) : "";
    const country = r.country || "JP";
    const label = Array.isArray(r.label) ? r.label[0] : r.label || "";
    const coverUrl = r.cover_image || r.thumb || "";
    const format = Array.isArray(r.format) ? r.format.join(", ") : r.format || "CD";
    const barcode = Array.isArray(r.barcode) ? r.barcode[0] : r.barcode || "";
    items.push({
      id: `discogs-${r.id}`,
      catalogNumber: catalogNumber || catno || "",
      title,
      artist,
      label,
      releaseDate,
      barcode,
      country,
      format,
      coverUrl,
      tracks: [],
      source: "discogs",
      sourceDetails: {
        discogsId: String(r.id)
      },
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return items;
}

// server/itunes.ts
async function searchITunes(query) {
  try {
    let term = "";
    if (query.title || query.artist || query.trackTitle) {
      term = [query.artist, query.title, query.trackTitle].filter(Boolean).join(" ");
    } else if (query.catno) {
      term = query.catno.trim();
    } else if (query.freeText) {
      term = query.freeText.trim();
    }
    if (!term) return [];
    const hasTrackQuery = Boolean(query.trackTitle && query.trackTitle.trim());
    const entity = hasTrackQuery && !query.title ? "song" : "album";
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&country=jp&limit=10`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6e3);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`iTunes API returned status ${res.status}`);
      return [];
    }
    const data = await res.json();
    const rawResults = data.results || [];
    const seenCollectionIds = /* @__PURE__ */ new Set();
    const results = [];
    for (const item of rawResults) {
      const cid = item.collectionId;
      if (!cid || seenCollectionIds.has(cid)) continue;
      seenCollectionIds.add(cid);
      results.push(item);
      if (results.length >= 8) break;
    }
    const items = [];
    for (const album of results) {
      const collectionId = album.collectionId;
      const title = album.collectionName || album.collectionCensoredName || album.trackName || "Unknown Title";
      const artist = album.collectionArtistName || album.artistName || "Unknown Artist";
      const releaseDate = album.releaseDate ? album.releaseDate.slice(0, 10) : "";
      const genre = album.primaryGenreName || "";
      let coverUrl = album.artworkUrl100 || "";
      if (coverUrl) {
        coverUrl = coverUrl.replace("100x100bb", "600x600bb").replace("100x100", "600x600");
      }
      let tracks = [];
      if ((items.length < 4 || hasTrackQuery) && collectionId && items.length < 5) {
        tracks = await fetchITunesTracks(collectionId);
      }
      if (tracks.length === 0 && album.wrapperType === "track" && album.trackName) {
        const ms = album.trackTimeMillis;
        let duration = "";
        if (ms) {
          const totalSec = Math.floor(ms / 1e3);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          duration = `${mins}:${secs < 10 ? "0" : ""}${secs}`;
        }
        tracks = [
          {
            trackNumber: album.trackNumber || 1,
            title: album.trackName,
            artist: album.artistName,
            duration,
            previewUrl: album.previewUrl
          }
        ];
      }
      items.push({
        id: `itunes-${collectionId}`,
        catalogNumber: query.catno || "",
        title,
        artist,
        label: album.copyright || "",
        releaseDate,
        genre,
        format: "CD / Digital",
        coverUrl,
        tracks,
        source: "itunes",
        sourceDetails: {
          itunesCollectionId: collectionId
        },
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return items;
  } catch (err) {
    console.error("Error searching iTunes API:", err);
    return [];
  }
}
async function fetchITunesTracks(collectionId) {
  try {
    const url = `https://itunes.apple.com/lookup?id=${collectionId}&entity=song&country=jp`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || [];
    const tracks = [];
    results.forEach((item) => {
      if (item.wrapperType === "track") {
        const ms = item.trackTimeMillis;
        let duration = "";
        if (ms) {
          const totalSec = Math.floor(ms / 1e3);
          const mins = Math.floor(totalSec / 60);
          const secs = totalSec % 60;
          duration = `${mins}:${secs < 10 ? "0" : ""}${secs}`;
        }
        tracks.push({
          trackNumber: item.trackNumber || tracks.length + 1,
          title: item.trackName || `Track ${tracks.length + 1}`,
          artist: item.artistName !== item.collectionArtistName ? item.artistName : void 0,
          duration,
          previewUrl: item.previewUrl
        });
      }
    });
    return tracks;
  } catch (err) {
    return [];
  }
}

// server/spotify.ts
async function getSpotifyAccessToken(customClientId, customClientSecret) {
  const clientId = customClientId || process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = customClientSecret || process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    if (!res.ok) {
      console.warn("Failed to fetch Spotify access token with provided client credentials");
      return null;
    }
    const data = await res.json();
    return data.access_token;
  } catch (err) {
    console.error("Spotify Auth error:", err);
    return null;
  }
}
async function searchSpotify(query) {
  try {
    const token = await getSpotifyAccessToken(
      query.apiKeys?.spotifyClientId,
      query.apiKeys?.spotifyClientSecret
    );
    if (!token) {
      return [];
    }
    let q = "";
    if (query.barcode) {
      q = `upc:${query.barcode.trim()}`;
    } else if (query.title || query.artist || query.trackTitle) {
      const parts = [];
      if (query.title) parts.push(`album:"${query.title.trim()}"`);
      if (query.artist) parts.push(`artist:"${query.artist.trim()}"`);
      if (query.trackTitle) parts.push(`track:"${query.trackTitle.trim()}"`);
      q = parts.join(" ");
    } else if (query.catno) {
      q = query.catno.trim();
    } else if (query.freeText) {
      q = query.freeText.trim();
    }
    if (!q) return [];
    const isTrackSearch = Boolean(query.trackTitle && query.trackTitle.trim() && !query.title && !query.barcode && !query.catno);
    const searchType = isTrackSearch ? "track" : "album";
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=${searchType}&limit=10&market=JP`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6e3);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`Spotify API status: ${res.status}`);
      return [];
    }
    const data = await res.json();
    let albums = [];
    if (isTrackSearch) {
      const trackItems = data.tracks?.items || [];
      const seenAlbumIds = /* @__PURE__ */ new Set();
      for (const tr of trackItems) {
        if (tr.album && tr.album.id && !seenAlbumIds.has(tr.album.id)) {
          seenAlbumIds.add(tr.album.id);
          albums.push(tr.album);
          if (albums.length >= 8) break;
        }
      }
    } else {
      albums = data.albums?.items || [];
    }
    const results = [];
    for (const alb of albums) {
      const spotifyId = alb.id;
      const title = alb.name || "Unknown Title";
      const artist = alb.artists ? alb.artists.map((a) => a.name).join(", ") : "Unknown Artist";
      const releaseDate = alb.release_date || "";
      const coverUrl = alb.images?.[0]?.url || alb.images?.[1]?.url || "";
      let tracks = [];
      if (results.length < 3 && spotifyId) {
        tracks = await fetchSpotifyAlbumTracks(spotifyId, token);
      }
      results.push({
        id: `spotify-${spotifyId}`,
        catalogNumber: query.catno || "",
        title,
        artist,
        releaseDate,
        country: "JP",
        format: "CD / Streaming",
        coverUrl,
        tracks,
        source: "spotify",
        sourceDetails: {
          spotifyId
        },
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return results;
  } catch (err) {
    console.error("Error searching Spotify API:", err);
    return [];
  }
}
async function fetchSpotifyAlbumTracks(albumId, token) {
  try {
    const url = `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=50&market=JP`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items || [];
    return items.map((tr) => {
      const ms = tr.duration_ms;
      let duration = "";
      if (ms) {
        const totalSec = Math.floor(ms / 1e3);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        duration = `${mins}:${secs < 10 ? "0" : ""}${secs}`;
      }
      return {
        trackNumber: tr.track_number,
        title: tr.name,
        artist: tr.artists?.map((a) => a.name).join(", "),
        duration,
        previewUrl: tr.preview_url
      };
    });
  } catch (err) {
    return [];
  }
}

// server/rakuten.ts
var RAKUTEN_APP_ID = process.env.RAKUTEN_APP_ID || "1019385920360682283";
async function searchRakutenBooks(query) {
  try {
    const appId = query.apiKeys?.rakutenAppId || RAKUTEN_APP_ID;
    const params = new URLSearchParams({
      applicationId: appId,
      format: "json",
      hits: "8"
    });
    const cleanBarcode = query.barcode ? query.barcode.replace(/\D/g, "") : "";
    if (cleanBarcode && cleanBarcode.length >= 8) {
      params.append("jan", cleanBarcode);
    } else if (query.catno) {
      params.append("title", query.catno.trim());
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) params.append("title", query.title.trim());
      if (query.artist) params.append("artistName", query.artist.trim());
      if (query.trackTitle && !query.title) params.append("title", query.trackTitle.trim());
    } else if (query.freeText) {
      params.append("title", query.freeText.trim());
    }
    const url = `https://app.rakuten.co.jp/services/api/BooksCD/Search/20170404?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6e3);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`Rakuten Books API status: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const items = data.Items || [];
    const results = [];
    for (const wrap of items) {
      const item = wrap.Item;
      if (!item) continue;
      const title = item.title || "Unknown Title";
      const artist = item.artistName || "Unknown Artist";
      const label = item.label || item.publisherName || "";
      const barcode = item.jan || "";
      let coverUrl = item.largeImageUrl || item.mediumImageUrl || "";
      if (coverUrl) {
        coverUrl = coverUrl.replace("?_ex=200x200", "?_ex=500x500");
      }
      let releaseDate = item.salesDate || "";
      if (releaseDate) {
        const dateMatch = releaseDate.match(/(\d{4})年(\d{2})月(\d{2})日/);
        if (dateMatch) {
          releaseDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        }
      }
      const format = item.limitedFlag === 1 ? "CD (\u521D\u56DE\u9650\u5B9A\u76E4)" : "CD";
      const itemCode = item.itemCode || "";
      results.push({
        id: `rakuten-${itemCode || barcode || results.length}`,
        catalogNumber: query.catno || "",
        title,
        artist,
        label,
        releaseDate,
        barcode,
        country: "JP",
        format,
        coverUrl,
        tracks: [],
        // Track info from Rakuten itemCaption if available
        source: "rakuten",
        sourceDetails: {
          rakutenItemCode: itemCode
        },
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return results;
  } catch (err) {
    console.error("Error searching Rakuten Books API:", err);
    return [];
  }
}

// server/geminiSearchIntegrator.ts
import { GoogleGenAI as GoogleGenAI2 } from "@google/genai";

// server/geminiFallback.ts
import { GoogleGenAI } from "@google/genai";
var GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite"
];
var modelCooldownUntil = /* @__PURE__ */ new Map();
function createGeminiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${ms}ms) calling ${label}`));
    }, ms);
    promise.then((val) => {
      clearTimeout(timer);
      resolve(val);
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
async function generateContentWithFallback(ai, params) {
  const now = Date.now();
  const baseList = params.preferredModel ? [params.preferredModel, ...GEMINI_MODELS.filter((m) => m !== params.preferredModel)] : GEMINI_MODELS;
  const activeModels = baseList.filter((m) => (modelCooldownUntil.get(m) || 0) <= now);
  const cooldownModels = baseList.filter((m) => (modelCooldownUntil.get(m) || 0) > now);
  const modelsToTry = [...activeModels, ...cooldownModels];
  const perModelTimeout = params.timeoutMs || 14e3;
  let lastError = null;
  for (const model of modelsToTry) {
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: params.contents,
          config: params.config
        }),
        perModelTimeout,
        model
      );
      return response;
    } catch (err) {
      lastError = err;
      const errStr = String(err?.message || err).toLowerCase();
      const isRateLimit = errStr.includes("429") || errStr.includes("resource_exhausted") || errStr.includes("rate limit") || errStr.includes("quota") || errStr.includes("overloaded") || errStr.includes("503") || errStr.includes("timeout") || errStr.includes("service unavailable");
      if (isRateLimit) {
        modelCooldownUntil.set(model, Date.now() + 15 * 60 * 1e3);
      }
    }
  }
  throw lastError || new Error("All Gemini model versions failed due to API rate limits or network errors.");
}

// server/geminiSearchIntegrator.ts
async function verifyAndConsolidateWithGemini(candidates, query) {
  if (!candidates || candidates.length === 0) return [];
  if (!process.env.GEMINI_API_KEY) {
    return applyDeterministicVerification(candidates, query);
  }
  try {
    const ai = new GoogleGenAI2();
    const candidatesToVerify = candidates.slice(0, 5);
    const promptData = {
      userQuery: {
        catalogNumber: query.catalogNumber || "",
        title: query.title || "",
        artist: query.artist || "",
        trackTitle: query.trackTitle || "",
        barcode: query.barcode || "",
        freeText: query.freeText || ""
      },
      candidates: candidatesToVerify.map((c, idx) => ({
        index: idx,
        catalogNumber: c.cd.catalogNumber,
        barcode: c.cd.barcode,
        title: c.cd.title,
        artist: c.cd.artist,
        label: c.cd.label,
        releaseDate: c.cd.releaseDate,
        sourcesMatched: c.sourcesMatched,
        rawSources: c.cd.rawSources,
        trackCount: c.cd.tracks.length,
        tracksSample: c.cd.tracks.slice(0, 10).map((t) => `${t.trackNumber}. ${t.title} (${t.duration || ""})`)
      }))
    };
    const systemInstruction = `\u3042\u306A\u305F\u306F\u97F3\u697DCD\u306E\u30E1\u30BF\u30C7\u30FC\u30BF\uFF08\u30BF\u30A4\u30C8\u30EB\u3001\u6B4C\u624B\u3001\u898F\u683C\u54C1\u756A\u3001JAN/EAN\u30D0\u30FC\u30B3\u30FC\u30C9\u3001\u53CE\u9332\u66F2\uFF09\u3092\u7167\u5408\u30FB\u7CBE\u67FB\u3059\u308B\u5C02\u9580\u5BB6\u3067\u3059\u3002
\u8907\u6570\u306EAPI\uFF08\u56FD\u4F1A\u56F3\u66F8\u9928NDL\u3001MusicBrainz\u3001iTunes\u3001\u697D\u5929\u30D6\u30C3\u30AF\u30B9\u3001Spotify\u3001Discogs\uFF09\u304B\u3089\u53D6\u5F97\u3055\u308C\u305FCD\u5019\u88DC\u30C7\u30FC\u30BF\u3092\u7D71\u5408\u30FB\u691C\u8A3C\u3057\u3001\u91CD\u8907\u6392\u9664\u304A\u3088\u3073\u6B63\u898F\u5316\u3092\u884C\u3044\u307E\u3059\u3002

\u3010\u6700\u91CD\u8981\u691C\u8A3C\u30EB\u30FC\u30EB\u3011
1. \u30E6\u30FC\u30B6\u30FC\u306E\u691C\u7D22\u30AF\u30A8\u30EA\uFF08\u578B\u756A\u30FB\u898F\u683C\u54C1\u756A\u3001JAN/EAN\u30B3\u30FC\u30C9\u3001\u30BF\u30A4\u30C8\u30EB\uFF09\u3068\u5019\u88DC\u30C7\u30FC\u30BF\u306E\u300C\u5B8C\u5168\u4E00\u81F4\u300D\u3092\u6700\u512A\u5148\u3067\u5224\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002
   - JAN\u30B3\u30FC\u30C9\u30FB\u30D0\u30FC\u30B3\u30FC\u30C9\uFF08\u6570\u5B5713\u6841\u307E\u305F\u306F8\u6841\uFF09\u304C\u5B8C\u5168\u4E00\u81F4\u3059\u308B\u5834\u5408\u306F isExactMatch: true, exactMatchTypes \u306B "barcode" \u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002
   - \u898F\u683C\u54C1\u756A\u306E\u30CF\u30A4\u30D5\u30F3\u30FB\u7A7A\u767D\u306E\u5DEE\u7570\uFF08\u4F8B: "VICL-60001" \u3068 "VICL 60001" \u3084 "VICL60001"\uFF09\u306F\u5B8C\u5168\u4E00\u81F4\u3068\u307F\u306A\u3057\u307E\u3059\u3002
   - \u30BF\u30A4\u30C8\u30EB\u30FB\u6B4C\u624B\u540D\u306E\u8868\u8A18\u63FA\u308C\uFF08\u5168\u89D2\u534A\u89D2\u3001\u30AB\u30BF\u30AB\u30CA/\u82F1\u5B57\u3001(Remastered)\u306A\u3069\u306E\u4E0D\u8981\u306A\u4ED8\u52A0\u60C5\u5831\uFF09\u3092\u6B63\u898F\u5316\u3057\u3001\u6B63\u5F0F\u306A\u56FD\u5185\u76E4\u30BF\u30A4\u30C8\u30EB\u3068\u3057\u3066\u6574\u7406\u3057\u3066\u304F\u3060\u3055\u3044\u3002
2. \u7570\u306A\u308BAPI\uFF08\u4F8B: NDL/\u697D\u5929\u306EJAN\u30FB\u578B\u756A\u3068iTunes\u306E\u30B8\u30E3\u30B1\u30C3\u30C8\u30FB\u66F2\u60C5\u5831\uFF09\u304C\u540C\u4E00\u306ECD\u30A2\u30EB\u30D0\u30E0\u3092\u6307\u3057\u3066\u3044\u308B\u304B\u3092\u53B3\u5BC6\u306B\u691C\u8A3C\u3057\u3066\u304F\u3060\u3055\u3044\u3002
   - \u540C\u4E00\u30A2\u30EB\u30D0\u30E0\u3067\u3042\u308C\u3070\u3001\u6700\u3082\u516C\u5F0F\u304B\u3064\u6B63\u78BA\u306A\u30BF\u30A4\u30C8\u30EB\u3001\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u3001\u898F\u683C\u54C1\u756A\u3001JAN\u30B3\u30FC\u30C9\u3001\u30EC\u30FC\u30D9\u30EB\u3001\u767A\u58F2\u65E5\u3092\u63A1\u7528\u3057\u3066\u304F\u3060\u3055\u3044\u3002
3. \u30E6\u30FC\u30B6\u30FC\u306E\u5165\u529B\u3057\u305F\u578B\u756A\u30FBJAN\u3068\u7570\u306A\u308B\u7121\u95A2\u4FC2\u306A\u4F5C\u54C1\u306B\u306F isExactMatch: false \u3092\u8A2D\u5B9A\u3057\u3001\u4FE1\u983C\u5EA6(confidenceScore)\u3092\u4E0B\u3052\u3066\u304F\u3060\u3055\u3044\u3002
4. verificationSummary \u306B\u306F\u3001\u3069\u306EAPI\u306E\u60C5\u5831\u3092\u3069\u3046\u7167\u5408\u30FB\u691C\u8A3C\u3057\u305F\u304B\u3092\u65E5\u672C\u8A9E\u3067\u7C21\u6F54\u306B1\u6587\u3067\u8A18\u8F09\u3057\u3066\u304F\u3060\u3055\u3044\u3002
   \uFF08\u4F8B: "\u697D\u5929\u30FBMusicBrainz\u306EJAN\u30B3\u30FC\u30C9(4562109401813)\u3068iTunes\u306E\u9AD8\u753B\u8CEA\u30B8\u30E3\u30B1\u30C3\u30C8\u304A\u3088\u3073\u53CE\u9332\u66F2\u3092\u5B8C\u5168\u7167\u5408\u30FB\u691C\u8A3C\u5B8C\u4E86"\uFF09

\u5FC5\u305AJSON\u5F62\u5F0F\u3067\u4EE5\u4E0B\u306E\u30D7\u30ED\u30D1\u30C6\u30A3\u3092\u542B\u3080\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3092\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044:
{
  "verifiedCandidates": [
    {
      "candidateIndex": number,
      "isExactMatch": boolean,
      "exactMatchTypes": ["catalogNumber" | "title" | "barcode"],
      "verifiedTitle": string,
      "verifiedArtist": string,
      "verifiedCatalogNumber": string,
      "verifiedBarcode": string,
      "verifiedLabel": string,
      "verifiedReleaseDate": string,
      "confidenceScore": number (0-100),
      "verificationSummary": string
    }
  ]
}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7e3);
    const response = await generateContentWithFallback(ai, {
      contents: [
        {
          role: "user",
          parts: [
            { text: `\u6B21\u306ECD\u691C\u7D22\u30AF\u30A8\u30EA\u3068\u5019\u88DC\u30C7\u30FC\u30BF\u3092\u7167\u5408\u30FB\u691C\u8A3C\u3057\u3001\u7D71\u5408\u7D50\u679C\u3092JSON\u3067\u51FA\u529B\u3057\u3066\u304F\u3060\u3055\u3044:

${JSON.stringify(promptData, null, 2)}` }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1
      },
      preferredModel: "gemini-flash-latest"
    });
    clearTimeout(timeout);
    const responseText = response.text;
    if (!responseText) {
      return applyDeterministicVerification(candidates, query);
    }
    const parsed = JSON.parse(responseText);
    const verifiedMap = /* @__PURE__ */ new Map();
    (parsed.verifiedCandidates || []).forEach((vc) => {
      verifiedMap.set(vc.candidateIndex, vc);
    });
    const finalCandidates = candidates.map((cand, idx) => {
      const aiData = verifiedMap.get(idx);
      if (!aiData) {
        return applyDeterministicVerification([cand], query)[0];
      }
      const updatedCD = {
        ...cand.cd,
        title: aiData.verifiedTitle || cand.cd.title,
        artist: aiData.verifiedArtist || cand.cd.artist,
        catalogNumber: aiData.verifiedCatalogNumber || cand.cd.catalogNumber,
        label: aiData.verifiedLabel || cand.cd.label,
        releaseDate: aiData.verifiedReleaseDate || cand.cd.releaseDate,
        confidenceScore: aiData.confidenceScore || cand.matchScore,
        verifiedByAI: true,
        aiVerificationSummary: aiData.verificationSummary,
        isExactMatch: aiData.isExactMatch,
        exactMatchTypes: aiData.exactMatchTypes
      };
      return {
        ...cand,
        cd: updatedCD,
        matchScore: aiData.confidenceScore || cand.matchScore,
        isExactMatch: aiData.isExactMatch,
        exactMatchTypes: aiData.exactMatchTypes,
        verifiedByAI: true,
        aiVerificationSummary: aiData.verificationSummary
      };
    });
    finalCandidates.sort((a, b) => {
      if (a.isExactMatch && !b.isExactMatch) return -1;
      if (!a.isExactMatch && b.isExactMatch) return 1;
      return b.matchScore - a.matchScore;
    });
    return finalCandidates;
  } catch {
    return applyDeterministicVerification(candidates, query);
  }
}
function applyDeterministicVerification(candidates, query) {
  const normQueryCat = normalizeText(query.catalogNumber || query.catno || "");
  const normQueryTitle = normalizeText(query.title || "");
  const normQueryTrack = normalizeText(query.trackTitle || "");
  const normQueryBarcode = query.barcode ? query.barcode.replace(/\D/g, "") : "";
  return candidates.map((cand) => {
    const candCat = normalizeText(cand.cd.catalogNumber || "");
    const candTitle = normalizeText(cand.cd.title || "");
    const candBarcode = cand.cd.barcode ? cand.cd.barcode.replace(/\D/g, "") : "";
    const catMatch = Boolean(normQueryCat && candCat && (candCat === normQueryCat || candCat.includes(normQueryCat) || normQueryCat.includes(candCat)));
    const titleMatch = Boolean(normQueryTitle && candTitle && (candTitle === normQueryTitle || candTitle.includes(normQueryTitle)));
    const matchedTrackObj = normQueryTrack ? (cand.cd.tracks || []).find((tr) => {
      const nt = normalizeText(tr.title || "");
      return nt && (nt === normQueryTrack || nt.includes(normQueryTrack) || normQueryTrack.includes(nt));
    }) : void 0;
    const trackMatch = Boolean(
      normQueryTrack && (matchedTrackObj || candTitle && (candTitle === normQueryTrack || candTitle.includes(normQueryTrack)))
    );
    const barcodeMatch = Boolean(normQueryBarcode && candBarcode && normQueryBarcode === candBarcode);
    const exactMatchTypes = [];
    if (catMatch) exactMatchTypes.push("catalogNumber");
    if (titleMatch || trackMatch) exactMatchTypes.push("title");
    if (barcodeMatch) exactMatchTypes.push("barcode");
    const isExactMatch = exactMatchTypes.length > 0;
    let score = cand.matchScore;
    if (catMatch && titleMatch) score = 100;
    else if (barcodeMatch) score = 100;
    else if (catMatch) score = Math.max(score, 95);
    else if (trackMatch) score = Math.max(score, 92);
    let summary = "";
    if (barcodeMatch && catMatch) {
      summary = `JAN\u30B3\u30FC\u30C9(${cand.cd.barcode})\u304A\u3088\u3073\u578B\u756A(${cand.cd.catalogNumber})\u304C\u5B8C\u5168\u4E00\u81F4`;
    } else if (barcodeMatch) {
      summary = `JAN\u30B3\u30FC\u30C9(${cand.cd.barcode})\u304C\u5B8C\u5168\u4E00\u81F4\uFF08${cand.sourcesMatched.join("\u30FB")}\uFF09`;
    } else if (catMatch && cand.sourcesMatched.length > 1) {
      summary = `\u578B\u756A(${cand.cd.catalogNumber})\u3067${cand.sourcesMatched.join("\u30FB")}\u306E\u30C7\u30FC\u30BF\u3092\u4E00\u81F4\u7167\u5408\u6E08\u307F`;
    } else if (catMatch) {
      summary = `\u898F\u683C\u54C1\u756A(${cand.cd.catalogNumber})\u304C\u5B8C\u5168\u4E00\u81F4`;
    } else if (trackMatch && matchedTrackObj) {
      summary = `\u53CE\u9332\u66F2\u300C${matchedTrackObj.title}\u300D(Tr.${matchedTrackObj.trackNumber}) \u3092\u542B\u3080\u30A2\u30EB\u30D0\u30E0\u3068\u3057\u3066\u4E00\u81F4`;
    } else if (titleMatch) {
      summary = `\u30BF\u30A4\u30C8\u30EB\u300C${cand.cd.title}\u300D\u304C\u691C\u7D22\u30AF\u30A8\u30EA\u3068\u5B8C\u5168\u4E00\u81F4`;
    }
    const updatedCD = {
      ...cand.cd,
      isExactMatch,
      exactMatchTypes,
      confidenceScore: score,
      aiVerificationSummary: summary || cand.cd.aiVerificationSummary
    };
    return {
      ...cand,
      cd: updatedCD,
      matchScore: score,
      isExactMatch,
      exactMatchTypes,
      aiVerificationSummary: summary
    };
  }).sort((a, b) => {
    if (a.isExactMatch && !b.isExactMatch) return -1;
    if (!a.isExactMatch && b.isExactMatch) return 1;
    return b.matchScore - a.matchScore;
  });
}
function normalizeText(str) {
  if (!str) return "";
  return str.toUpperCase().replace(/[‐－―ー\-\s_]/g, "").replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 65248)).trim();
}

// server/search.ts
async function performAggregatedSearch(query) {
  const startTime = Date.now();
  const allowedSources = ["musicbrainz", "discogs", "itunes", "ndl", "spotify", "rakuten"];
  const selectedSources = query.sources && query.sources.length > 0 ? query.sources.filter((s) => allowedSources.includes(s)) : allowedSources;
  const rawCat = query.catalogNumber || query.catno || "";
  const rawBarcode = query.barcode ? query.barcode.replace(/\D/g, "") : "";
  const normalizedQuery = {
    ...query,
    catno: rawCat.trim(),
    barcode: rawBarcode
  };
  const isCodeFirstSearch = Boolean(
    (normalizedQuery.catno || normalizedQuery.barcode) && !normalizedQuery.title && !normalizedQuery.trackTitle
  );
  const sourceResults = {};
  const allItems = [];
  const catalogSources = selectedSources.filter((s) => ["ndl", "musicbrainz", "discogs", "rakuten"].includes(s));
  const primaryPromises = catalogSources.map((source) => {
    let p;
    if (source === "musicbrainz") p = searchMusicBrainz(normalizedQuery);
    else if (source === "ndl") p = searchNDL(normalizedQuery);
    else if (source === "discogs") p = searchDiscogs(normalizedQuery);
    else p = searchRakutenBooks(normalizedQuery);
    return p.then((items) => ({ source, items })).catch((err) => ({ source, items: [], error: err.message }));
  });
  const streamingSources = selectedSources.filter((s) => ["itunes", "spotify"].includes(s));
  if (isCodeFirstSearch) {
    const catalogResults = await Promise.all(primaryPromises);
    for (const cr of catalogResults) {
      sourceResults[cr.source] = { count: cr.items.length, items: cr.items, error: cr.error };
      allItems.push(...cr.items);
    }
    const bestFound = allItems.find((i) => i.title && i.title !== "Unknown Title" && i.artist && i.artist !== "Unknown Artist");
    if (bestFound && streamingSources.length > 0) {
      const enrichedQuery = {
        title: bestFound.title,
        artist: bestFound.artist,
        catno: normalizedQuery.catno,
        barcode: normalizedQuery.barcode
      };
      const streamingPromises = streamingSources.map((source) => {
        const p = source === "itunes" ? searchITunes(enrichedQuery) : searchSpotify(enrichedQuery);
        return p.then((items) => ({ source, items })).catch((err) => ({ source, items: [], error: err.message }));
      });
      const streamingResults = await Promise.all(streamingPromises);
      for (const sr of streamingResults) {
        sourceResults[sr.source] = { count: sr.items.length, items: sr.items, error: sr.error };
        allItems.push(...sr.items);
      }
    } else {
      if (normalizedQuery.artist || normalizedQuery.title || normalizedQuery.freeText) {
        const streamingPromises = streamingSources.map((source) => {
          const p = source === "itunes" ? searchITunes(normalizedQuery) : searchSpotify(normalizedQuery);
          return p.then((items) => ({ source, items })).catch((err) => ({ source, items: [], error: err.message }));
        });
        const streamingResults = await Promise.all(streamingPromises);
        for (const sr of streamingResults) {
          sourceResults[sr.source] = { count: sr.items.length, items: sr.items, error: sr.error };
          allItems.push(...sr.items);
        }
      } else {
        for (const s of streamingSources) {
          sourceResults[s] = { count: 0, items: [], error: void 0 };
        }
      }
    }
  } else {
    const streamingPromises = streamingSources.map((source) => {
      const p = source === "itunes" ? searchITunes(normalizedQuery) : searchSpotify(normalizedQuery);
      return p.then((items) => ({ source, items })).catch((err) => ({ source, items: [], error: err.message }));
    });
    const allResults = await Promise.all([...primaryPromises, ...streamingPromises]);
    for (const r of allResults) {
      sourceResults[r.source] = { count: r.items.length, items: r.items, error: r.error };
      allItems.push(...r.items);
    }
  }
  const rawCandidates = mergeCDCandidates(allItems, query);
  const candidates = await verifyAndConsolidateWithGemini(rawCandidates, query);
  return {
    candidates,
    sourceResults,
    searchedSources: selectedSources,
    searchTimeMs: Date.now() - startTime
  };
}
function mergeCDCandidates(items, query) {
  if (items.length === 0) return [];
  const targetCatNo = normalizeCatNo(query.catalogNumber || query.catno);
  const groups = [];
  for (const item of items) {
    const itemCat = normalizeCatNo(item.catalogNumber);
    const itemCleanTitle = cleanTitleForMatching(item.title);
    const itemCleanArtist = cleanArtistForMatching(item.artist);
    if (targetCatNo && itemCat && itemCat !== targetCatNo && !itemCat.includes(targetCatNo) && !targetCatNo.includes(itemCat)) {
      continue;
    }
    let matchedGroup = groups.find((g) => {
      if (item.barcode && g.items.some((gi) => gi.barcode)) {
        const itemBc = item.barcode.replace(/\D/g, "");
        const groupBc = g.items.find((gi) => gi.barcode)?.barcode?.replace(/\D/g, "");
        if (itemBc && groupBc && itemBc === groupBc) {
          return true;
        }
      }
      if (itemCat && g.catalogNumber && (itemCat === g.catalogNumber || itemCat.replace(/[- ]/g, "") === g.catalogNumber.replace(/[- ]/g, ""))) {
        return true;
      }
      if (itemCleanTitle && g.cleanTitle && itemCleanArtist && g.cleanArtist) {
        const titleMatch = itemCleanTitle === g.cleanTitle || itemCleanTitle.includes(g.cleanTitle) || g.cleanTitle.includes(itemCleanTitle);
        const artistMatch = itemCleanArtist === g.cleanArtist || itemCleanArtist.includes(g.cleanArtist) || g.cleanArtist.includes(itemCleanArtist);
        if (titleMatch && artistMatch) {
          return true;
        }
      }
      return false;
    });
    if (matchedGroup) {
      matchedGroup.items.push(item);
      if (!matchedGroup.catalogNumber && itemCat) {
        matchedGroup.catalogNumber = itemCat;
      }
    } else {
      groups.push({
        key: itemCat ? `cat:${itemCat}` : `ta:${itemCleanArtist}_${itemCleanTitle}`,
        catalogNumber: itemCat,
        cleanTitle: itemCleanTitle,
        cleanArtist: itemCleanArtist,
        items: [item]
      });
    }
  }
  const candidates = [];
  groups.forEach(({ items: groupItems }) => {
    const sourcesMatched = Array.from(new Set(groupItems.map((i) => i.source)));
    const coverUrl = groupItems.find((i) => i.source === "itunes" && i.coverUrl)?.coverUrl || groupItems.find((i) => i.source === "spotify" && i.coverUrl)?.coverUrl || groupItems.find((i) => i.source === "rakuten" && i.coverUrl)?.coverUrl || groupItems.find((i) => i.source === "musicbrainz" && i.coverUrl)?.coverUrl || groupItems.find((i) => i.coverUrl)?.coverUrl || "";
    const rawCat = groupItems.find((i) => i.catalogNumber)?.catalogNumber || query.catalogNumber || "";
    const catalogNumber = rawCat ? String(rawCat).trim().toUpperCase() : "";
    const tracks = groupItems.find((i) => i.tracks && i.tracks.length > 0)?.tracks || [];
    const title = groupItems.find((i) => isJapanese(i.title))?.title || groupItems.find((i) => i.title)?.title || "Unknown Title";
    const artist = groupItems.find((i) => isJapanese(i.artist))?.artist || groupItems.find((i) => i.artist)?.artist || "Unknown Artist";
    const label = groupItems.find((i) => i.label)?.label || "";
    const releaseDate = groupItems.find((i) => i.releaseDate)?.releaseDate || "";
    const barcode = groupItems.find((i) => i.barcode)?.barcode || "";
    const format = groupItems.find((i) => i.format)?.format || "CD";
    const genre = groupItems.find((i) => i.genre)?.genre || "";
    const rawSources = {};
    groupItems.forEach((gi) => {
      rawSources[gi.source] = {
        title: gi.title,
        artist: gi.artist,
        catalogNumber: gi.catalogNumber,
        releaseDate: gi.releaseDate,
        label: gi.label,
        coverUrl: gi.coverUrl,
        trackCount: gi.tracks ? gi.tracks.length : 0
      };
    });
    const targetCat = normalizeCatNo(query.catalogNumber || query.catno);
    const targetTitle = cleanTitleForMatching(query.title);
    const targetTrackTitle = cleanTitleForMatching(query.trackTitle);
    const targetBarcode = query.barcode ? query.barcode.replace(/\D/g, "") : "";
    const candCat = normalizeCatNo(catalogNumber);
    const candTitle = cleanTitleForMatching(title);
    const candBarcode = barcode ? barcode.replace(/\D/g, "") : "";
    const catMatch = Boolean(targetCat && candCat && (candCat === targetCat || candCat.replace(/[- ]/g, "") === targetCat.replace(/[- ]/g, "")));
    const titleMatch = Boolean(targetTitle && candTitle && (candTitle === targetTitle || candTitle.replace(/\s+/g, "") === targetTitle.replace(/\s+/g, "")));
    const trackMatch = Boolean(
      targetTrackTitle && (tracks.some((tr) => {
        const cleanTr = cleanTitleForMatching(tr.title);
        return cleanTr && (cleanTr === targetTrackTitle || cleanTr.includes(targetTrackTitle) || targetTrackTitle.includes(cleanTr));
      }) || candTitle && (candTitle === targetTrackTitle || candTitle.includes(targetTrackTitle)))
    );
    const barcodeMatch = Boolean(targetBarcode && candBarcode && targetBarcode === candBarcode);
    const exactMatchTypes = [];
    if (catMatch) exactMatchTypes.push("catalogNumber");
    if (titleMatch || trackMatch) exactMatchTypes.push("title");
    if (barcodeMatch) exactMatchTypes.push("barcode");
    const isExactMatch = exactMatchTypes.length > 0;
    let matchScore = 50 + sourcesMatched.length * 15;
    if (catMatch && titleMatch) {
      matchScore = 100;
    } else if (barcodeMatch) {
      matchScore = 100;
    } else if (catMatch) {
      matchScore = Math.max(95, matchScore + 25);
    } else if (titleMatch) {
      matchScore = Math.max(90, matchScore + 20);
    } else if (trackMatch) {
      matchScore = Math.max(90, matchScore + 20);
    }
    if (tracks.length > 0) matchScore += 5;
    if (coverUrl) matchScore += 5;
    matchScore = Math.min(100, matchScore);
    const consolidatedCD = {
      id: `cd-${catalogNumber || "unk"}-${Date.now()}-${Math.floor(Math.random() * 1e3)}`,
      catalogNumber,
      title,
      artist,
      label,
      releaseDate,
      barcode,
      coverUrl,
      country: "JP",
      format,
      genre,
      tracks,
      source: groupItems[0].source,
      // Primary source
      rawSources,
      confidenceScore: matchScore,
      isExactMatch,
      exactMatchTypes,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    candidates.push({
      cd: consolidatedCD,
      sourcesMatched,
      matchScore,
      isExactMatch,
      exactMatchTypes
    });
  });
  candidates.sort((a, b) => {
    if (a.isExactMatch && !b.isExactMatch) return -1;
    if (!a.isExactMatch && b.isExactMatch) return 1;
    return b.matchScore - a.matchScore;
  });
  return candidates;
}
function cleanTitleForMatching(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/\(.*?(remaster|edition|version|bonus|deluxe|盤|mix|live).*?\)/gi, "").replace(/\[.*?(remaster|edition|version|bonus|deluxe|盤|mix|live).*?\]/gi, "").replace(/【.*?】/g, "").replace(/[～〜\-_\/\:\;]/g, " ").replace(/\s+/g, "").trim();
}
function cleanArtistForMatching(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/[\s\-_,\.\/]/g, "").trim();
}
function normalizeCatNo(str) {
  if (!str) return "";
  return str.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function isJapanese(str) {
  if (!str) return false;
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
}

// server/ocr.ts
import { GoogleGenAI as GoogleGenAI3 } from "@google/genai";
async function processCDImageOCR(imageBase64, mimeType = "image/jpeg") {
  try {
    const ai = new GoogleGenAI3();
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const prompt = `
You are an expert Japanese CD cataloguer and music metadata classifier.
Analyze this photo of a CD spine, obi strip (\u5E2F), front cover, or back cover.

Extract the following metadata if visible:
1. Catalog Number / \u578B\u756A (e.g. "SRCL-1234", "VICL-60001", "TOCT-24001", "ESCB 2000", "KICS-1000", "TFCC-88077")
2. Album / CD Title (CD\u30BF\u30A4\u30C8\u30EB)
3. Artist / Singer / Band Name (\u6B4C\u624B\u30FB\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D)
4. JAN / Barcode code (\u30D0\u30FC\u30B3\u30FC\u30C9\u756A\u53F7, 12-13 digits starting with 49, 45, etc.)
5. Record Label / Publisher (\u30EC\u30FC\u30D9\u30EB\u30FB\u30EC\u30B3\u30FC\u30C9\u4F1A\u793E\u540D)
6. Release Date (\u767A\u58F2\u65E5, YYYY-MM-DD or YYYY)

Return ONLY a strict valid JSON object in this format with no code markdown backticks:
{
  "catalogNumber": "extracted catalog number or empty string",
  "title": "extracted title or empty string",
  "artist": "extracted artist or empty string",
  "barcode": "extracted barcode or empty string",
  "label": "extracted label or empty string",
  "releaseDate": "extracted release date or empty string"
}
`;
    const response = await generateContentWithFallback(ai, {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: cleanBase64,
                mimeType
              }
            }
          ]
        }
      ],
      preferredModel: "gemini-flash-latest"
    });
    const text = response.text || "";
    const cleanJsonText = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    try {
      const parsed = JSON.parse(cleanJsonText);
      return {
        catalogNumber: parsed.catalogNumber ? String(parsed.catalogNumber).trim().toUpperCase() : void 0,
        title: parsed.title || void 0,
        artist: parsed.artist || void 0,
        barcode: parsed.barcode || void 0,
        label: parsed.label || void 0,
        releaseDate: parsed.releaseDate || void 0,
        rawText: text
      };
    } catch {
      return { rawText: text };
    }
  } catch (err) {
    console.error("Error running Gemini OCR:", err);
    throw new Error(`AI OCR\u89E3\u6790\u30A8\u30E9\u30FC: ${err.message || "\u753B\u50CF\u306E\u89E3\u6790\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002"}`);
  }
}

// src/lib/genreRuleFilter.ts
var CLASSICAL_CATALOG_PREFIX_REGEX = /^(UCCG|UCCP|UCCB|UCCD|POCG|F35G|F00G|F35L|SICC|SRCR|CSCL|32DC|28DC|TOCE|CC33|CC30|WPCS|BVCC|R32C|COCO|COCQ|33C37|35C37|32CO|VICC|VDC|KICC|K33Y)\b/i;
var JAZZ_CATALOG_PREFIX_REGEX = /^(UCCU|UCCJ|UCCV|POCJ|J33J|TOCJ|CJ32|SICJ|VRCL|VICJ|VIJ|KICJ|BVCJ|TBM|THCD|EWCD|MZCB)\b/i;
var ANIME_CATALOG_PREFIX_REGEX = /^(LACA|LACM|LASM|LASA|KICA|KICM|KIDA|KIGS|VTCL|VTZL|SVWC|VVCL|SACX|ZMCZ|ZMCP|PCCG|COCX|COCC|CODC|COBC|EYCA|AVCA|GNCA|GNCV|TKCA-7\d{4})\b/i;
var GAME_CATALOG_PREFIX_REGEX = /^(SQEX|SSCX|PCCB|WWCE|KDSD|MJCD|SCDC|KICA-1\d{3})\b/i;
var WESTERN_CATALOG_PREFIX_REGEX = /^(UICY|UICP|UICO|UICE|POCP|POCT|MVCM|MVCG|P33P|SICP|ESCA|SRCS|25\s*8P|32\s*8P|WPCR|WMC5|AMCY|32XD|25P2|TOCP|CP32|BVCP|BVCM|R32P|VICP|VICW|ALCB|PCCY)\b/i;
var ENKA_CATALOG_PREFIX_REGEX = /^(TECE|TECA|CRCN|CRSN|TKCA-9\d{4}|KICM-3\d{4}|COCA-1\d{4}|VICL-3\d{4})\b/i;
var CLASSICAL_LABEL_REGEX = /deutsche\s*grammophon|グラモフォン|decca|デッカ|philips\s*classics|フィリップス・クラシックス|emi\s*classics|sony\s*classical|ソニー・クラシカル|denon\s*classics|日本コロムビア.*denon|naxos|ナクソス|telarc|テラーク|harmonia\s*mundi|ハルモニア・ムンディ|archiv\s*produktion|アルヒーフ|erato|エラート|teldec|テルデック|london\s*records.*classic|fontec|フォンテック|オクタヴィア|octavia\s*records/i;
var JAZZ_LABEL_REGEX = /blue\s*note|ブルーノート|verve|ヴァーヴ|impulse!|インパルス|riverside|リバーサイド|prestige|プレスティッジ|\becm\b|three\s*blind\s*mice|スリー・ブラインド・マイス|somethin'?\s*else|サムシン・エルス|paddle\s*wheel|パドルホイール|concord\s*jazz|コンコード|\bcti\b|enja|エンヤ|milestone|マイルストーン|savoy\s*jazz|サヴォイ|venus\s*records|ヴィーナス・レコード|atelier\s*sawano|澤野工房/i;
var FUSION_LABEL_OR_KEYWORD_REGEX = /フュージョン|\bfusion\b|t-square|the\s*square|casiopea|カシオペア|高中正義|渡辺香津美|シャカタク|スタッフ|スパイロ・ジャイラ|クルセイダーズ|クロスオーバー|村田陽一|dimension|ディメンション/i;
var ANIME_GAME_LABEL_REGEX = /lantis|ランティス|flying\s*dog|flyingdog|フライングドッグ|aniplex|アニプレックス|sacra\s*music|starchild|スターチャイルド|king\s*amusement|media\s*factory|メディアファクトリー|kadokawa.*アニメ|ブシロードミュージック|bushiroad\s*music|square\s*enix|スクウェア・エニックス|nbc\s*universal.*anime|エイベックス・ピクチャーズ|avex\s*pictures|日本コロムビア.*animex|toho\s*animation|東宝アニメーション|バンダイナムコアーツ/i;
var NON_IDOL_MUSICIAN_LABEL_REGEX = /\burc\b|アングラ・レコード・クラブ|エレック|elec\s*records|ベルウッド|bellwood|フォーライフ|for\s*life|エキスプレス|express\s*records|東芝emi\s*[/／]\s*express|アルファ|alfa\s*records|ナイアガラ|niagara|moon\s*records|ムーン・レコード|air\s*records|キティ|kitty\s*records|パナム|panam|バーボン|bourbon\s*records|ミディ|\bmidi\b|showboat|ショーボート|トライアド|triad|スピードスター|speedstar|キューン|ki\/oon|トイズファクトリー|toy's\s*factory|cutting\s*edge|b-gram|giza\s*studio|ギザスタジオ|ワーナー.*atlantic|meldac|メルダック/i;
var IDOL_DEDICATED_LABEL_REGEX = /johnny's|j\s*storm|ジャニーズ|storm\s*labels|starto|ment\s*recording|aks\b|you,\s*be\s*cool|n46div|乃木坂46合同会社|seed\s*&\s*flower|zetima|ゼティマ|up-front|アップフロント|hello!\s*project|ハロー!プロジェクト|t-palette|stardust|スターダスト|nav\s*records|キャニオン.*アイドル|b\.o\.l|わーすた|アソビシステム.*idol|jeki|キングレコード.*akb/i;
var NON_IDOL_ARTIST_PATTERNS = [
  // Folk / New Music / Singer-Songwriters (1970s-1980s+)
  {
    pattern: /松任谷由実|荒井由実|yumi\s*matsutoya|yumi\s*arai/i,
    primaryGenre: "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF",
    additionalTags: ["\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC", "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7"],
    reason: "\u677E\u4EFB\u8C37\u7531\u5B9F\uFF08\u8352\u4E95\u7531\u5B9F\uFF09\u306F\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\uFF0F\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\u306E\u4EE3\u8868\u683C\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /中島みゆき|miyuki\s*nakajima/i,
    primaryGenre: "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF",
    additionalTags: ["\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC", "\u30D5\u30A9\u30FC\u30AF"],
    reason: "\u4E2D\u5CF6\u307F\u3086\u304D\u306F\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\uFF0F\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /竹内まりや|mariya\s*takeuchi|山下達郎|tatsuro\s*yamashita|大貫妙子|taeko\s*onuki|吉田美奈子|大滝詠一|大瀧詠一|eiichi\s*ohtaki|細野晴臣|角松敏生|杉山清貴|オメガトライブ|寺尾聰|稲垣潤一|杏里\b|anri\b|菊池桃子.*ラ・ムー|大橋純子|八神純子|尾崎亜美|EPO\b|佐藤博|松原みき/i,
    primaryGenre: "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7",
    additionalTags: ["\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF"],
    reason: "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7\uFF0F\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u7CFB\u306E\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\u30FB\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /五輪真弓|丸山圭子|渡辺真知子|庄野真代|久保田早紀|谷山浩子|矢野顕子|白鳥英美子|トワ・エ・モワ|赤い鳥|ハイ・ファイ・セット|サーカス|ダ・カーポ|紙ふうせん|あみん|岡村孝子|辛島美登里|平松愛理|古内東子|広瀬香美|沢田知可子|永井真理子|渡辺美里/i,
    primaryGenre: "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF",
    additionalTags: ["\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC"],
    reason: "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\uFF0F\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\u30FB\u30DC\u30FC\u30AB\u30EB\u30B0\u30EB\u30FC\u30D7\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /吉田拓郎|井上陽水|泉谷しげる|小椋佳|かぐや姫|南こうせつ|イルカ|風\b|伊勢正三|ガロ\b|GARO\b|アリス\b|谷村新司|さだまさし|グレープ|松山千春|長渕剛|チューリップ|財津和夫|オフコース|小田和正|甲斐バンド|海援隊|ふきのとう|NSP\b|ばんばひろふみ|山崎ハコ|森田童子|中島みゆき|高石ともや|岡林信康|フォーク・クルセダーズ/i,
    primaryGenre: "\u30D5\u30A9\u30FC\u30AF",
    additionalTags: ["\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF", "\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC"],
    reason: "\u30D5\u30A9\u30FC\u30AF\uFF0F\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u306E\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u30FB\u30B0\u30EB\u30FC\u30D7\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /浜田省吾|佐野元春|尾崎豊|氷室京介|布袋寅泰|boøwy|boowy|吉川晃司|大沢誉志幸|安全地帯|玉置浩二|ハウンド・ドッグ|hound\s*dog|レベッカ|rebecca|nokko|プリンセス・プリンセス|プリンセス\s*プリンセス|princess\s*princess|show-ya|x\s*japan|luna\s*sea|buck-tick|the\s*yellow\s*monkey|スピッツ|spitz|mr\.?\s*children|b'z\b|glay\b|l'arc~en~ciel|ラルク|サザンオールスターズ|桑田佳祐|原由子|チューブ|tube\b|ユニコーン|unicorn|エレファントカシマシ|椎名林檎|東京事変|チャットモンチー|judy\s*and\s*mary|yuki\b|superfly|あいみょん|yui\b|緑黄色社会|official髭男dism|king\s*gnu|mrs\.?\s*green\s*apple|back\s*number|radwimps|bump\s*of\s*chicken|one\s*ok\s*rock|ポルノグラフィティ/i,
    primaryGenre: "\u30ED\u30C3\u30AF",
    additionalTags: ["J-Pop"],
    reason: "\u30ED\u30C3\u30AF\u30D0\u30F3\u30C9\uFF0F\u30ED\u30C3\u30AF\u30FB\u30DD\u30C3\u30D7\u30B9\u7CFB\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /宇多田ヒカル|hikaru\s*utada|misia\b|double\b|ai\b|結晶|久保田利伸|鈴木雅之|ゴスペラーズ|chemistry|平井堅|juju\b|青山テルマ|加藤ミリヤ|crystal\s*kay|m-flo|露崎春女/i,
    primaryGenre: "R&B",
    additionalTags: ["J-Pop"],
    reason: "R&B\uFF0F\u30BD\u30A6\u30EB\u30FB\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /zard\b|坂井泉水|大黒摩季|倉木麻衣|愛内里菜|garnet\s*crow|小松未歩|b'z|wands|t-bolan|deen\b|field\s*of\s*view|相川七瀬|every\s*little\s*thing|持田香織|globe\b|trf\b|華原朋美|hitomi\b|浜崎あゆみ|安室奈美恵|倖田來未|大塚愛|aiko\b|絢香|西野カナ|いきものがかり|miwa\b|家入レオ|一青窈|アンジェラ・アキ|中島美嘉|鬼束ちひろ|元ちとせ|夏川りみ|dreams\s*come\s*true|ドリームズ・カム・トゥルー|吉田美和|chage\s*and\s*aska|chage\s*&\s*aska|チャゲ&飛鳥|飛鳥涼|徳永英明|槇原敬之|小田和正|スキマスイッチ|コブクロ|ゆず|秦基博|星野源|米津玄師|藤井風|vaundy|yoasobi|ado\b|aimer\b|lisa\b/i,
    primaryGenre: "J-Pop",
    reason: "J-Pop\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\uFF0F\u30D0\u30F3\u30C9\uFF0F\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /イエロー・マジック・オーケストラ|yellow\s*magic\s*orchestra|\bymo\b|坂本龍一|高橋幸宏|細野晴臣|tm\s*network|小室哲哉|access\b|電気グルーヴ|capsule|中田ヤスタカ|p-model|平沢進|プラスチックス|ヒカシュー/i,
    primaryGenre: "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7",
    reason: "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7\uFF0F\u30A8\u30EC\u30AF\u30C8\u30ED\u30CB\u30C3\u30AF\u7CFB\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /美空ひばり|石原裕次郎|北島三郎|五木ひろし|森進一|八代亜紀|石川さゆり|都はるみ|細川たかし|吉幾三|鳥羽一郎|天童よしみ|坂本冬美|藤あや子|伍代夏子|長山洋子|水森かおり|氷川きよし|山内惠介|三山ひろし|テレサ・テン|ちあきなおみ|青江三奈|藤圭子|桂銀淑/i,
    primaryGenre: "\u6F14\u6B4C",
    additionalTags: ["\u662D\u548C\u6B4C\u8B21"],
    reason: "\u6F14\u6B4C\u30FB\u6B4C\u8B21\u66F2\u306E\u6B4C\u624B\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  },
  {
    pattern: /高橋真梨子|ペドロ&カプリシャス|大橋純子|布施明|尾崎紀世彦|沢田研二.*Julie|梓みちよ|伊東ゆかり|弘田三枝子|ピンキーとキラーズ|ブルー・コメッツ|ザ・タイガース|ザ・テンプターズ|ザ・スパイダース|ちあきなおみ|黛ジュン|いしだあゆみ|欧陽菲菲|朱里エイコ|しばたはつみ/i,
    primaryGenre: "\u662D\u548C\u6B4C\u8B21",
    reason: "\u662D\u548C\u6B4C\u8B21\u30FB\u5B9F\u529B\u6D3E\u30DC\u30FC\u30AB\u30EA\u30B9\u30C8\uFF0FGS\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916"
  }
];
var VERIFIED_IDOL_ARTIST_REGEX = /山口百恵|松田聖子|中森明菜|小泉今日子|河合奈保子|柏原芳恵|柏原よしえ|堀ちえみ|早見優|松本伊代|石川秀美|菊池桃子|斉藤由貴|南野陽子|浅香唯|中山美穂|工藤静香|森高千里|wink\b|おニャン子クラブ|新田恵利|国生さゆり|渡辺美奈代|渡辺満里奈|高井麻巳子|うしろゆびさされ組|うしろ髪ひかれ隊|キャンディーズ|ピンク・レディー|ピンクレディー|南沙織|天地真理|麻丘めぐみ|アグネス・チャン|桜田淳子|榊原郁恵|石野真子|岩崎良美|岩崎宏美|薬師丸ひろ子|原田知世|岡田有希子|本田美奈子|荻野目洋子|森口博子|西村知美|酒井法子|芳本美代子|佐野量子|西田ひかる|田村英里子|coco\b|ribbon\b|三浦理恵子|瀬能あづさ|宮沢りえ|観月ありさ|牧瀬里穂|内田有紀|広末涼子|辺見えみり|雛形あきこ|高橋由美子|宍戸留美|桜井智|モーニング娘|松浦亜弥|後藤真希|安倍なつみ|藤本美貴|berryz工房|℃-ute|c-ute|アンジュルム|スマイレージ|juice=juice|つばきファクトリー|beyooooonds|ハロー!プロジェクト|太陽とシスコムーン|ミニモニ|プッチモニ|タンポポ|akb48|ske48|nmb48|hkt48|ngt48|stu48|sdn48|乃木坂46|欅坂46|櫻坂46|日向坂46|けやき坂46|吉本坂46|ももいろクローバー|ももクロ|私立恵比寿中学|エビ中|しゃちほこ|TEAM\s*SHACHI|ときめき♡宣伝部|超ときめき|でんぱ組|アイドリング|パスポ|passpo|フェアリーズ|東京女子流|9nine|ベイビーレイズ|biS\b|biSH\b|豆柴の大群|fruits\s*zipper|candy\s*tune|sweet\s*steady|cutie\s*street|イコールラブ|=love|≠me|≒joy|ラストアイドル|虹のコンキスタドール|まねきケチャ|わーすた|さくら学院|babymetal|perfume|niziu|me:i\b|is:sue|郷ひろみ|西城秀樹|野口五郎|フォーリーブス|たのきん|田原俊彦|近藤真彦|野村義男|シブがき隊|少年隊|光genji|男闘呼組|忍者\b|チェッカーズ|smap|tokio|v6\b|kinki\s*kids|嵐\b|arashi|タッキー&翼|news\b|関ジャニ|super\s*eight|kat-tun|hey!\s*say!\s*jump|kis-my-ft2|キスマイ|sexy\s*zone|timelesz|a\.b\.c-z|ジャニーズwest|west\.|king\s*&\s*prince|キンプリ|sixtones|snow\s*man|なにわ男子|travis\s*japan|aぇ!\s*group|jo1\b|ini\b|da\s*pump|w-inds|lead\b|超特急|m!lk\b|ラブライブ|μ's|aqours|虹ヶ咲|liella|蓮ノ空|アイドルマスター|idolmaster|アイマス|シンデレラガールズ|ミリオンライブ|シャイニーカラーズ|アイカツ|プリパラ|うたの☆プリンス|アイドリッシュセブン|すとぷり/i;
var KNOWN_JAPANESE_ROMAJI_ARTIST_REGEX = /\b(b'z|zard|glay|l'arc~en~ciel|luna\s*sea|x\s*japan|boøwy|boowy|buck-tick|tm\s*network|trf|globe|every\s*little\s*thing|judy\s*and\s*mary|mr\.?\s*children|dreams\s*come\s*true|chage\s*and\s*aska|chage\s*&\s*aska|spitz|southern\s*all\s*stars|tube|rebecca|princess\s*princess|show-ya|hound\s*dog|unicorn|the\s*yellow\s*monkey|bump\s*of\s*chicken|radwimps|one\s*ok\s*rock|mrs\.?\s*green\s*apple|back\s*number|king\s*gnu|official\s*higedan\s*dism|yoasobi|aimer|lisa|ado|vaundy|milet|misia|ai|double|juju|aiko|yui|superfly|miwa|chay|benny\s*k|chemistry|m-flo|dragon\s*ash|rip\s*slyme|kick\s*the\s*can\s*crew|kreva|zeebra|rhymester|def\s*tech|orangestar|perfume|babymetal|akb48|ske48|nmb48|hkt48|smap|tokio|v6|kinki\s*kids|arashi|news|kat-tun|hey!\s*say!\s*jump|kis-my-ft2|sexy\s*zone|timelesz|a\.b\.c-z|west\.|king\s*&\s*prince|sixtones|snow\s*man|travis\s*japan|jo1|ini|be:first|niziu|xg|w-inds\.?|da\s*pump|exile|jsb|generations|rampage|fantastics|ballistik\s*boyz|aaa|speed|max|folder\s*5|wink|coco|ribbon|biSH|bis|t-square|the\s*square|casiopea|dimension|ymo|yellow\s*magic\s*orchestra|p-model|plastics|hikashu|cornelius|pizzicato\s*five|original\s*love|flipper's\s*guitar|sunny\s*day\s*service|fishmans|number\s*girl|asian\s*kung-fu\s*generation|ellegarden|hi-standard|wanima|10-feet|man\s*with\s*a\s*mission|alexandros|kana-boon|shishamo|scandal|silent\s*siren|band-maid|lovebites|dir\s*en\s*grey|the\s*gazette|pierrot|siam\s*shade|janne\s*da\s*arc|acid\s*black\s*cherry|gackt|hyde|miyavi|t\.m\.revolution|access|iceman|fripSide|granrodeo|angela|kalafina|fictionjunction|ali\s*project|jam\s*project|claris|trySail|sphere|aqours|liella|μ's|garnet\s*crow|deen|wands|t-bolan|field\s*of\s*view|baad|rev|pamela|be-b)\b/i;
function parseReleaseYear(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).trim().match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  return isNaN(y) ? null : y;
}
function parseDurationToSeconds(duration) {
  if (!duration) return null;
  const trimmed = String(duration).trim();
  const mmss = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (mmss) {
    if (mmss[3] !== void 0) {
      return parseInt(mmss[1], 10) * 3600 + parseInt(mmss[2], 10) * 60 + parseInt(mmss[3], 10);
    }
    return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  }
  const secMatch = trimmed.match(/^(\d+)\s*s$/i);
  if (secMatch) {
    return parseInt(secMatch[1], 10);
  }
  return null;
}
function containsJapaneseScript(text) {
  if (!text) return false;
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}
function isNonJapaneseBarcode(barcode) {
  if (!barcode) return false;
  const digits = String(barcode).replace(/\D/g, "");
  if (digits.length !== 12 && digits.length !== 13) return false;
  if (digits.startsWith("45") || digits.startsWith("49")) return false;
  if (digits.startsWith("880") || digits.startsWith("471") || digits.startsWith("489")) return false;
  return true;
}
function analyzeTrackStructure(tracks) {
  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return {
      trackCount: 0,
      avgDurationSec: 0,
      maxDurationSec: 0,
      hasKaraokeOrInstrumentalTracks: false,
      isLongFormInstrumentalOrClassicalStructure: false
    };
  }
  const durations = [];
  let hasKaraoke = false;
  let classicalMovementCount = 0;
  for (const t of tracks) {
    const d = parseDurationToSeconds(t.duration);
    if (d !== null && d > 0) {
      durations.push(d);
    }
    const title = t.title || "";
    if (/カラオケ|karaoke|off\s*vocal|instrumental|インストゥルメンタル|less\s*vocal|backing\s*track/i.test(title)) {
      hasKaraoke = true;
    }
    if (/\b(allegro|adagio|andante|presto|scherzo|largo|moderato|第[1-9一二三四五]楽章|mov\.?\s*\d|op\.\s*\d+|bwv\s*\d+)\b/i.test(title)) {
      classicalMovementCount++;
    }
  }
  const avgDurationSec = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const maxDurationSec = durations.length > 0 ? Math.max(...durations) : 0;
  const isLongFormInstrumentalOrClassicalStructure = durations.length >= 3 && avgDurationSec >= 350 || maxDurationSec >= 540 || classicalMovementCount >= 2;
  return {
    trackCount: tracks.length,
    avgDurationSec,
    maxDurationSec,
    hasKaraokeOrInstrumentalTracks: hasKaraoke,
    isLongFormInstrumentalOrClassicalStructure
  };
}
function runGenreRulePrecheck(input) {
  const catNo = (input.catalogNumber || "").trim().toUpperCase();
  const vinylCatNo = (input.vinylRecordCatalogNumber || "").trim().toUpperCase();
  const label = (input.label || "").trim();
  const title = (input.title || "").trim();
  const artist = (input.artist || "").trim();
  const notes = (input.notes || "").trim();
  const format = (input.format || "").trim();
  const vinylFormat = (input.vinylRecordFormat || "").trim();
  const country = (input.country || "").trim().toUpperCase();
  const barcode = (input.barcode || "").trim();
  const existingGenre = (input.genre || "").trim();
  const existingTags = input.existingTags || [];
  const vinylYear = parseReleaseYear(input.vinylRecordReleaseDate);
  const cdYear = parseReleaseYear(input.releaseDate);
  const effectiveYear = vinylYear ?? cdYear;
  const effectiveDateSource = vinylYear !== null ? "LP/EP\u767A\u58F2\u5E74\u6708\u65E5" : cdYear !== null ? "CD\u767A\u58F2\u5E74\u6708\u65E5" : "\u672A\u8A2D\u5B9A";
  const isPreJPopEra = effectiveYear !== null && effectiveYear <= 1987;
  const isEarlyPreJPopEra = effectiveYear !== null && effectiveYear <= 1985;
  const trackDurationStats = analyzeTrackStructure(input.tracks);
  const enforcedTags = [];
  const blockedTags = [];
  let enforcedPrimaryGenre;
  const addEnforcedTag = (tag, category, evidence, sourceFields) => {
    if (!enforcedTags.some((e) => e.tag === tag)) {
      enforcedTags.push({ tag, category, evidence, sourceFields });
    }
  };
  const addBlockedTag = (tag, reason, sourceFields) => {
    if (!blockedTags.some((b) => b.tag === tag)) {
      blockedTags.push({ tag, reason, sourceFields });
    }
  };
  const isClassicalCat = CLASSICAL_CATALOG_PREFIX_REGEX.test(catNo) || CLASSICAL_CATALOG_PREFIX_REGEX.test(vinylCatNo);
  const isClassicalLabel = CLASSICAL_LABEL_REGEX.test(label);
  const isClassicalTitleOrNotes = /交響曲|協奏曲|ソナタ|弦楽四重奏|管弦楽団|フィルハーモニー|交響楽団|室内楽|オペラ|レクイエム|カンタータ|symphony|concerto|sonata|philharmonic|orchestra|\bbwv\s*\d+|\bop\.\s*\d+/i.test(
    `${title} ${notes} ${artist}`
  );
  if (isClassicalCat || isClassicalLabel || isClassicalTitleOrNotes) {
    const sources = [];
    if (isClassicalCat) sources.push("\u898F\u683C\u54C1\u756A");
    if (isClassicalLabel) sources.push("\u30EC\u30FC\u30D9\u30EB");
    if (isClassicalTitleOrNotes) sources.push("\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003");
    enforcedPrimaryGenre = "\u30AF\u30E9\u30B7\u30C3\u30AF";
    addEnforcedTag(
      "\u30AF\u30E9\u30B7\u30C3\u30AF",
      "genre",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: ${sources.join("\u30FB")}\uFF08${catNo || label || title}\uFF09\u304C\u30AF\u30E9\u30B7\u30C3\u30AF\u97F3\u697D\u306E\u898F\u683C\u30FB\u4F53\u7CFB\u3068\u4E00\u81F4`,
      sources
    );
    addBlockedTag("\u30A2\u30A4\u30C9\u30EB", `${sources.join("\u30FB")}\u304C\u30AF\u30E9\u30B7\u30C3\u30AF\u898F\u683C\u306E\u305F\u3081\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916`, sources);
    addBlockedTag("J-Pop", `${sources.join("\u30FB")}\u304C\u30AF\u30E9\u30B7\u30C3\u30AF\u898F\u683C\u306E\u305F\u3081\u300CJ-Pop\u300D\u3092\u9664\u5916`, sources);
    addBlockedTag("\u662D\u548C\u6B4C\u8B21", `${sources.join("\u30FB")}\u304C\u30AF\u30E9\u30B7\u30C3\u30AF\u898F\u683C\u306E\u305F\u3081\u300C\u662D\u548C\u6B4C\u8B21\u300D\u3092\u9664\u5916`, sources);
  }
  const isJazzCat = JAZZ_CATALOG_PREFIX_REGEX.test(catNo) || JAZZ_CATALOG_PREFIX_REGEX.test(vinylCatNo);
  const isJazzLabel = JAZZ_LABEL_REGEX.test(label);
  const isJazzTitleOrNotes = /カルテット|クインテット|セクステット|ジャズ・トリオ|ピアノ・トリオ|ビッグ・バンド|jazz\s*quartet|jazz\s*quintet|jazz\s*trio|live\s*at\s*the\s*village\s*vanguard|モダン・ジャズ/i.test(
    `${title} ${notes} ${artist}`
  );
  const isFusion = FUSION_LABEL_OR_KEYWORD_REGEX.test(`${artist} ${title} ${label} ${notes}`);
  if (!enforcedPrimaryGenre && (isJazzCat || isJazzLabel || isJazzTitleOrNotes || isFusion)) {
    const targetGenre = isFusion && !isJazzLabel ? "\u30D5\u30E5\u30FC\u30B8\u30E7\u30F3" : "\u30B8\u30E3\u30BA";
    const sources = [];
    if (isJazzCat) sources.push("\u898F\u683C\u54C1\u756A");
    if (isJazzLabel) sources.push("\u30EC\u30FC\u30D9\u30EB");
    if (isJazzTitleOrNotes || isFusion) sources.push("\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003\u30FB\u7DE8\u6210");
    enforcedPrimaryGenre = targetGenre;
    addEnforcedTag(
      targetGenre,
      "genre",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: ${sources.join("\u30FB")}\uFF08${label || catNo || title}\uFF09\u304C${targetGenre}\u306E\u5C02\u9580\u30EC\u30FC\u30D9\u30EB\u30FB\u898F\u683C\u3068\u4E00\u81F4`,
      sources
    );
    addBlockedTag("\u30A2\u30A4\u30C9\u30EB", `${sources.join("\u30FB")}\u304C${targetGenre}\u898F\u683C\u306E\u305F\u3081\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916`, sources);
    addBlockedTag("J-Pop", `${sources.join("\u30FB")}\u304C${targetGenre}\u898F\u683C\u306E\u305F\u3081\u300CJ-Pop\u300D\u3092\u9664\u5916`, sources);
  }
  const isGameCat = GAME_CATALOG_PREFIX_REGEX.test(catNo);
  const isGameTitleOrNotes = /ゲーム音楽|オリジナル・サウンドトラック.*ゲーム|game\s*soundtrack|game\s*music/i.test(
    `${title} ${notes} ${label}`
  );
  const isAnimeCat = ANIME_CATALOG_PREFIX_REGEX.test(catNo);
  const isAnimeLabel = ANIME_GAME_LABEL_REGEX.test(label);
  const isAnimeTitleOrNotes = /tvアニメ|テレビアニメ|劇場版アニメ|アニメーション|アニメ主題歌|オープニングテーマ|エンディングテーマ|キャラクターソング|キャラソン|アニメ「|『.*』主題歌/i.test(
    `${title} ${notes}`
  );
  if (isGameCat || isGameTitleOrNotes) {
    const sources = [];
    if (isGameCat) sources.push("\u898F\u683C\u54C1\u756A");
    if (isGameTitleOrNotes) sources.push("\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003");
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = "\u30B2\u30FC\u30E0\u97F3\u697D";
    addEnforcedTag(
      "\u30B2\u30FC\u30E0\u97F3\u697D",
      "genre",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: ${sources.join("\u30FB")}\uFF08${catNo || label || title}\uFF09\u304B\u3089\u30B2\u30FC\u30E0\u97F3\u697D\u4F5C\u54C1\u3068\u7279\u5B9A`,
      sources
    );
    addBlockedTag("\u30A2\u30A4\u30C9\u30EB", "\u30B2\u30FC\u30E0\u97F3\u697D\u898F\u683C\u306E\u305F\u3081\u6839\u62E0\u306E\u306A\u3044\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916", sources);
  } else if (isAnimeCat || isAnimeLabel || isAnimeTitleOrNotes) {
    const sources = [];
    if (isAnimeCat) sources.push("\u898F\u683C\u54C1\u756A");
    if (isAnimeLabel) sources.push("\u30EC\u30FC\u30D9\u30EB");
    if (isAnimeTitleOrNotes) sources.push("\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003");
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = "\u30A2\u30CB\u30BD\u30F3";
    addEnforcedTag(
      "\u30A2\u30CB\u30BD\u30F3",
      "genre",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: ${sources.join("\u30FB")}\uFF08${catNo || label}\uFF09\u304C\u30A2\u30CB\u30E1\u97F3\u697D\u30EC\u30FC\u30D9\u30EB\u30FB\u898F\u683C\u307E\u305F\u306F\u30BF\u30A4\u30A2\u30C3\u30D7\u60C5\u5831\u3068\u4E00\u81F4`,
      sources
    );
  }
  const isWesternCat = WESTERN_CATALOG_PREFIX_REGEX.test(catNo);
  const hasNonJpBarcode = isNonJapaneseBarcode(barcode);
  const hasNonJpCountry = Boolean(country && !["JP", "JPN", "JAPAN", "\u65E5\u672C"].includes(country));
  const artistHasJapanese = containsJapaneseScript(artist);
  const titleHasJapanese = containsJapaneseScript(title);
  const isKnownJapaneseRomaji = KNOWN_JAPANESE_ROMAJI_ARTIST_REGEX.test(artist);
  const isWesternOrigin = !isKnownJapaneseRomaji && !artistHasJapanese && (isWesternCat || hasNonJpBarcode || hasNonJpCountry && !titleHasJapanese);
  if (isWesternOrigin) {
    const sources = [];
    if (isWesternCat) sources.push(`\u6D0B\u697D\u898F\u683C\u54C1\u756A(${catNo})`);
    if (hasNonJpBarcode) sources.push(`\u6D77\u5916EAN/UPC\u30D0\u30FC\u30B3\u30FC\u30C9(${barcode})`);
    if (hasNonJpCountry) sources.push(`\u30EA\u30EA\u30FC\u30B9\u56FD(${country})`);
    sources.push("\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u8868\u8A18");
    addEnforcedTag(
      "\u6D0B\u697D",
      "genre",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: ${sources.join("\u30FB")}\u304B\u3089\u6D77\u5916\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\uFF08\u6D0B\u697D\uFF09\u3068\u5224\u5B9A`,
      ["\u898F\u683C\u54C1\u756A\u30FB\u30EC\u30FC\u30D9\u30EB", "JAN\u30D0\u30FC\u30B3\u30FC\u30C9\u30FB\u30EA\u30EA\u30FC\u30B9\u56FD"]
    );
    addBlockedTag("\u90A6\u697D", `${sources.join("\u30FB")}\u306B\u3088\u308A\u6D0B\u697D\u4F5C\u54C1\u3068\u5224\u5B9A\u3055\u308C\u305F\u305F\u3081\u300C\u90A6\u697D\u300D\u3092\u9664\u5916`, ["JAN\u30D0\u30FC\u30B3\u30FC\u30C9\u30FB\u30EA\u30EA\u30FC\u30B9\u56FD", "\u898F\u683C\u54C1\u756A"]);
    addBlockedTag("J-Pop", `${sources.join("\u30FB")}\u306B\u3088\u308A\u6D0B\u697D\u4F5C\u54C1\u3068\u5224\u5B9A\u3055\u308C\u305F\u305F\u3081\u300CJ-Pop\u300D\u3092\u9664\u5916`, ["JAN\u30D0\u30FC\u30B3\u30FC\u30C9\u30FB\u30EA\u30EA\u30FC\u30B9\u56FD", "\u898F\u683C\u54C1\u756A"]);
    addBlockedTag("\u30A2\u30A4\u30C9\u30EB", `${sources.join("\u30FB")}\u306B\u3088\u308A\u6D0B\u697D\u4F5C\u54C1\u3068\u5224\u5B9A\u3055\u308C\u305F\u305F\u3081\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916`, ["JAN\u30D0\u30FC\u30B3\u30FC\u30C9\u30FB\u30EA\u30EA\u30FC\u30B9\u56FD", "\u898F\u683C\u54C1\u756A"]);
    addBlockedTag("\u662D\u548C\u6B4C\u8B21", `${sources.join("\u30FB")}\u306B\u3088\u308A\u6D0B\u697D\u4F5C\u54C1\u3068\u5224\u5B9A\u3055\u308C\u305F\u305F\u3081\u300C\u662D\u548C\u6B4C\u8B21\u300D\u3092\u9664\u5916`, ["JAN\u30D0\u30FC\u30B3\u30FC\u30C9\u30FB\u30EA\u30EA\u30FC\u30B9\u56FD"]);
    addBlockedTag("\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF", `${sources.join("\u30FB")}\u306B\u3088\u308A\u6D0B\u697D\u4F5C\u54C1\u3068\u5224\u5B9A\u3055\u308C\u305F\u305F\u3081\u300C\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u300D\u3092\u9664\u5916`, ["JAN\u30D0\u30FC\u30B3\u30FC\u30C9\u30FB\u30EA\u30EA\u30FC\u30B9\u56FD"]);
  }
  const isEnkaCat = ENKA_CATALOG_PREFIX_REGEX.test(catNo);
  const isEnkaNotesOrTitle = /演歌|股旅|音頭|民謡|浪曲|全曲集.*演歌/i.test(`${title} ${notes} ${existingGenre}`);
  if (isEnkaNotesOrTitle || isEnkaCat && /演歌|全曲集/i.test(`${title} ${notes}`)) {
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = "\u6F14\u6B4C";
    addEnforcedTag(
      "\u6F14\u6B4C",
      "genre",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: \u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003\u30FB\u898F\u683C\u54C1\u756A\uFF08${catNo || title}\uFF09\u304B\u3089\u6F14\u6B4C\u4F5C\u54C1\u3068\u5224\u5B9A`,
      ["\u898F\u683C\u54C1\u756A", "\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003"]
    );
    addBlockedTag("\u30A2\u30A4\u30C9\u30EB", "\u6F14\u6B4C\u4F5C\u54C1\u306E\u305F\u3081\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916", ["\u898F\u683C\u54C1\u756A", "\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003"]);
    addBlockedTag("J-Pop", "\u6F14\u6B4C\u4F5C\u54C1\u306E\u305F\u3081\u300CJ-Pop\u300D\u3092\u9664\u5916", ["\u898F\u683C\u54C1\u756A", "\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003"]);
  }
  if (/\bbest\b|ベスト|golden☆best|ゴールデン☆ベスト|single\s*collection|シングル・コレクション|シングルコレクション|\bsingles\b|全曲集|greatest\s*hits|グレイテスト・ヒッツ|complete\s*best|コンプリート・ベスト|スーパー・ベスト|super\s*best|anthology|アンソロジー/i.test(
    `${title} ${format} ${notes}`
  )) {
    addEnforcedTag(
      "\u30D9\u30B9\u30C8\u76E4",
      "style",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: \u30A2\u30EB\u30D0\u30E0\u30BF\u30A4\u30C8\u30EB\u30FB\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u30FB\u5099\u8003\uFF08\u300C${title}\u300D\uFF09\u306B\u30D9\u30B9\u30C8\u76E4\uFF0F\u30B7\u30F3\u30B0\u30EB\u96C6\u3092\u793A\u3059\u8868\u8A18\u3092\u78BA\u8A8D`,
      ["\u30BF\u30A4\u30C8\u30EB", "\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u30FB\u5099\u8003"]
    );
  }
  if (/\blive\b|ライヴ|ライブ|concert|コンサート|リサイタル|recital|in\s*budokan|日本武道館|武道館ライブ|実況録音/i.test(
    `${title} ${format} ${notes}`
  ) && !/ラブライブ|love\s*live|ミリオンライブ|live\s*for\s*you/i.test(`${title} ${artist}`)) {
    addEnforcedTag(
      "\u30E9\u30A4\u30D6\u76E4",
      "style",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: \u30A2\u30EB\u30D0\u30E0\u30BF\u30A4\u30C8\u30EB\u30FB\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u30FB\u5099\u8003\uFF08\u300C${title}\u300D\uFF09\u306B\u30E9\u30A4\u30D6\uFF0F\u30B3\u30F3\u30B5\u30FC\u30C8\u53CE\u9332\u3092\u793A\u3059\u8868\u8A18\u3092\u78BA\u8A8D`,
      ["\u30BF\u30A4\u30C8\u30EB", "\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u30FB\u5099\u8003"]
    );
  }
  if (/original\s*soundtrack|soundtrack|\bost\b|サウンドトラック|サントラ|劇伴|音楽集|BGM集|交響組曲/i.test(
    `${title} ${format} ${notes}`
  )) {
    if (!enforcedPrimaryGenre) enforcedPrimaryGenre = "\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF";
    addEnforcedTag(
      "\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF",
      "genre",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: \u30A2\u30EB\u30D0\u30E0\u30BF\u30A4\u30C8\u30EB\u30FB\u5099\u8003\uFF08\u300C${title}\u300D\uFF09\u306B\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF\uFF0F\u5287\u4F34\u3092\u793A\u3059\u8868\u8A18\u3092\u78BA\u8A8D`,
      ["\u30BF\u30A4\u30C8\u30EB", "\u5099\u8003"]
    );
    addBlockedTag("\u30A2\u30A4\u30C9\u30EB", "\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF\uFF0F\u5287\u4F34\u4F5C\u54C1\u306E\u305F\u3081\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916", ["\u30BF\u30A4\u30C8\u30EB", "\u5099\u8003"]);
    addBlockedTag("J-Pop", "\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF\uFF0F\u5287\u4F34\u4F5C\u54C1\u306E\u305F\u3081\u300CJ-Pop\u300D\u3092\u9664\u5916", ["\u30BF\u30A4\u30C8\u30EB", "\u5099\u8003"]);
  }
  if (/cmソング|cm曲|cmタイアップ|cfソング|コマーシャルソング|コマーシャル・ソング|cmイメージソング|cm使用曲/i.test(`${title} ${notes}`)) {
    addEnforcedTag(
      "CM\u30BD\u30F3\u30B0",
      "style",
      `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: \u30BF\u30A4\u30C8\u30EB\u307E\u305F\u306F\u5099\u8003\u306BCM\u30BF\u30A4\u30A2\u30C3\u30D7\u30FB\u30B3\u30DE\u30FC\u30B7\u30E3\u30EB\u697D\u66F2\u60C5\u5831\u306E\u8A18\u8F09\u3092\u78BA\u8A8D`,
      ["\u5099\u8003", "\u30BF\u30A4\u30C8\u30EB"]
    );
  }
  for (const entry of NON_IDOL_ARTIST_PATTERNS) {
    if (entry.pattern.test(artist)) {
      addBlockedTag("\u30A2\u30A4\u30C9\u30EB", entry.reason, ["\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D", "\u30C7\u30A3\u30B9\u30B3\u30B0\u30E9\u30D5\u30A3\u898F\u5247"]);
      if (isPreJPopEra && entry.primaryGenre !== "J-Pop") {
        if (!enforcedPrimaryGenre) {
          enforcedPrimaryGenre = entry.primaryGenre;
        }
        addEnforcedTag(
          entry.primaryGenre,
          "genre",
          `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: \u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u300C${artist}\u300D\u304A\u3088\u3073\u30EA\u30EA\u30FC\u30B9\u5E74\u4EE3\uFF08${effectiveYear}\u5E74\u30FB${effectiveDateSource}\uFF09\u306E\u6642\u4EE3\u6574\u5408\u6027\u304B\u3089\u300C${entry.primaryGenre}\u300D\u3068\u7279\u5B9A`,
          ["\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D", effectiveDateSource, "\u30EC\u30FC\u30D9\u30EB"]
        );
        if (isEarlyPreJPopEra && ["\u30D5\u30A9\u30FC\u30AF", "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF", "\u662D\u548C\u6B4C\u8B21", "\u6F14\u6B4C", "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7"].includes(entry.primaryGenre)) {
          addBlockedTag(
            "J-Pop",
            `${effectiveYear}\u5E74\uFF08${effectiveDateSource}\uFF09\u306F\u300CJ-Pop\u300D\u547C\u79F0\u5B9A\u7740\uFF081988\u5E74\uFF09\u4EE5\u524D\u3067\u3042\u308A\u3001\u300C${entry.primaryGenre}\u300D\u304C\u6B63\u78BA\u306A\u6642\u4EE3\u30B8\u30E3\u30F3\u30EB\u306E\u305F\u3081\u300CJ-Pop\u300D\u3092\u9664\u5916`,
            [effectiveDateSource, "\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D"]
          );
        }
      } else if (!enforcedPrimaryGenre) {
        enforcedPrimaryGenre = entry.primaryGenre;
      }
      break;
    }
  }
  const isNonIdolMusicianLabel = NON_IDOL_MUSICIAN_LABEL_REGEX.test(label);
  const isVerifiedIdolArtist = VERIFIED_IDOL_ARTIST_REGEX.test(`${artist} ${title}`);
  const isDedicatedIdolLabel = IDOL_DEDICATED_LABEL_REGEX.test(label);
  const hasExplicitIdolInNotesOrTags = /アイドル|idol|ジャニーズ|ハロー!プロジェクト|ハロプロ|坂道シリーズ|おニャン子|スター誕生|握手会|選抜|卒業コンサート/i.test(
    `${notes} ${existingGenre} ${existingTags.join(" ")}`
  );
  if (isNonIdolMusicianLabel && !isVerifiedIdolArtist && !hasExplicitIdolInNotesOrTags) {
    addBlockedTag(
      "\u30A2\u30A4\u30C9\u30EB",
      `\u30EC\u30FC\u30D9\u30EB\u300C${label}\u300D\u306F\u30D5\u30A9\u30FC\u30AF\uFF0F\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\uFF0F\u30ED\u30C3\u30AF\uFF0F\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7\u7CFB\u306E\u5C02\u9580\u30EC\u30FC\u30D9\u30EB\u3067\u3042\u308A\u3001\u30A2\u30A4\u30C9\u30EB\u95A2\u9023\u30E1\u30BF\u30C7\u30FC\u30BF\u304C\u5B58\u5728\u3057\u306A\u3044\u305F\u3081\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916`,
      ["\u30EC\u30FC\u30D9\u30EB"]
    );
    if (isPreJPopEra && !enforcedPrimaryGenre) {
      const preGenre = effectiveYear && effectiveYear <= 1974 ? "\u30D5\u30A9\u30FC\u30AF" : "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF";
      enforcedPrimaryGenre = preGenre;
      addEnforcedTag(
        preGenre,
        "genre",
        `\u30EB\u30FC\u30EB\u30D9\u30FC\u30B9\u5224\u5B9A: \u30EC\u30FC\u30D9\u30EB\u300C${label}\u300D\u304A\u3088\u3073\u767A\u58F2\u5E74\uFF08${effectiveYear}\u5E74\u30FB${effectiveDateSource}\uFF09\u304B\u3089\u300C${preGenre}\u300D\u3068\u5224\u5B9A`,
        ["\u30EC\u30FC\u30D9\u30EB", effectiveDateSource]
      );
    }
  }
  if (trackDurationStats.isLongFormInstrumentalOrClassicalStructure && !isVerifiedIdolArtist && !isDedicatedIdolLabel && !hasExplicitIdolInNotesOrTags) {
    addBlockedTag(
      "\u30A2\u30A4\u30C9\u30EB",
      `\u53CE\u9332\u66F2\u306E\u5E73\u5747\u6F14\u594F\u6642\u9593\uFF08\u7D04${Math.round(trackDurationStats.avgDurationSec / 60)}\u5206\uFF09\u307E\u305F\u306F\u9577\u5C3A\u30C8\u30E9\u30C3\u30AF\u69CB\u6210\uFF08\u6700\u5927${Math.round(
        trackDurationStats.maxDurationSec / 60
      )}\u5206\uFF09\u304C\u30A2\u30A4\u30C9\u30EB\u30DD\u30C3\u30D7\u30B9\u898F\u683C\u5916\u306E\u305F\u3081\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u3092\u9664\u5916`,
      ["\u53CE\u9332\u66F2\u6570\u30FB\u6F14\u594F\u6642\u9593"]
    );
  }
  if (/シンガーソングライター|シンガー・ソングライター|全曲作詞・作曲|自作詞・自作曲|ロック・バンド|ロックバンド|フォーク・グループ|インストゥルメンタル/i.test(
    notes
  ) && !isVerifiedIdolArtist && !hasExplicitIdolInNotesOrTags) {
    addBlockedTag(
      "\u30A2\u30A4\u30C9\u30EB",
      `\u5099\u8003\u30E1\u30BF\u30C7\u30FC\u30BF\u306B\u300C\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\uFF0F\u30D0\u30F3\u30C9\uFF0F\u30A4\u30F3\u30B9\u30C8\u30A5\u30EB\u30E1\u30F3\u30BF\u30EB\u300D\u306E\u8A18\u8FF0\u304C\u3042\u308A\u30A2\u30A4\u30C9\u30EB\u3067\u306F\u306A\u3044\u305F\u3081\u9664\u5916`,
      ["\u5099\u8003"]
    );
  }
  if (isEarlyPreJPopEra && !isWesternOrigin && !enforcedPrimaryGenre) {
    if (/フォーク/i.test(`${notes} ${existingGenre} ${existingTags.join(" ")}`)) {
      enforcedPrimaryGenre = "\u30D5\u30A9\u30FC\u30AF";
    } else if (/シティポップ|city\s*pop/i.test(`${notes} ${existingGenre} ${existingTags.join(" ")}`)) {
      enforcedPrimaryGenre = "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7";
    } else if (/ニューミュージック|new\s*music/i.test(`${notes} ${existingGenre} ${existingTags.join(" ")}`)) {
      enforcedPrimaryGenre = "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF";
    } else if (/昭和歌謡|歌謡曲/i.test(`${notes} ${existingGenre} ${existingTags.join(" ")}`)) {
      enforcedPrimaryGenre = "\u662D\u548C\u6B4C\u8B21";
    } else if (vinylFormat && /^(EP|7"|7inch)$/i.test(vinylFormat) && effectiveYear && effectiveYear <= 1982) {
      addBlockedTag(
        "J-Pop",
        `\u540C\u30BF\u30A4\u30C8\u30EB\u76E4\u7A2E\u300C${vinylFormat}\u300D\u304A\u3088\u3073\u767A\u58F2\u5E74\uFF08${effectiveYear}\u5E74\u30FB${effectiveDateSource}\uFF09\u306F1988\u5E74\u4EE5\u524D\u306E\u662D\u548C\u671F\u30EA\u30EA\u30FC\u30B9\u306E\u305F\u3081\u3001\u5B89\u6613\u306A\u300CJ-Pop\u300D\u5224\u5B9A\u3092\u6291\u5236`,
        [effectiveDateSource, "LP/EP\u76E4\u7A2E"]
      );
    }
  }
  const idolSignalReasons = [];
  if (isVerifiedIdolArtist) {
    idolSignalReasons.push(`\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u30FB\u4F5C\u54C1\u540D\uFF08${artist}\uFF09\u304C\u65E5\u672C\u306E\u30A2\u30A4\u30C9\u30EB\uFF0F\u30A2\u30A4\u30C9\u30EB\u30B0\u30EB\u30FC\u30D7\u3068\u4E00\u81F4`);
  }
  if (isDedicatedIdolLabel) {
    idolSignalReasons.push(`\u30EC\u30FC\u30D9\u30EB\uFF08${label}\uFF09\u304C\u30A2\u30A4\u30C9\u30EB\u5C02\u9580\u30EC\u30FC\u30D9\u30EB\u30FB\u4E8B\u52D9\u6240\u30EC\u30FC\u30D9\u30EB\u3068\u4E00\u81F4`);
  }
  if (hasExplicitIdolInNotesOrTags) {
    idolSignalReasons.push("\u65E2\u5B58\u30BF\u30B0\u30FB\u30B8\u30E3\u30F3\u30EB\u307E\u305F\u306F\u5099\u8003\u306B\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u95A2\u9023\u306E\u660E\u793A\u7684\u306A\u8A18\u8F09\u3042\u308A");
  }
  if (effectiveYear && effectiveYear >= 1970 && effectiveYear <= 1989 && /^(EP|7"|LP)$/i.test(vinylFormat) && /キャニオン|canyon|cbs.*sony|ワーナー・パイオニア|warner.*pioneer|バップ|\bvap\b|ビクター|日本コロムビア|トーラス|フォーライフ|ポリドール|徳間ジャパン/i.test(
    label
  ) && !isNonIdolMusicianLabel && !NON_IDOL_ARTIST_PATTERNS.some((p) => p.pattern.test(artist))) {
    idolSignalReasons.push(
      `${effectiveYear}\u5E74\u30EA\u30EA\u30FC\u30B9\uFF08${vinylFormat}\u76E4\uFF09\u30FB\u6B4C\u8B21/\u30A2\u30A4\u30C9\u30EB\u7CFB\u30E1\u30B8\u30E3\u30FC\u30EC\u30FC\u30D9\u30EB\uFF08${label}\uFF09\u306E\u6642\u4EE3\u30FB\u76E4\u7A2E\u6761\u4EF6\u306B\u8A72\u5F53`
    );
  }
  const hasPositiveIdolSignal = idolSignalReasons.length > 0;
  return {
    effectiveYear,
    effectiveDateSource,
    isPreJPopEra,
    isEarlyPreJPopEra,
    isWesternOrigin,
    enforcedPrimaryGenre,
    enforcedTags,
    blockedTags,
    hasPositiveIdolSignal,
    idolSignalReasons,
    trackDurationStats
  };
}
var DECADE_TAG_REGEX = /^(19\d0|20\d0|[56789]0)年代$/;
function applyGenreRuleFilter(input, candidateTags, candidateGenre, candidateSubGenre, candidateReasoning, candidateEvidence) {
  const precheck = runGenreRulePrecheck(input);
  const ruleAdjustments = [];
  let workingTags = Array.from(new Set(candidateTags.filter(Boolean)));
  let workingGenre = (candidateGenre || "").trim();
  let workingSubGenre = candidateSubGenre ? candidateSubGenre.trim() : void 0;
  let workingEvidence = Array.isArray(candidateEvidence) ? [...candidateEvidence] : [];
  const combinedAiText = `${candidateReasoning || ""} ${workingEvidence.map((e) => e.evidence).join(" ")}`;
  const aiMentionsNonIdolRole = /シンガーソングライター|シンガー・ソングライター|自作詞|自作曲|全曲作詞|全曲作曲|ロックバンド|ロック・バンド|フォーク・グループ|フォークシンガー|ニューミュージックの旗手|シティポップの代表|ジャズ・ボーカル|演歌歌手|実力派ボーカリスト/i.test(
    combinedAiText
  ) && !/アイドルとしてデビュー|アイドル歌手|アイドルグループ|アイドル歌謡|トップアイドル|女性アイドル|男性アイドル/i.test(
    combinedAiText
  );
  const aiExplicitlyConfirmsIdol = /アイドルとしてデビュー|アイドル歌手|アイドルグループ|アイドル歌謡|トップアイドル|女性アイドル|男性アイドル|80年代アイドル|70年代アイドル|90年代アイドル|ジャニーズ|ハロプロ|坂道|おニャン子/i.test(
    combinedAiText
  );
  const blockedTagNames = new Set(precheck.blockedTags.map((b) => b.tag));
  for (const blocked of precheck.blockedTags) {
    if (workingTags.includes(blocked.tag) || workingGenre === blocked.tag || workingSubGenre === blocked.tag) {
      workingTags = workingTags.filter((t) => t !== blocked.tag);
      workingEvidence = workingEvidence.filter((ev) => ev.tag !== blocked.tag);
      ruleAdjustments.push(`\u3010\u8AA4\u5224\u5B9A\u9664\u5916: #${blocked.tag}\u3011${blocked.reason}`);
    }
  }
  const hasIdolCandidate = workingTags.includes("\u30A2\u30A4\u30C9\u30EB") || workingGenre === "\u30A2\u30A4\u30C9\u30EB" || workingSubGenre === "\u30A2\u30A4\u30C9\u30EB";
  if (hasIdolCandidate) {
    const isAnimeWithoutIdolContext = (workingTags.includes("\u30A2\u30CB\u30BD\u30F3") || workingGenre === "\u30A2\u30CB\u30BD\u30F3" || precheck.enforcedPrimaryGenre === "\u30A2\u30CB\u30BD\u30F3") && !precheck.hasPositiveIdolSignal && !/アイドル|ラブライブ|アイマス|アイドルマスター|アイカツ|プリパラ|うたの☆プリンス|アイドリッシュセブン/i.test(
      `${input.title || ""} ${input.artist || ""} ${input.notes || ""} ${combinedAiText}`
    );
    const hasSSWOrRockTagContradiction = (workingTags.includes("\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC") || workingSubGenre === "\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC" || workingTags.includes("\u30D5\u30A9\u30FC\u30AF") || workingTags.includes("\u30CF\u30FC\u30C9\u30ED\u30C3\u30AF") || workingTags.includes("\u30D1\u30F3\u30AF") || workingTags.includes("\u30B8\u30E3\u30BA") || workingTags.includes("\u30AF\u30E9\u30B7\u30C3\u30AF") || workingTags.includes("\u6F14\u6B4C")) && !precheck.hasPositiveIdolSignal;
    const lacksAnyIdolCorroboration = !precheck.hasPositiveIdolSignal && (!aiExplicitlyConfirmsIdol || aiMentionsNonIdolRole);
    if (aiMentionsNonIdolRole || isAnimeWithoutIdolContext || hasSSWOrRockTagContradiction || lacksAnyIdolCorroboration) {
      workingTags = workingTags.filter((t) => t !== "\u30A2\u30A4\u30C9\u30EB");
      workingEvidence = workingEvidence.filter((ev) => ev.tag !== "\u30A2\u30A4\u30C9\u30EB");
      if (workingGenre === "\u30A2\u30A4\u30C9\u30EB") workingGenre = "";
      if (workingSubGenre === "\u30A2\u30A4\u30C9\u30EB") workingSubGenre = void 0;
      blockedTagNames.add("\u30A2\u30A4\u30C9\u30EB");
      const reasonDetail = aiMentionsNonIdolRole ? "\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u306E\u6D3B\u52D5\u5F62\u614B\uFF08\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\uFF0F\u30D0\u30F3\u30C9\uFF0F\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u7B49\uFF09\u3068\u77DB\u76FE\u3059\u308B\u305F\u3081" : isAnimeWithoutIdolContext ? "\u30A2\u30CB\u30BD\u30F3\uFF0F\u58F0\u512A\u30BF\u30A4\u30A2\u30C3\u30D7\u4F5C\u54C1\u3067\u3042\u308A\u30A2\u30A4\u30C9\u30EB\u4F5C\u54C1\u306E\u88CF\u4ED8\u3051\u30E1\u30BF\u30C7\u30FC\u30BF\u304C\u306A\u3044\u305F\u3081" : hasSSWOrRockTagContradiction ? "\u5171\u5B58\u3067\u304D\u306A\u3044\u5C02\u9580\u30B8\u30E3\u30F3\u30EB\uFF08\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC\uFF0F\u30D5\u30A9\u30FC\u30AF\uFF0F\u30ED\u30C3\u30AF\u7B49\uFF09\u304C\u691C\u51FA\u3055\u308C\u305F\u305F\u3081" : "\u30EC\u30FC\u30D9\u30EB\u30FB\u898F\u683C\u54C1\u756A\u30FB\u5099\u8003\u30FB\u5E74\u4EE3\u76E4\u7A2E\u306B\u30A2\u30A4\u30C9\u30EB\u3092\u793A\u3059\u88CF\u4ED8\u3051\u30E1\u30BF\u30C7\u30FC\u30BF\u304C\u5B58\u5728\u3057\u306A\u3044\u305F\u3081";
      ruleAdjustments.push(`\u3010\u8AA4\u5224\u5B9A\u9664\u5916: #\u30A2\u30A4\u30C9\u30EB\u3011${reasonDetail}\u3001\u300C\u30A2\u30A4\u30C9\u30EB\u300D\u30BF\u30B0\u3092\u9664\u5916\u3057\u307E\u3057\u305F`);
    }
  }
  const nonJPopSpecialistGenres = [
    "\u30AF\u30E9\u30B7\u30C3\u30AF",
    "\u30B8\u30E3\u30BA",
    "\u30D5\u30E5\u30FC\u30B8\u30E7\u30F3",
    "\u6F14\u6B4C",
    "\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF",
    "\u30B2\u30FC\u30E0\u97F3\u697D",
    "\u304A\u7B11\u3044\u30FB\u30D0\u30E9\u30A8\u30C6\u30A3",
    "\u6D0B\u697D"
  ];
  const hasNonJPopSpecialist = workingTags.some((t) => nonJPopSpecialistGenres.includes(t)) || nonJPopSpecialistGenres.includes(workingGenre) || precheck.enforcedPrimaryGenre && nonJPopSpecialistGenres.includes(precheck.enforcedPrimaryGenre);
  if (hasNonJPopSpecialist && (workingTags.includes("J-Pop") || workingGenre === "J-Pop")) {
    workingTags = workingTags.filter((t) => t !== "J-Pop");
    workingEvidence = workingEvidence.filter((ev) => ev.tag !== "J-Pop");
    if (workingGenre === "J-Pop") workingGenre = "";
    blockedTagNames.add("J-Pop");
    ruleAdjustments.push(
      `\u3010\u8AA4\u5224\u5B9A\u9664\u5916: #J-Pop\u3011\u5C02\u9580\u30B8\u30E3\u30F3\u30EB\uFF08${precheck.enforcedPrimaryGenre || workingGenre || "\u975E\u30DD\u30C3\u30D7\u30B9\u7CFB"}\uFF09\u306E\u30E1\u30BF\u30C7\u30FC\u30BF\uFF08\u898F\u683C\u54C1\u756A\u30FB\u30EC\u30FC\u30D9\u30EB\u30FB\u30BF\u30A4\u30C8\u30EB\u69CB\u9020\uFF09\u3068\u7AF6\u5408\u3059\u308B\u305F\u3081\u300CJ-Pop\u300D\u3092\u9664\u5916\u3057\u307E\u3057\u305F`
    );
  }
  const pre1988SpecificGenres = [
    "\u662D\u548C\u6B4C\u8B21",
    "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF",
    "\u30D5\u30A9\u30FC\u30AF",
    "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7",
    "\u30A2\u30A4\u30C9\u30EB",
    "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7",
    "\u30ED\u30C3\u30AF",
    "AOR"
  ];
  if (precheck.isPreJPopEra && (workingTags.includes("J-Pop") || workingGenre === "J-Pop")) {
    const matchedHistoricalGenre = precheck.enforcedPrimaryGenre || workingTags.find((t) => pre1988SpecificGenres.includes(t)) || (pre1988SpecificGenres.includes(workingGenre) ? workingGenre : "");
    if (matchedHistoricalGenre && matchedHistoricalGenre !== "J-Pop") {
      if (workingGenre === "J-Pop") {
        workingGenre = matchedHistoricalGenre;
      }
      if (precheck.isEarlyPreJPopEra && ["\u662D\u548C\u6B4C\u8B21", "\u30D5\u30A9\u30FC\u30AF", "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF", "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7", "\u30A2\u30A4\u30C9\u30EB", "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7"].includes(
        matchedHistoricalGenre
      )) {
        workingTags = workingTags.filter((t) => t !== "J-Pop");
        workingEvidence = workingEvidence.filter((ev) => ev.tag !== "J-Pop");
        if (!workingTags.includes(matchedHistoricalGenre)) {
          workingTags.push(matchedHistoricalGenre);
        }
        ruleAdjustments.push(
          `\u3010\u6642\u4EE3\u6574\u5408\u6027\u30D5\u30A3\u30EB\u30BF\u30FC: #J-Pop \u2192 #${matchedHistoricalGenre}\u3011\u30EA\u30EA\u30FC\u30B9\u5E74\uFF08${precheck.effectiveYear}\u5E74\u30FB${precheck.effectiveDateSource}\uFF09\u306F\u300CJ-Pop\u300D\u547C\u79F0\u5B9A\u7740\uFF081988\u5E74\uFF09\u4EE5\u524D\u306E\u305F\u3081\u3001\u300C${matchedHistoricalGenre}\u300D\u3092\u512A\u5148\u3057\u300CJ-Pop\u300D\u3092\u9664\u5916\u3057\u307E\u3057\u305F`
        );
      }
    } else if (precheck.isEarlyPreJPopEra && !precheck.isWesternOrigin) {
      const fallbackHistoricalGenre = precheck.effectiveYear && precheck.effectiveYear <= 1973 ? "\u662D\u548C\u6B4C\u8B21" : input.vinylRecordFormat && /^(EP|7")$/i.test(input.vinylRecordFormat) ? "\u662D\u548C\u6B4C\u8B21" : "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF";
      workingTags = workingTags.map((t) => t === "J-Pop" ? fallbackHistoricalGenre : t);
      workingEvidence = workingEvidence.filter((ev) => ev.tag !== "J-Pop");
      if (workingGenre === "J-Pop" || !workingGenre) {
        workingGenre = fallbackHistoricalGenre;
      }
      workingEvidence.push({
        tag: fallbackHistoricalGenre,
        category: "genre",
        evidence: `\u30EA\u30EA\u30FC\u30B9\u5E74\uFF08${precheck.effectiveYear}\u5E74\u30FB${precheck.effectiveDateSource}\uFF09\u304A\u3088\u3073\u76E4\u7A2E\u30FB\u30EC\u30FC\u30D9\u30EB\u60C5\u5831\u306E\u6642\u4EE3\u6574\u5408\u6027\u30EB\u30FC\u30EB\u306B\u57FA\u3065\u304D\u30011988\u5E74\u4EE5\u524D\u306E\u90A6\u697D\u4F5C\u54C1\u3068\u3057\u3066\u300C${fallbackHistoricalGenre}\u300D\u306B\u5206\u985E`,
        sourceFields: [precheck.effectiveDateSource, "\u30EC\u30FC\u30D9\u30EB"]
      });
      ruleAdjustments.push(
        `\u3010\u6642\u4EE3\u6574\u5408\u6027\u30D5\u30A3\u30EB\u30BF\u30FC: #J-Pop \u2192 #${fallbackHistoricalGenre}\u3011${precheck.effectiveYear}\u5E74\uFF08${precheck.effectiveDateSource}\uFF09\u306E\u6642\u4EE3\u533A\u5206\u306B\u57FA\u3065\u304D\u300C${fallbackHistoricalGenre}\u300D\u3078\u88DC\u6B63\u3057\u307E\u3057\u305F`
      );
    }
  }
  for (const enf of precheck.enforcedTags) {
    if (blockedTagNames.has(enf.tag)) continue;
    if (!workingTags.includes(enf.tag)) {
      workingTags.push(enf.tag);
      ruleAdjustments.push(`\u3010\u30E1\u30BF\u30C7\u30FC\u30BF\u81EA\u52D5\u691C\u51FA: #${enf.tag}\u3011${enf.evidence}`);
    }
    if (!workingEvidence.some((ev) => ev.tag === enf.tag)) {
      workingEvidence.push({
        tag: enf.tag,
        category: enf.category,
        evidence: enf.evidence,
        sourceFields: enf.sourceFields
      });
    }
  }
  if (precheck.enforcedPrimaryGenre && !blockedTagNames.has(precheck.enforcedPrimaryGenre)) {
    workingGenre = precheck.enforcedPrimaryGenre;
    if (!workingTags.includes(workingGenre)) {
      workingTags.unshift(workingGenre);
    }
  }
  if (!workingGenre || blockedTagNames.has(workingGenre) || !workingTags.includes(workingGenre)) {
    const primaryGenreCandidate = workingTags.find(
      (t) => !DECADE_TAG_REGEX.test(t) && !["\u90A6\u697D", "\u6D0B\u697D", "\u30D9\u30B9\u30C8\u76E4", "\u30E9\u30A4\u30D6\u76E4", "CM\u30BD\u30F3\u30B0"].includes(t)
    );
    if (primaryGenreCandidate) {
      workingGenre = primaryGenreCandidate;
    } else if (precheck.isWesternOrigin) {
      workingGenre = "\u6D0B\u697D";
      if (!workingTags.includes("\u6D0B\u697D")) workingTags.push("\u6D0B\u697D");
    } else if (precheck.isEarlyPreJPopEra) {
      workingGenre = "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF";
      if (!workingTags.includes("\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF")) workingTags.push("\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF");
    } else {
      workingGenre = "J-Pop";
      if (!workingTags.includes("J-Pop")) workingTags.push("J-Pop");
    }
  }
  if (precheck.isWesternOrigin) {
    workingTags = workingTags.filter((t) => t !== "\u90A6\u697D");
    if (!workingTags.includes("\u6D0B\u697D")) workingTags.push("\u6D0B\u697D");
  }
  if (!workingEvidence.some((ev) => ev.tag === workingGenre)) {
    const activeSources = ["\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D"];
    if (input.label) activeSources.push("\u30EC\u30FC\u30D9\u30EB");
    if (input.catalogNumber) activeSources.push("\u898F\u683C\u54C1\u756A");
    if (input.vinylRecordReleaseDate) activeSources.push("LP/EP\u767A\u58F2\u5E74\u6708\u65E5");
    else if (input.releaseDate) activeSources.push("CD\u767A\u58F2\u5E74\u6708\u65E5");
    workingEvidence.push({
      tag: workingGenre,
      category: "genre",
      evidence: `\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u300C${input.artist || "\u4E0D\u660E"}\u300D\u30FB\u30BF\u30A4\u30C8\u30EB\u300C${input.title || ""}\u300D${input.label ? `\u30FB\u30EC\u30FC\u30D9\u30EB\uFF08${input.label}\uFF09` : ""}${input.catalogNumber ? `\u30FB\u898F\u683C\u54C1\u756A\uFF08${input.catalogNumber}\uFF09` : ""}\u306E\u8907\u5408\u30E1\u30BF\u30C7\u30FC\u30BF\u691C\u8A3C\u306B\u3088\u308A\u300C${workingGenre}\u300D\u3068\u5224\u5B9A`,
      sourceFields: activeSources
    });
  }
  const finalTags = Array.from(new Set(workingTags.filter(Boolean)));
  const finalEvidence = workingEvidence.filter((ev) => finalTags.includes(ev.tag));
  return {
    genre: workingGenre,
    subGenre: workingSubGenre && finalTags.includes(workingSubGenre) ? workingSubGenre : void 0,
    suggestedTags: finalTags,
    tagEvidence: finalEvidence,
    ruleAdjustments
  };
}

// server/aiTagging.ts
function deriveEraTagFromDate(dateStr) {
  if (!dateStr) return "";
  const match = String(dateStr).trim().match(/(\d{4})/);
  if (!match) return "";
  const y = parseInt(match[1], 10);
  if (isNaN(y)) return "";
  if (y >= 1950 && y < 1960) return "1950\u5E74\u4EE3";
  if (y >= 1960 && y < 1970) return "1960\u5E74\u4EE3";
  if (y >= 1970 && y < 1980) return "1970\u5E74\u4EE3";
  if (y >= 1980 && y < 1990) return "1980\u5E74\u4EE3";
  if (y >= 1990 && y < 2e3) return "1990\u5E74\u4EE3";
  if (y >= 2e3 && y < 2010) return "2000\u5E74\u4EE3";
  if (y >= 2010 && y < 2020) return "2010\u5E74\u4EE3";
  if (y >= 2020) return "2020\u5E74\u4EE3";
  return "";
}
var DECADE_TAG_REGEX2 = /^(19\d0|20\d0|[56789]0)年代$/;
var SERVER_TAG_CANONICAL_MAP = {
  "j-pop": "J-Pop",
  "jpop": "J-Pop",
  "j pop": "J-Pop",
  "j-pop / \u90A6\u697D": "J-Pop",
  "j-pop/\u90A6\u697D": "J-Pop",
  "\u90A6\u697D / j-pop": "J-Pop",
  "\u30DD\u30C3\u30D7\u30B9": "J-Pop",
  "\u30DD\u30C3\u30D7": "J-Pop",
  "pop": "J-Pop",
  "pops": "J-Pop",
  "aidol": "\u30A2\u30A4\u30C9\u30EB",
  "idol": "\u30A2\u30A4\u30C9\u30EB",
  "idol pop": "\u30A2\u30A4\u30C9\u30EB",
  "\u30A2\u30A4\u30C9\u30EB\u6B4C\u8B21": "\u30A2\u30A4\u30C9\u30EB",
  "\u5973\u6027\u30A2\u30A4\u30C9\u30EB": "\u30A2\u30A4\u30C9\u30EB",
  "anime": "\u30A2\u30CB\u30BD\u30F3",
  "anison": "\u30A2\u30CB\u30BD\u30F3",
  "anime song": "\u30A2\u30CB\u30BD\u30F3",
  "\u30A2\u30CB\u30E1": "\u30A2\u30CB\u30BD\u30F3",
  "\u30A2\u30CB\u30E1\u30BD\u30F3\u30B0": "\u30A2\u30CB\u30BD\u30F3",
  "cm-song": "CM\u30BD\u30F3\u30B0",
  "cm song": "CM\u30BD\u30F3\u30B0",
  "cmsong": "CM\u30BD\u30F3\u30B0",
  "cm\u66F2": "CM\u30BD\u30F3\u30B0",
  "new music": "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF",
  "\u30CB\u30E5\u30FC\u30FB\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF": "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF",
  "folk": "\u30D5\u30A9\u30FC\u30AF",
  "\u30D5\u30A9\u30FC\u30AF\u30BD\u30F3\u30B0": "\u30D5\u30A9\u30FC\u30AF",
  "city pop": "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7",
  "citypop": "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7",
  "\u30B7\u30C6\u30A3\u30FB\u30DD\u30C3\u30D7": "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7",
  "kayokyoku": "\u662D\u548C\u6B4C\u8B21",
  "\u6B4C\u8B21\u66F2": "\u662D\u548C\u6B4C\u8B21",
  "ssw": "\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC",
  "singer-songwriter": "\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC",
  "\u30B7\u30F3\u30AC\u30FC\u30FB\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC": "\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC",
  "rock": "\u30ED\u30C3\u30AF",
  "j-rock": "\u30ED\u30C3\u30AF",
  "hard rock": "\u30CF\u30FC\u30C9\u30ED\u30C3\u30AF",
  "jazz": "\u30B8\u30E3\u30BA",
  "classical": "\u30AF\u30E9\u30B7\u30C3\u30AF",
  "classic": "\u30AF\u30E9\u30B7\u30C3\u30AF",
  "r&b": "R&B",
  "hip-hop": "\u30D2\u30C3\u30D7\u30DB\u30C3\u30D7",
  "hip hop": "\u30D2\u30C3\u30D7\u30DB\u30C3\u30D7",
  "techno": "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7",
  "techno pop": "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7",
  "synth-pop": "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7",
  "ballad": "\u30D0\u30E9\u30FC\u30C9",
  "acoustic": "\u30A2\u30B3\u30FC\u30B9\u30C6\u30A3\u30C3\u30AF",
  "best": "\u30D9\u30B9\u30C8\u76E4",
  "\u30D9\u30B9\u30C8": "\u30D9\u30B9\u30C8\u76E4",
  "\u30D9\u30B9\u30C8\u30FB\u30A2\u30EB\u30D0\u30E0": "\u30D9\u30B9\u30C8\u76E4",
  "\u30D9\u30B9\u30C8\u30A2\u30EB\u30D0\u30E0": "\u30D9\u30B9\u30C8\u76E4",
  "live": "\u30E9\u30A4\u30D6\u76E4",
  "\u30E9\u30A4\u30D6": "\u30E9\u30A4\u30D6\u76E4",
  "\u30E9\u30A4\u30D6\u30FB\u30A2\u30EB\u30D0\u30E0": "\u30E9\u30A4\u30D6\u76E4",
  "\u30E9\u30A4\u30D6\u30A2\u30EB\u30D0\u30E0": "\u30E9\u30A4\u30D6\u76E4",
  "comedy": "\u304A\u7B11\u3044\u30FB\u30D0\u30E9\u30A8\u30C6\u30A3",
  "\u304A\u7B11\u3044": "\u304A\u7B11\u3044\u30FB\u30D0\u30E9\u30A8\u30C6\u30A3"
};
function normalizeServerTag(raw) {
  if (!raw) return "";
  let t = String(raw).trim().replace(/^#+/, "").trim();
  if (!t) return "";
  t = t.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 65248));
  const decade2Digit = t.match(/^([56789]0)年代$/);
  if (decade2Digit) return `19${decade2Digit[1]}\u5E74\u4EE3`;
  const decade19xx = t.match(/^19([56789]0)年代$/);
  if (decade19xx) return `19${decade19xx[1]}\u5E74\u4EE3`;
  const decadeEn = t.match(/^(?:19)?([56789]0)'?s$/i);
  if (decadeEn) return `19${decadeEn[1]}\u5E74\u4EE3`;
  const lower = t.toLowerCase().replace(/\s+/g, " ");
  if (SERVER_TAG_CANONICAL_MAP[lower]) return SERVER_TAG_CANONICAL_MAP[lower];
  return t;
}
function normalizeServerTagList(tags) {
  if (!tags || !Array.isArray(tags)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of tags) {
    if (!raw) continue;
    const trimmed = String(raw).trim();
    const lower = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (lower.includes("j-pop") && lower.includes("\u90A6\u697D")) {
      for (const sub of ["J-Pop", "\u90A6\u697D"]) {
        if (!seen.has(sub)) {
          seen.add(sub);
          out.push(sub);
        }
      }
      continue;
    }
    if (trimmed.includes(" / ") || trimmed.includes("\uFF0F")) {
      for (const part of trimmed.split(/\s*[/／]\s*/)) {
        const norm2 = normalizeServerTag(part);
        if (norm2 && !seen.has(norm2)) {
          seen.add(norm2);
          out.push(norm2);
        }
      }
      continue;
    }
    const norm = normalizeServerTag(trimmed);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
async function analyzeCDTagsWithGemini(cds, options = {}) {
  if (!cds || cds.length === 0) return [];
  const CHUNK_SIZE = 4;
  const allResults = [];
  const ai = createGeminiClient();
  for (let i = 0; i < cds.length; i += CHUNK_SIZE) {
    const chunk = cds.slice(i, i + CHUNK_SIZE);
    const simplifiedChunk = chunk.map((cd) => {
      const hasVinylDate = Boolean(cd.vinylRecordReleaseDate && cd.vinylRecordReleaseDate.trim());
      const hasCdDate = Boolean(cd.releaseDate && cd.releaseDate.trim());
      const effectiveDateForEra = hasVinylDate ? cd.vinylRecordReleaseDate.trim() : (cd.releaseDate || "").trim();
      const effectiveDateSource = hasVinylDate && hasCdDate ? "LP/EP\u767A\u58F2\u5E74\u6708\u65E5 (CD\u767A\u58F2\u5E74\u6708\u65E5\u3088\u308A\u3082\u512A\u5148)" : hasVinylDate ? "LP/EP\u767A\u58F2\u5E74\u6708\u65E5" : "CD\u767A\u58F2\u5E74\u6708\u65E5";
      const precheck = runGenreRulePrecheck({
        id: cd.id,
        title: cd.title,
        artist: cd.artist,
        catalogNumber: cd.catalogNumber,
        label: cd.label,
        releaseDate: cd.releaseDate,
        vinylRecordReleaseDate: cd.vinylRecordReleaseDate,
        vinylRecordFormat: cd.vinylRecordFormat,
        vinylRecordCatalogNumber: cd.vinylRecordCatalogNumber,
        barcode: cd.barcode,
        country: cd.country,
        format: cd.format,
        tracks: cd.tracks,
        genre: cd.genre,
        existingTags: cd.existingTags,
        notes: cd.notes
      });
      return {
        id: cd.id,
        title: cd.title,
        artist: cd.artist,
        catalogNumber: cd.catalogNumber || "",
        label: cd.label || "",
        barcode: cd.barcode || "",
        country: cd.country || "JP",
        format: cd.format || "CD",
        cdReleaseDate: cd.releaseDate || "",
        vinylRecordReleaseDate: cd.vinylRecordReleaseDate || "",
        vinylRecordFormat: cd.vinylRecordFormat || "",
        vinylRecordCatalogNumber: cd.vinylRecordCatalogNumber || "",
        effectiveReleaseDateForEraTag: effectiveDateForEra,
        effectiveDateSourceForEraTag: effectiveDateSource,
        requiredEraTag: deriveEraTagFromDate(effectiveDateForEra),
        trackCount: cd.tracks ? cd.tracks.length : 0,
        trackDurationStats: precheck.trackDurationStats,
        trackListSample: (cd.tracks || []).slice(0, 10).map((t) => t.duration ? `${t.title} (${t.duration})` : t.title).join(", "),
        existingGenre: cd.genre || "",
        existingTags: cd.existingTags || [],
        notes: cd.notes || "",
        ruleBasedFilterHints: {
          enforcedPrimaryGenre: precheck.enforcedPrimaryGenre || null,
          enforcedTags: precheck.enforcedTags.map((e) => e.tag),
          blockedTags: precheck.blockedTags.map((b) => ({ tag: b.tag, reason: b.reason })),
          isPreJPopEra: precheck.isPreJPopEra,
          isWesternOrigin: precheck.isWesternOrigin,
          hasPositiveIdolSignal: precheck.hasPositiveIdolSignal
        }
      };
    });
    const prompt = `
You are an expert Japanese and international music archivist, record store curator, and discographer.
Analyze the following CD albums to classify their musical genre, mood/atmosphere, release era/decade, and produce 3 to 5 concise, standardized Japanese tags for music collection management.
Crucially, you must explicitly provide the objective/analytical BASIS (\u6839\u62E0) for why each tag was selected based on the input metadata.

CRITICAL ERA TAG RULE (\u5E74\u4EE3\u30BF\u30B0\u751F\u6210\u306E\u6700\u512A\u5148\u30EB\u30FC\u30EB):
- If an album has BOTH "cdReleaseDate" (CD\u767A\u58F2\u5E74\u6708\u65E5) and "vinylRecordReleaseDate" (\u540C\u30BF\u30A4\u30C8\u30EBLP/EP\u767A\u58F2\u5E74\u6708\u65E5) \u2014 or whenever "vinylRecordReleaseDate" is present \u2014 you MUST generate the era/decade tag ("era" and the decade tag inside "suggestedTags") from "vinylRecordReleaseDate" (i.e. "effectiveReleaseDateForEraTag" / "requiredEraTag"), NOT from "cdReleaseDate".
- Only use "cdReleaseDate" for the era tag when "vinylRecordReleaseDate" is empty.

CRITICAL MULTI-METADATA RULE-BASED GENRE FILTER (\u8AA4\u5224\u5B9A\u9632\u6B62\u30FB\u591A\u91CD\u30E1\u30BF\u30C7\u30FC\u30BF\u691C\u8A3C\u30EB\u30FC\u30EB):
Do NOT classify genres (especially "\u30A2\u30A4\u30C9\u30EB" and "J-Pop") based solely on artist names or cute-sounding song titles! You MUST inspect all metadata fields ("catalogNumber", "label", "vinylRecordReleaseDate", "cdReleaseDate", "vinylRecordFormat", "barcode", "country", "format", "trackDurationStats", "notes", and "ruleBasedFilterHints"):
1. RESPECT "ruleBasedFilterHints.blockedTags": Never output any tag listed in "blockedTags" for that CD.
2. RESPECT "ruleBasedFilterHints.enforcedPrimaryGenre" & "enforcedTags": Include any "enforcedTags" and use "enforcedPrimaryGenre" when provided.
3. STRICT "\u30A2\u30A4\u30C9\u30EB" VERIFICATION:
   - NEVER assign "\u30A2\u30A4\u30C9\u30EB" to Singer-Songwriters (\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC), New Music (\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF), City Pop (\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7), Folk (\u30D5\u30A9\u30FC\u30AF), Rock bands (\u30ED\u30C3\u30AF), R&B vocalists, Voice Actor/Anime releases without idol context, Jazz, Classical, or Enka artists.
   - Only assign "\u30A2\u30A4\u30C9\u30EB" when corroborated by label (e.g. Johnny's, J Storm, AKS, N46Div, Up-Front, 70s/80s Idol labels), notes, catalog number, or verified idol group/solo idol career.
4. STRICT "J-Pop" VERIFICATION:
   - NEVER assign "J-Pop" to Classical (UCCG/SICC/DG/Decca), Jazz/Fusion (UCCU/TOCJ/Blue Note/Verve), Western Music (\u6D0B\u697D: non-JP barcode/country or UICY/SICP/WPCR international catalog prefix), Soundtracks (\u5287\u4F34/\u30B5\u30F3\u30C8\u30E9), or Enka.
   - For pre-1988 releases ("isPreJPopEra": true, released before the term J-Pop was coined in 1988), prioritize period-accurate genres ("\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF", "\u662D\u548C\u6B4C\u8B21", "\u30D5\u30A9\u30FC\u30AF", "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7", "\u30A2\u30A4\u30C9\u30EB", "\u30ED\u30C3\u30AF", "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7") over "J-Pop".

Options requested:
- Include Musical Genre/Sub-genre: ${options.includeGenre !== false ? "Yes" : "No"}
- Include Mood/Atmosphere (\u96F0\u56F2\u6C17): ${options.includeMood !== false ? "Yes" : "No"}
- Include Era/Decade (\u30EA\u30EA\u30FC\u30B9\u5E74\u4EE3): ${options.includeEra !== false ? "Yes" : "No"}
- Maximum tags per album: ${options.maxTagsPerCD || 5}

CDs to analyze:
${JSON.stringify(simplifiedChunk, null, 2)}

Instructions & STRICT TAG UNIFICATION RULES (\u8868\u8A18\u3086\u308C\u9632\u6B62\u30FB\u30BF\u30B0\u7D71\u4E00\u30EB\u30FC\u30EB):
1. NEVER use English/Romaji spelling variants or slash-combined tags. Always use these unified Japanese canonical tags:
   - Use "J-Pop" (NEVER "J-POP", "Jpop", or "J-POP / \u90A6\u697D")
   - Use "\u90A6\u697D" or "\u6D0B\u697D" as separate single tags (NEVER combine with "/" like "J-Pop / \u90A6\u697D")
   - Use "\u30A2\u30A4\u30C9\u30EB" (NEVER "Aidol" or "Idol")
   - Use "\u30A2\u30CB\u30BD\u30F3" (NEVER "Anime", "\u30A2\u30CB\u30E1", or "\u30A2\u30CB\u30E1\u30BD\u30F3\u30B0")
   - Use "CM\u30BD\u30F3\u30B0" (NEVER "CM-Song" or "CM\u66F2")
   - Use "\u30B7\u30F3\u30AC\u30FC\u30BD\u30F3\u30B0\u30E9\u30A4\u30BF\u30FC", "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF", "\u30D5\u30A9\u30FC\u30AF", "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7", "\u662D\u548C\u6B4C\u8B21", "\u6F14\u6B4C", "\u30ED\u30C3\u30AF", "\u30CF\u30FC\u30C9\u30ED\u30C3\u30AF", "\u30D1\u30F3\u30AF", "\u30B8\u30E3\u30BA", "\u30D5\u30E5\u30FC\u30B8\u30E7\u30F3", "\u30AF\u30E9\u30B7\u30C3\u30AF", "R&B", "\u30D2\u30C3\u30D7\u30DB\u30C3\u30D7", "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7", "AOR", "\u30D0\u30E9\u30FC\u30C9", "\u30A2\u30B3\u30FC\u30B9\u30C6\u30A3\u30C3\u30AF", "\u30B5\u30A6\u30F3\u30C9\u30C8\u30E9\u30C3\u30AF", "\u30B2\u30FC\u30E0\u97F3\u697D", "\u30D9\u30B9\u30C8\u76E4", "\u30E9\u30A4\u30D6\u76E4", "\u304A\u7B11\u3044\u30FB\u30D0\u30E9\u30A8\u30C6\u30A3"
   - Era tags MUST be strictly one of: "1950\u5E74\u4EE3", "1960\u5E74\u4EE3", "1970\u5E74\u4EE3", "1980\u5E74\u4EE3", "1990\u5E74\u4EE3", "2000\u5E74\u4EE3", "2010\u5E74\u4EE3", "2020\u5E74\u4EE3" (NEVER "70\u5E74\u4EE3", "80\u5E74\u4EE3", "90\u5E74\u4EE3", or "80s").
2. "genre": The primary music genre using ONLY a single unified canonical name from rule 1.
3. "subGenre": Sub-genre or musical style using unified Japanese terms.
4. "mood": Atmosphere & emotional feel keywords in Japanese (e.g., "\u723D\u5FEB\u30FB\u75BE\u8D70\u611F", "\u5207\u306A\u3044\u30FB\u54C0\u6101", "\u30E1\u30ED\u30A6\u30FB\u30C1\u30EB", "\u30A8\u30E2\u30FC\u30B7\u30E7\u30CA\u30EB", "\u53D9\u60C5\u7684\u30FB\u512A\u3057\u3055", "\u30C0\u30F3\u30B5\u30D6\u30EB").
5. "era": Era/decade classification derived strictly from "effectiveReleaseDateForEraTag" ("vinylRecordReleaseDate" when present, otherwise "cdReleaseDate").
6. "suggestedTags": Array of 3 to 5 concise, unified Japanese tags following Rule 1 and the Multi-Metadata Rule-Based Genre Filter.
7. "reasoning": A clear 1-2 sentence Japanese explanation summarizing the overall musical characteristics and citing the metadata used (label, catalog prefix, LP/EP release date, track durations, notes, etc.).
8. "tagEvidence": An array corresponding to each tag in "suggestedTags", explaining the concrete basis (\u6839\u62E0):
   - "tag": The exact unified tag string matching "suggestedTags".
   - "category": One of "genre" | "mood" | "era" | "style".
   - "evidence": Specific Japanese explanation of why this tag was chosen.
   - "sourceFields": Array of input fields used as evidence in Japanese (e.g., ["LP/EP\u767A\u58F2\u5E74\u6708\u65E5"], ["\u898F\u683C\u54C1\u756A", "\u30EC\u30FC\u30D9\u30EB"], ["\u53CE\u9332\u66F2\u6570\u30FB\u6F14\u594F\u6642\u9593"], ["\u30BF\u30A4\u30C8\u30EB", "\u5099\u8003"], ["\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D", "\u53CE\u9332\u66F2\u30EA\u30B9\u30C8"]).

Return ONLY a valid JSON object matching this schema with no markdown backticks:
{
  "results": [
    {
      "id": "cd id string",
      "genre": "...",
      "subGenre": "...",
      "mood": "...",
      "era": "...",
      "suggestedTags": ["tag1", "tag2", "tag3"],
      "reasoning": "...",
      "tagEvidence": [
        {
          "tag": "tag1",
          "category": "genre",
          "evidence": "...",
          "sourceFields": ["\u898F\u683C\u54C1\u756A", "\u30EC\u30FC\u30D9\u30EB"]
        }
      ]
    }
  ]
}
`;
    try {
      const response = await generateContentWithFallback(ai, {
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        },
        preferredModel: "gemini-3.8-flash",
        timeoutMs: 13e3
      });
      const text = response.text || "";
      let cleanJson = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
      }
      const parsed = JSON.parse(cleanJson);
      if (parsed && Array.isArray(parsed.results) && parsed.results.length > 0) {
        for (const item of parsed.results) {
          const origCd = chunk.find((c) => c.id === item.id);
          const rawNormalizedGenre = normalizeServerTag(item.genre);
          const rawNormalizedSubGenre = item.subGenre ? normalizeServerTag(item.subGenre) : void 0;
          const rawNormalizedTags = normalizeServerTagList(item.suggestedTags);
          let normalizedEvList = [];
          if (Array.isArray(item.tagEvidence)) {
            const seenEv = /* @__PURE__ */ new Set();
            normalizedEvList = item.tagEvidence.map((ev) => ({
              ...ev,
              tag: normalizeServerTag(ev.tag)
            })).filter((ev) => {
              if (!ev.tag || seenEv.has(ev.tag)) return false;
              seenEv.add(ev.tag);
              return true;
            });
          }
          if (origCd) {
            const ruleFiltered = applyGenreRuleFilter(
              {
                id: origCd.id,
                title: origCd.title,
                artist: origCd.artist,
                catalogNumber: origCd.catalogNumber,
                label: origCd.label,
                releaseDate: origCd.releaseDate,
                vinylRecordReleaseDate: origCd.vinylRecordReleaseDate,
                vinylRecordFormat: origCd.vinylRecordFormat,
                vinylRecordCatalogNumber: origCd.vinylRecordCatalogNumber,
                barcode: origCd.barcode,
                country: origCd.country,
                format: origCd.format,
                tracks: origCd.tracks,
                genre: origCd.genre,
                existingTags: origCd.existingTags,
                notes: origCd.notes
              },
              rawNormalizedTags,
              rawNormalizedGenre,
              rawNormalizedSubGenre,
              item.reasoning,
              normalizedEvList
            );
            item.genre = ruleFiltered.genre;
            item.subGenre = ruleFiltered.subGenre;
            item.suggestedTags = ruleFiltered.suggestedTags;
            item.tagEvidence = ruleFiltered.tagEvidence;
            item.ruleAdjustments = ruleFiltered.ruleAdjustments;
          } else {
            item.genre = rawNormalizedGenre || "J-Pop";
            item.subGenre = rawNormalizedSubGenre;
            item.suggestedTags = rawNormalizedTags;
            item.tagEvidence = normalizedEvList;
          }
          if (origCd && options.includeEra !== false) {
            const hasVinyl = Boolean(origCd.vinylRecordReleaseDate && origCd.vinylRecordReleaseDate.trim());
            const hasCd = Boolean(origCd.releaseDate && origCd.releaseDate.trim());
            const effectiveDate = hasVinyl ? origCd.vinylRecordReleaseDate.trim() : (origCd.releaseDate || "").trim();
            const expectedEra = deriveEraTagFromDate(effectiveDate);
            if (expectedEra) {
              item.era = expectedEra;
              const rawTags = Array.isArray(item.suggestedTags) ? item.suggestedTags : [];
              const filteredTags = rawTags.filter((t) => !DECADE_TAG_REGEX2.test(t) || t === expectedEra);
              if (!filteredTags.includes(expectedEra)) {
                filteredTags.unshift(expectedEra);
              }
              item.suggestedTags = filteredTags;
              const eraEvidenceText = hasVinyl && hasCd ? `CD\u767A\u58F2\u5E74\u6708\u65E5(${origCd.releaseDate})\u3068LP/EP\u767A\u58F2\u5E74\u6708\u65E5(${origCd.vinylRecordReleaseDate})\u306E\u4E21\u65B9\u306B\u30C7\u30FC\u30BF\u304C\u3042\u308B\u305F\u3081\u3001LP/EP\u767A\u58F2\u5E74\u6708\u65E5(${origCd.vinylRecordReleaseDate})\u304B\u3089\u300C${expectedEra}\u300D\u30BF\u30B0\u3092\u751F\u6210` : hasVinyl ? `\u540C\u30BF\u30A4\u30C8\u30EB\u306ELP/EP\u767A\u58F2\u5E74\u6708\u65E5(${origCd.vinylRecordReleaseDate})\u304B\u3089\u300C${expectedEra}\u300D\u30BF\u30B0\u3092\u751F\u6210` : `CD\u767A\u58F2\u5E74\u6708\u65E5(${origCd.releaseDate})\u304B\u3089\u300C${expectedEra}\u300D\u30BF\u30B0\u3092\u751F\u6210`;
              const eraSourceField = hasVinyl ? "LP/EP\u767A\u58F2\u5E74\u6708\u65E5" : "CD\u767A\u58F2\u5E74\u6708\u65E5";
              const existingEvList = Array.isArray(item.tagEvidence) ? item.tagEvidence : [];
              const cleanedEvList = existingEvList.filter(
                (ev) => ev.category !== "era" && !DECADE_TAG_REGEX2.test(ev.tag)
              );
              cleanedEvList.unshift({
                tag: expectedEra,
                category: "era",
                evidence: eraEvidenceText,
                sourceFields: [eraSourceField]
              });
              item.tagEvidence = cleanedEvList;
            }
          }
          allResults.push(item);
        }
      } else {
        throw new Error("Unexpected JSON structure from Gemini");
      }
    } catch (err) {
      console.error(`Error in Gemini AI tagging chunk ${i}:`, err);
      chunk.forEach((cd) => {
        const hasVinyl = Boolean(cd.vinylRecordReleaseDate && cd.vinylRecordReleaseDate.trim());
        const hasCd = Boolean(cd.releaseDate && cd.releaseDate.trim());
        const effectiveDate = hasVinyl ? cd.vinylRecordReleaseDate.trim() : (cd.releaseDate || "").trim();
        const era = options.includeEra !== false ? deriveEraTagFromDate(effectiveDate) : "";
        const eraEvidenceText = hasVinyl && hasCd ? `CD\u767A\u58F2\u5E74\u6708\u65E5(${cd.releaseDate})\u3068LP/EP\u767A\u58F2\u5E74\u6708\u65E5(${cd.vinylRecordReleaseDate})\u306E\u4E21\u65B9\u306B\u30C7\u30FC\u30BF\u304C\u3042\u308B\u305F\u3081\u3001LP/EP\u767A\u58F2\u5E74\u6708\u65E5(${cd.vinylRecordReleaseDate})\u304B\u3089\u300C${era}\u300D\u30BF\u30B0\u3092\u751F\u6210` : hasVinyl ? `\u540C\u30BF\u30A4\u30C8\u30EB\u306ELP/EP\u767A\u58F2\u5E74\u6708\u65E5(${cd.vinylRecordReleaseDate})\u304B\u3089\u300C${era}\u300D\u30BF\u30B0\u3092\u751F\u6210` : `CD\u767A\u58F2\u5E74\u6708\u65E5(${cd.releaseDate})\u304B\u3089\u300C${era}\u300D\u30BF\u30B0\u3092\u751F\u6210`;
        const initialGenre = normalizeServerTag(cd.genre);
        const initialTags = normalizeServerTagList(
          [era, initialGenre, ...cd.existingTags || [], "\u90A6\u697D"].filter(Boolean)
        );
        const ruleFiltered = applyGenreRuleFilter(
          {
            id: cd.id,
            title: cd.title,
            artist: cd.artist,
            catalogNumber: cd.catalogNumber,
            label: cd.label,
            releaseDate: cd.releaseDate,
            vinylRecordReleaseDate: cd.vinylRecordReleaseDate,
            vinylRecordFormat: cd.vinylRecordFormat,
            vinylRecordCatalogNumber: cd.vinylRecordCatalogNumber,
            barcode: cd.barcode,
            country: cd.country,
            format: cd.format,
            tracks: cd.tracks,
            genre: cd.genre,
            existingTags: cd.existingTags,
            notes: cd.notes
          },
          initialTags,
          initialGenre
        );
        const finalTags = era ? [era, ...ruleFiltered.suggestedTags.filter((t) => !DECADE_TAG_REGEX2.test(t))] : ruleFiltered.suggestedTags;
        allResults.push({
          id: cd.id,
          genre: ruleFiltered.genre,
          subGenre: ruleFiltered.subGenre,
          mood: "\u30DD\u30C3\u30D7\u30FB\u30E1\u30ED\u30C7\u30A3\u30A2\u30B9",
          era: era || (ruleFiltered.suggestedTags.includes("\u6D0B\u697D") ? "\u6D0B\u697D" : "\u90A6\u697D"),
          suggestedTags: finalTags,
          reasoning: `\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u300C${cd.artist}\u300D\u30FB\u30BF\u30A4\u30C8\u30EB\u300C${cd.title}\u300D${cd.label ? `\u30FB\u30EC\u30FC\u30D9\u30EB(${cd.label})` : ""}${cd.catalogNumber ? `\u30FB\u898F\u683C\u54C1\u756A(${cd.catalogNumber})` : ""}${hasVinyl ? `\u30FB\u540C\u30BF\u30A4\u30C8\u30EBLP/EP\u767A\u58F2\u65E5(${cd.vinylRecordReleaseDate}${hasCd ? ` \u203BCD\u767A\u58F2\u65E5:${cd.releaseDate}\u3088\u308A\u512A\u5148` : ""})` : hasCd ? `\u30FBCD\u767A\u58F2\u65E5(${cd.releaseDate})` : ""}\u306E\u8907\u5408\u30E1\u30BF\u30C7\u30FC\u30BF\u898F\u5247\u306B\u57FA\u3065\u304F\u5206\u985E`,
          tagEvidence: [
            ...era ? [
              {
                tag: era,
                category: "era",
                evidence: eraEvidenceText,
                sourceFields: [hasVinyl ? "LP/EP\u767A\u58F2\u5E74\u6708\u65E5" : "CD\u767A\u58F2\u5E74\u6708\u65E5"]
              }
            ] : [],
            ...ruleFiltered.tagEvidence.filter((ev) => !DECADE_TAG_REGEX2.test(ev.tag))
          ],
          ruleAdjustments: ruleFiltered.ruleAdjustments
        });
      });
    }
  }
  return allResults;
}

// server/aiBackfill.ts
import { GoogleGenAI as GoogleGenAI4 } from "@google/genai";
async function backfillCDMetadataWithGemini(cds) {
  if (!cds || cds.length === 0) return [];
  const ai = new GoogleGenAI4();
  const CHUNK_SIZE = 6;
  const results = [];
  for (let i = 0; i < cds.length; i += CHUNK_SIZE) {
    const chunk = cds.slice(i, i + CHUNK_SIZE);
    const promptData = chunk.map((cd) => ({
      id: cd.id,
      title: cd.title,
      currentArtist: cd.artist || "",
      currentCatalogNumber: cd.catalogNumber || "",
      currentLabel: cd.label || "",
      currentReleaseDate: cd.releaseDate || "",
      currentGenre: cd.genre || "",
      currentTrackCount: cd.tracks ? cd.tracks.length : 0,
      existingTracksSample: (cd.tracks || []).slice(0, 5).map((t) => t.title).join(", "),
      notes: cd.notes || ""
    }));
    const systemInstruction = `\u3042\u306A\u305F\u306FCD\u30E1\u30BF\u30C7\u30FC\u30BF\uFF08\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D\u3001\u767A\u58F2\u65E5\u3001\u30EC\u30FC\u30D9\u30EB\u3001\u898F\u683C\u54C1\u756A\u3001\u53CE\u9332\u66F2\u306A\u3069\uFF09\u3092\u30AA\u30F3\u30E9\u30A4\u30F3\u306E\u516C\u7684\u97F3\u697D\u30C7\u30FC\u30BF\u30D9\u30FC\u30B9\u77E5\u8B58\uFF08\u56FD\u4F1A\u56F3\u66F8\u9928NDL\u3001MusicBrainz\u3001Discogs\u3001iTunes Japan\u7B49\uFF09\u304B\u3089\u7279\u5B9A\u30FB\u88DC\u5B8C\u3059\u308B\u5C02\u9580AI\u3067\u3059\u3002

\u4E0E\u3048\u3089\u308C\u305FCD\u60C5\u5831\u306E\u3046\u3061\u3001\u7A7A\u6B04\u30FB\u300CUnknown\u300D\u300C\u672A\u8A2D\u5B9A\u300D\u300C\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u672A\u767B\u9332\u300D\u306A\u3069\u306E\u6B20\u640D\u7B87\u6240\u306B\u3064\u3044\u3066\u3001\u6B63\u3057\u3044\u60C5\u5831\u3092\u88DC\u5B8C\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u3010\u88DC\u5B8C\u30EB\u30FC\u30EB\u3011
1. \u30BF\u30A4\u30C8\u30EB\u3001\u578B\u756A\u3001\u65E2\u5B58\u30C8\u30E9\u30C3\u30AF\u306E\u624B\u304C\u304B\u308A\u304B\u3089\u3001\u6B63\u78BA\u306A\u56FD\u5185\u76E4\u516C\u5F0F\u306E\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D\uFF08\u65E5\u672C\u8A9E/\u6B63\u5F0F\u8868\u8A18\uFF09\u3001\u767A\u58F2\u65E5(YYYY-MM-DD)\u3001\u30EC\u30FC\u30D9\u30EB\u540D(\u30EC\u30B3\u30FC\u30C9\u4F1A\u793E)\u3001\u898F\u683C\u54C1\u756A(\u4F8B: VICL-60001)\u3001\u30B8\u30E3\u30F3\u30EB\u3092\u88DC\u5B8C\u3057\u3066\u304F\u3060\u3055\u3044\u3002
2. \u3082\u3057\u30C8\u30E9\u30C3\u30AF\u30EA\u30B9\u30C8(tracks)\u304C0\u66F2\u306E\u5834\u5408\u3001\u4E3B\u8981\u306A\u53CE\u9332\u66F2\u30EA\u30B9\u30C8(trackNumber, title, duration)\u3092\u63A8\u6E2C\u30FB\u88DC\u5B8C\u3057\u3066\u304F\u3060\u3055\u3044\uFF08\u6700\u592720\u66F2\uFF09\u3002
3. \u65E2\u306B\u6B63\u3057\u3044\u60C5\u5831\u304C\u5165\u3063\u3066\u3044\u308B\u9805\u76EE\u306F\u5909\u66F4\u305B\u305A\u3001\u305D\u306E\u307E\u307E\u4FDD\u6301\u3057\u3066\u304F\u3060\u3055\u3044\u3002
4. backfilledFields \u306B\u4ECA\u56DE\u88DC\u5B8C\u3057\u305F\u9805\u76EE\u306E\u30EA\u30B9\u30C8\uFF08\u4F8B: ["artist", "releaseDate", "label"]\uFF09\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002
5. backfillSummary \u306B\u88DC\u5B8C\u7D50\u679C\u306E\u7C21\u6F54\u306A\u65E5\u672C\u8A9E\u8981\u7D04\uFF08\u4F8B: "\u516C\u5F0F\u30C7\u30A3\u30B9\u30B3\u30B0\u30E9\u30D5\u30A3\u3088\u308A\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8(\u30B5\u30B6\u30F3\u30AA\u30FC\u30EB\u30B9\u30BF\u30FC\u30BA)\u304A\u3088\u3073\u767A\u58F2\u5E74\u6708\u65E5(1998-06-25)\u3092\u88DC\u5B8C\u5B8C\u4E86"\uFF09\u3092\u8A18\u8F09\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u51FA\u529B\u306F\u5FC5\u305A\u4EE5\u4E0B\u306EJSON\u5F62\u5F0F\u306B\u3057\u3066\u304F\u3060\u3055\u3044:
{
  "results": [
    {
      "id": "CD\u306EID",
      "artist": "\u88DC\u5B8C\u5F8C\u307E\u305F\u306F\u65E2\u5B58\u306E\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D",
      "releaseDate": "\u88DC\u5B8C\u5F8C\u307E\u305F\u306F\u65E2\u5B58\u306E\u767A\u58F2\u65E5 (YYYY-MM-DD \u307E\u305F\u306F YYYY-MM \u307E\u305F\u306F YYYY)",
      "label": "\u88DC\u5B8C\u5F8C\u307E\u305F\u306F\u65E2\u5B58\u306E\u30EC\u30FC\u30D9\u30EB/\u767A\u58F2\u5143",
      "catalogNumber": "\u88DC\u5B8C\u5F8C\u307E\u305F\u306F\u65E2\u5B58\u306E\u898F\u683C\u54C1\u756A",
      "genre": "\u88DC\u5B8C\u5F8C\u307E\u305F\u306F\u65E2\u5B58\u306E\u30B8\u30E3\u30F3\u30EB",
      "tracks": [
        { "trackNumber": 1, "title": "\u66F2\u540D", "duration": "03:45" }
      ],
      "backfilledFields": ["artist", "releaseDate"],
      "backfillSummary": "\u88DC\u5B8C\u5185\u5BB9\u306E\u8981\u7D04"
    }
  ]
}`;
    try {
      const response = await generateContentWithFallback(ai, {
        contents: [
          {
            role: "user",
            parts: [
              { text: `\u4EE5\u4E0B\u306E\u6B20\u640D\u304C\u3042\u308BCD\u30E1\u30BF\u30C7\u30FC\u30BF\u30EA\u30B9\u30C8\u3092\u30AA\u30F3\u30E9\u30A4\u30F3\u516C\u7684\u60C5\u5831\u304B\u3089\u8ABF\u67FB\u3057\u3001\u7A7A\u6B04\u9805\u76EE\u3092\u88DC\u5B8C\u3057\u3066JSON\u3067\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044:

${JSON.stringify(promptData, null, 2)}` }
            ]
          }
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.1
        },
        preferredModel: "gemini-flash-latest"
      });
      const responseText = response.text;
      if (responseText) {
        const cleanJson = responseText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(cleanJson);
        if (parsed.results && Array.isArray(parsed.results)) {
          results.push(...parsed.results);
        }
      }
    } catch (err) {
      console.warn("Error in Gemini backfill chunk (using existing data fallback):", err);
      chunk.forEach((cd) => {
        results.push({
          id: cd.id,
          artist: cd.artist,
          releaseDate: cd.releaseDate,
          label: cd.label,
          catalogNumber: cd.catalogNumber,
          genre: cd.genre,
          tracks: cd.tracks,
          backfilledFields: [],
          backfillSummary: "API\u5236\u9650\u307E\u305F\u306F\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u30A8\u30E9\u30FC\u306E\u305F\u3081\u3001\u65E2\u5B58\u30C7\u30FC\u30BF\u3092\u7DAD\u6301\u3057\u307E\u3057\u305F\u3002"
        });
      });
    }
  }
  return results;
}

// server/upscaleImage.ts
import { GoogleGenAI as GoogleGenAI5 } from "@google/genai";

// server/security.ts
import dns from "dns";
import net from "net";
var BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
  "localhost",
  "localhost.localdomain",
  "0.0.0.0",
  "127.0.0.1",
  "::1",
  "[::1]",
  "169.254.169.254",
  "metadata.google.internal",
  "metadata"
]);
function isPrivateOrReservedIP(ip) {
  const normalized = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice("::ffff:".length);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateOrReservedIP(ipv4Part);
    }
  }
  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b, c] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" || normalized === "0:0:0:0:0:0:0:0") {
      return true;
    }
    if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;
    if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;
    if (/^ff[0-9a-f]{2}:/i.test(normalized)) return true;
    return false;
  }
  return true;
}
async function validateSafeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("\u6709\u52B9\u306AURL\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("URL\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http:// \u307E\u305F\u306F https:// \u306EURL\u306E\u307F\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u3059\u3002");
  }
  if (parsed.username || parsed.password) {
    throw new Error("\u8A8D\u8A3C\u60C5\u5831\u3092\u542B\u3080URL\u306F\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) {
    throw new Error("\u5185\u90E8\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u307E\u305F\u306F\u7981\u6B62\u3055\u308C\u305F\u30DB\u30B9\u30C8\u3078\u306E\u30A2\u30AF\u30BB\u30B9\u306F\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002");
  }
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      throw new Error("\u30D7\u30E9\u30A4\u30D9\u30FC\u30C8IP\u307E\u305F\u306F\u4E88\u7D04\u6E08\u307FIP\u30A2\u30C9\u30EC\u30B9\u3078\u306E\u30A2\u30AF\u30BB\u30B9\u306F\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002");
    }
    return parsed;
  }
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("\u30DB\u30B9\u30C8\u540D\u306E\u540D\u524D\u89E3\u6C7A\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002");
  }
  if (!addresses || addresses.length === 0) {
    throw new Error("\u30DB\u30B9\u30C8\u540D\u306EIP\u30A2\u30C9\u30EC\u30B9\u3092\u89E3\u6C7A\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
  }
  for (const addr of addresses) {
    if (isPrivateOrReservedIP(addr.address)) {
      throw new Error("\u5185\u90E8\u30CD\u30C3\u30C8\u30EF\u30FC\u30AFIP\u3078\u89E3\u6C7A\u3055\u308C\u308B\u30DB\u30B9\u30C8\u3078\u306E\u30A2\u30AF\u30BB\u30B9\u306F\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002");
    }
  }
  return parsed;
}
var ALLOWED_SAFE_IMAGE_MIMES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon"
]);
async function fetchSafeExternalImage(rawUrl, options) {
  const maxBytes = options?.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = options?.timeoutMs ?? 12e3;
  const maxRedirects = 4;
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validatedUrl = await validateSafeExternalUrl(currentUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(validatedUrl.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,image/*;q=0.8",
          Referer: validatedUrl.origin
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`\u30EA\u30C0\u30A4\u30EC\u30AF\u30C8\u5148URL\u304C\u4E0D\u660E\u3067\u3059 (HTTP ${response.status})`);
      }
      if (hop === maxRedirects) {
        throw new Error("\u30EA\u30C0\u30A4\u30EC\u30AF\u30C8\u56DE\u6570\u304C\u4E0A\u9650\u3092\u8D85\u3048\u307E\u3057\u305F\u3002");
      }
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }
    if (!response.ok) {
      throw new Error(`\u753B\u50CF\u53D6\u5F97\u30A8\u30E9\u30FC: HTTP ${response.status}`);
    }
    const rawContentType = (response.headers.get("content-type") || "").toLowerCase();
    const mimeType = rawContentType.split(";")[0].trim() || "image/jpeg";
    if (mimeType.includes("svg") || mimeType.includes("html") || mimeType.includes("xml") || mimeType.includes("script")) {
      throw new Error("\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u4FDD\u8B77\u306E\u305F\u3081\u3001SVG\u304A\u3088\u3073\u30B9\u30AF\u30EA\u30D7\u30C8\u3092\u542B\u3080\u53EF\u80FD\u6027\u306E\u3042\u308B\u753B\u50CF\u5F62\u5F0F\u306F\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002");
    }
    if (!ALLOWED_SAFE_IMAGE_MIMES.has(mimeType) && !mimeType.startsWith("image/")) {
      throw new Error(`\u8A31\u53EF\u3055\u308C\u3066\u3044\u306A\u3044\u30B3\u30F3\u30C6\u30F3\u30C4\u5F62\u5F0F\u3067\u3059 (${mimeType})`);
    }
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const declaredBytes = parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(declaredBytes) && declaredBytes > maxBytes) {
        throw new Error(`\u753B\u50CF\u30B5\u30A4\u30BA\u304C\u4E0A\u9650\uFF08${Math.round(maxBytes / 1024 / 1024)}MB\uFF09\u3092\u8D85\u3048\u3066\u3044\u307E\u3059\u3002`);
      }
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`\u753B\u50CF\u30B5\u30A4\u30BA\u304C\u4E0A\u9650\uFF08${Math.round(maxBytes / 1024 / 1024)}MB\uFF09\u3092\u8D85\u3048\u3066\u3044\u307E\u3059\u3002`);
    }
    const buffer = Buffer.from(arrayBuffer);
    const headSample = buffer.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
    if (headSample.startsWith("<svg") || headSample.startsWith("<!doctype html") || headSample.startsWith("<html") || headSample.includes("<script")) {
      throw new Error("\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u4FDD\u8B77\u306E\u305F\u3081\u3001SVG\u307E\u305F\u306FHTML\u30B3\u30F3\u30C6\u30F3\u30C4\u3092\u542B\u3080\u30C7\u30FC\u30BF\u306F\u62D2\u5426\u3055\u308C\u307E\u3057\u305F\u3002");
    }
    return { buffer, mimeType };
  }
  throw new Error("\u753B\u50CF\u306E\u53D6\u5F97\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002");
}
function createRateLimiter(options) {
  const { windowMs, maxRequests, message } = options;
  const hits = /* @__PURE__ */ new Map();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of hits.entries()) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        hits.delete(ip);
      } else {
        hits.set(ip, valid);
      }
    }
  }, 12e4);
  if (cleanupInterval.unref) cleanupInterval.unref();
  return (req, res, next) => {
    const forwarded = req.headers["x-forwarded-for"];
    const rawIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (hits.get(rawIp) || []).filter((t) => now - t < windowMs);
    if (recent.length >= maxRequests) {
      const retryAfterSec = Math.ceil(windowMs / 1e3);
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: message || `\u30EA\u30AF\u30A8\u30B9\u30C8\u56DE\u6570\u306E\u4E0A\u9650\uFF08${Math.round(windowMs / 1e3)}\u79D2\u3042\u305F\u308A\u6700\u5927${maxRequests}\u56DE\uFF09\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u3057\u3070\u3089\u304F\u5F85\u3063\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002`
      });
    }
    recent.push(now);
    hits.set(rawIp, recent);
    next();
  };
}
function securityHeadersMiddleware(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(), microphone=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
}

// server/upscaleImage.ts
async function upscaleJacketImage(imageBase64, title, artist, catalogNumber) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      error: "GEMINI_API_KEY \u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002AI Studio\u306ESecrets\u30D1\u30CD\u30EB\u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044\u3002",
      isQuotaError: true
    };
  }
  const ai = new GoogleGenAI5({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
  let cleanBase64 = imageBase64;
  let mimeType = "image/jpeg";
  if (imageBase64.includes(";base64,")) {
    const parts = imageBase64.split(";base64,");
    mimeType = parts[0].replace("data:", "");
    if (mimeType.toLowerCase().includes("svg") || mimeType.toLowerCase().includes("xml") || mimeType.toLowerCase().includes("html")) {
      return { error: "\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u4FDD\u8B77\u306E\u305F\u3081\u3001SVG\u5F62\u5F0F\u306E\u753B\u50CF\u30C7\u30FC\u30BF\u306F\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002" };
    }
    cleanBase64 = parts[1];
  } else if (imageBase64.startsWith("http://") || imageBase64.startsWith("https://")) {
    try {
      const { buffer, mimeType: fetchedMime } = await fetchSafeExternalImage(imageBase64);
      mimeType = fetchedMime;
      cleanBase64 = buffer.toString("base64");
    } catch (err) {
      return { error: `\u753B\u50CF\u53D6\u5F97\u30A8\u30E9\u30FC: ${err.message || "\u901A\u4FE1\u30A8\u30E9\u30FC"}` };
    }
  }
  const prompt = `Enhance and upscale this CD album cover art into a high-resolution, sharp, vivid, clean, high-definition official album jacket image.
Album Title: ${title || "CD Album"}
Artist: ${artist || "Music Artist"}
${catalogNumber ? `Catalog Number: ${catalogNumber}` : ""}
Recreate the album artwork sharply with 1:1 square ratio. Preserve the original artwork design, logo, title text, and artist aesthetic faithfully, while removing pixelation, compression artifacts, blur, or noise. Make it crisp and clear.`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-image",
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType
            }
          },
          {
            text: prompt
          }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });
    let enhancedImageBase64 = "";
    let description = "";
    const candidates = response.candidates;
    if (candidates && candidates.length > 0 && candidates[0].content?.parts) {
      for (const part of candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          const mime = part.inlineData.mimeType || "image/png";
          enhancedImageBase64 = `data:${mime};base64,${part.inlineData.data}`;
        } else if (part.text) {
          description += part.text;
        }
      }
    }
    if (!enhancedImageBase64) {
      return { error: "Gemini AI\u3067\u306E\u753B\u50CF\u8D85\u89E3\u50CF\u30A2\u30C3\u30D7\u30B9\u30B1\u30FC\u30EA\u30F3\u30B0\u751F\u6210\u7D50\u679C\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002" };
    }
    return { enhancedImageBase64, description };
  } catch (err) {
    console.log("Gemini image model quota limit (429) active, using client canvas fallback.");
    return {
      error: "Gemini API\u306E\u7121\u6599\u67A0\u753B\u50CF\u751F\u6210\u5236\u9650(Quota 429)\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u30AD\u30E3\u30F3\u30D0\u30B9\u9AD8\u753B\u8CEA\u5316\u30D5\u30A3\u30EB\u30BF\u30FC\u3092\u4EE3\u66FF\u9069\u7528\u3057\u307E\u3059\u3002",
      isQuotaError: true
    };
  }
}

// server/vinylLookup.ts
import { GoogleGenAI as GoogleGenAI6 } from "@google/genai";
function cleanTitleForVinylSearch(rawTitle) {
  return (rawTitle || "").replace(/[\(\[（【].*?(初回|通常|限定|期間|生産|盤|仕様|リマスタ|Remaster|Deluxe|Edition|Bonus|CD| Blu-ray|DVD).*?[\)\]）】]/gi, "").replace(/\s+-\s+.*?(Remaster|Edition).*$/i, "").trim();
}
function normalizeDateStr(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  const match = trimmed.match(/(\d{4})(?:[-./年](\d{1,2}))?(?:[-./月](\d{1,2}))?/);
  if (!match) return "";
  const yyyy = match[1];
  const mm = match[2] ? match[2].padStart(2, "0") : "";
  const dd = match[3] ? match[3].padStart(2, "0") : "";
  if (yyyy && mm && dd) return `${yyyy}-${mm}-${dd}`;
  if (yyyy && mm) return `${yyyy}-${mm}-01`;
  return yyyy;
}
function compareVinylCandidates(a, b) {
  const yearA = parseInt(a.releaseDate.slice(0, 4), 10) || 9999;
  const yearB = parseInt(b.releaseDate.slice(0, 4), 10) || 9999;
  if (yearA !== yearB) return yearA - yearB;
  if (a.releaseDate.length !== b.releaseDate.length) {
    return b.releaseDate.length - a.releaseDate.length;
  }
  return a.releaseDate.localeCompare(b.releaseDate);
}
async function searchMusicBrainzVinyl(title, artist) {
  try {
    const cleanTitle = cleanTitleForVinylSearch(title) || title.trim();
    const cleanArtist = (artist || "").trim();
    if (!cleanTitle) return [];
    const luceneParts = [`release:"${cleanTitle}"`];
    if (cleanArtist && cleanArtist !== "Unknown Artist" && cleanArtist !== "\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D") {
      luceneParts.push(`artist:"${cleanArtist}"`);
    }
    luceneParts.push(`(format:"Vinyl" OR format:"12\\" Vinyl" OR format:"7\\" Vinyl" OR format:"10\\" Vinyl" OR primarytype:"EP")`);
    const mbQuery = luceneParts.join(" AND ");
    const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(mbQuery)}&fmt=json&limit=10`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8e3);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CDCatalogApp/1.0.0 (https://github.com/aistudio-applet; contact@example.com)",
        Accept: "application/json"
      }
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return [];
    const data = await res.json();
    const releases = data.releases || [];
    const candidates = [];
    for (const rel of releases) {
      const rawDate = rel.date || "";
      const normDate = normalizeDateStr(rawDate);
      if (!normDate) continue;
      const mediaFormat = rel.media?.[0]?.format || "";
      const rgPrimary = rel["release-group"]?.["primary-type"] || "";
      const rgSecondary = rel["release-group"]?.["secondary-types"] || [];
      const isVinylMedia = /vinyl|12"|7"|10"|lp|ep/i.test(mediaFormat);
      const isEPGroup = rgPrimary === "EP" || rgSecondary.includes("EP");
      if (!isVinylMedia && !isEPGroup) continue;
      let detectedFormat = "LP";
      if (/7"|ep/i.test(mediaFormat) || isEPGroup) {
        detectedFormat = isVinylMedia ? 'EP (7" Vinyl)' : "EP";
      } else if (/12"/i.test(mediaFormat)) {
        detectedFormat = 'LP (12" Vinyl)';
      }
      const labelInfo = rel["label-info"]?.[0];
      const catNo = labelInfo?.["catalog-number"] || "";
      const labelName = labelInfo?.label?.name || "";
      const relArtist = rel["artist-credit"] ? rel["artist-credit"].map((ac) => ac.name || ac.artist?.name).filter(Boolean).join(", ") : cleanArtist;
      candidates.push({
        releaseDate: normDate,
        format: detectedFormat,
        catalogNumber: catNo,
        label: labelName,
        title: rel.title || cleanTitle,
        artist: relArtist,
        source: "musicbrainz",
        country: rel.country || "JP"
      });
    }
    return candidates;
  } catch {
    return [];
  }
}
async function searchDiscogsVinyl(title, artist, discogsToken) {
  try {
    const cleanTitle = cleanTitleForVinylSearch(title) || title.trim();
    const cleanArtist = (artist || "").trim();
    if (!cleanTitle) return [];
    const params = new URLSearchParams({
      type: "release",
      format: "Vinyl",
      release_title: cleanTitle,
      per_page: "10"
    });
    if (cleanArtist && cleanArtist !== "Unknown Artist" && cleanArtist !== "\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D") {
      params.append("artist", cleanArtist);
    }
    const headers = {
      "User-Agent": "CDMetadataManager/1.0 (+https://cd-metadata-app.local)",
      Accept: "application/json"
    };
    const rawToken = (discogsToken || process.env.DISCOGS_TOKEN || "").trim();
    if (rawToken) {
      if (rawToken.includes(":") && !rawToken.startsWith("http")) {
        const [key, secret] = rawToken.split(":");
        headers["Authorization"] = `Discogs key=${key.trim()}, secret=${secret.trim()}`;
      } else {
        headers["Authorization"] = `Discogs token=${rawToken}`;
        params.append("token", rawToken);
      }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8e3);
    const res = await fetch(`https://api.discogs.com/database/search?${params.toString()}`, {
      signal: controller.signal,
      headers
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || [];
    const candidates = [];
    for (const r of results) {
      const yearStr = r.year ? String(r.year) : "";
      const normDate = normalizeDateStr(yearStr);
      if (!normDate) continue;
      const fmtArr = Array.isArray(r.format) ? r.format : [r.format || "Vinyl"];
      const fmtJoined = fmtArr.join(", ");
      let detectedFormat = "LP";
      if (fmtArr.some((f) => /EP|7"|45 RPM/i.test(f))) {
        detectedFormat = "EP";
      } else if (fmtArr.some((f) => /LP|Album|12"|33 ⅓ RPM/i.test(f))) {
        detectedFormat = "LP";
      }
      let itemArtist = cleanArtist;
      let itemTitle = r.title || cleanTitle;
      if (r.title && r.title.includes(" - ")) {
        const parts = r.title.split(" - ");
        itemArtist = parts[0].trim();
        itemTitle = parts.slice(1).join(" - ").trim();
      }
      candidates.push({
        releaseDate: normDate,
        format: `${detectedFormat} (${fmtJoined})`,
        catalogNumber: r.catno || "",
        label: Array.isArray(r.label) ? r.label[0] : r.label || "",
        title: itemTitle,
        artist: itemArtist,
        source: "discogs",
        country: r.country || "JP"
      });
    }
    return candidates;
  } catch {
    return [];
  }
}
async function searchNDLVinyl(title, artist) {
  try {
    const cleanTitle = cleanTitleForVinylSearch(title) || title.trim();
    const cleanArtist = (artist || "").trim();
    if (!cleanTitle) return [];
    const queryParts = [`title="${cleanTitle}"`];
    if (cleanArtist && cleanArtist !== "Unknown Artist" && cleanArtist !== "\u30A2\u30FC\u30C6\u30A3\u30B9\u30C8\u540D") {
      queryParts.push(`creator="${cleanArtist}"`);
    }
    const sruQuery = queryParts.join(" AND ");
    const url = `https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2&recordSchema=dcndl&maximumRecords=10&query=${encodeURIComponent(sruQuery)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8e3);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CDCatalogApp/1.0 (https://github.com/aistudio-applet)"
      }
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return [];
    const xml = await res.text();
    const recordMatches = xml.match(/<recordData>[\s\S]*?<\/recordData>/gi) || [];
    const candidates = [];
    for (const recXml of recordMatches) {
      const isAnalogHint = /30cm|17cm|LP|EP|アナログ|レコード|33\s*1\/3|45\s*rpm/i.test(recXml);
      if (!isAnalogHint) continue;
      const extract = (tag) => {
        const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
        const match = recXml.match(regex);
        return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").trim() : "";
      };
      const rawIssued = extract("dcterms:issued") || extract("dc:date") || extract("date");
      const normDate = normalizeDateStr(rawIssued);
      if (!normDate) continue;
      const detectedFormat = /17cm|EP|45\s*rpm/i.test(recXml) ? "EP" : "LP";
      const rawTitle = (extract("dc:title") || cleanTitle).replace(/\s*\/\s*.*$/, "").replace(/<[^>]+>/g, "").trim();
      const rawPublisher = extract("dc:publisher") || extract("publisher") || "";
      candidates.push({
        releaseDate: normDate,
        format: detectedFormat,
        label: rawPublisher,
        title: rawTitle,
        artist: cleanArtist,
        source: "ndl",
        country: "JP"
      });
    }
    return candidates;
  } catch {
    return [];
  }
}
async function lookupVinylWithGemini(items, apiCandidatesByIndex) {
  const resultMap = /* @__PURE__ */ new Map();
  try {
    const ai = new GoogleGenAI6();
    const payload = items.map((item, idx) => ({
      index: idx,
      title: item.title,
      artist: item.artist,
      cdCatalogNumber: item.catalogNumber || "",
      cdReleaseDate: item.cdReleaseDate || "",
      apiFoundVinylCandidates: (apiCandidatesByIndex.get(idx) || []).slice(0, 4)
    }));
    const prompt = `
You are an authoritative Japanese & international discographer and vinyl record archivist.
For each CD album below, determine if an analog vinyl record (LP or EP / 7-inch / 12-inch) of the SAME title by the SAME artist was released, and identify its exact original LP/EP release date (YYYY-MM-DD if known, or YYYY-MM / YYYY) and original LP/EP catalog number.

Input CDs & API candidates:
${JSON.stringify(payload, null, 2)}

Instructions:
1. If API candidates are provided in "apiFoundVinylCandidates", verify them and refine partial year-only dates (e.g. "1984") into exact Japanese/original release dates ("YYYY-MM-DD") if known in official discography.
2. Even if "apiFoundVinylCandidates" is empty, if this album or single was released on LP or EP record (either originally in the 60s/70s/80s/90s or as a modern analog vinyl edition), provide its exact LP/EP release date, format ("LP", "EP", or "LP / EP"), and vinyl catalog number.
3. If no LP or EP vinyl record exists for this title, set "hasVinyl": false.

Return ONLY valid JSON with no markdown backticks:
{
  "results": [
    {
      "index": 0,
      "hasVinyl": true,
      "releaseDate": "YYYY-MM-DD",
      "format": "LP",
      "catalogNumber": "28AH-1234",
      "label": "...",
      "note": "1982\u5E74\u767A\u58F2\u306E\u30AA\u30EA\u30B8\u30CA\u30EBLP\u76E4 (\u898F\u683C\u54C1\u756A: ...)"
    }
  ]
}
`;
    const response = await generateContentWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      },
      preferredModel: "gemini-flash-latest"
    });
    const text = (response.text || "").replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.results)) {
      for (const r of parsed.results) {
        if (r && r.hasVinyl && r.releaseDate) {
          const normDate = normalizeDateStr(r.releaseDate);
          if (normDate) {
            const orig = items[r.index];
            resultMap.set(r.index, {
              releaseDate: normDate,
              format: r.format || "LP",
              catalogNumber: r.catalogNumber || "",
              label: r.label || "",
              title: orig?.title || "",
              artist: orig?.artist || "",
              source: "gemini",
              country: "JP"
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("Gemini vinyl lookup supplement skipped:", err);
  }
  return resultMap;
}
async function lookupVinylReleaseDates(queries) {
  if (!queries || queries.length === 0) return [];
  const apiCandidatesByIndex = /* @__PURE__ */ new Map();
  const CONCURRENCY = 3;
  for (let i = 0; i < queries.length; i += CONCURRENCY) {
    const slice = queries.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (q, sIdx) => {
        const idx = i + sIdx;
        const [mbList, dgList, ndlList] = await Promise.all([
          searchMusicBrainzVinyl(q.title, q.artist),
          searchDiscogsVinyl(q.title, q.artist, q.discogsToken),
          searchNDLVinyl(q.title, q.artist)
        ]);
        const combined = [...mbList, ...dgList, ...ndlList];
        combined.sort(compareVinylCandidates);
        apiCandidatesByIndex.set(idx, combined);
      })
    );
  }
  const geminiCandidateMap = /* @__PURE__ */ new Map();
  const GEMINI_CHUNK = 6;
  for (let i = 0; i < queries.length; i += GEMINI_CHUNK) {
    const chunk = queries.slice(i, i + GEMINI_CHUNK);
    const subMap = /* @__PURE__ */ new Map();
    chunk.forEach((_, cIdx) => {
      subMap.set(cIdx, apiCandidatesByIndex.get(i + cIdx) || []);
    });
    const gemRes = await lookupVinylWithGemini(chunk, subMap);
    gemRes.forEach((val, cIdx) => {
      geminiCandidateMap.set(i + cIdx, val);
    });
  }
  return queries.map((q, idx) => {
    const apiCandidates = apiCandidatesByIndex.get(idx) || [];
    const gemCandidate = geminiCandidateMap.get(idx);
    const allCandidates = [];
    if (gemCandidate) {
      allCandidates.push(gemCandidate);
    }
    for (const c of apiCandidates) {
      if (!allCandidates.some((existing) => existing.releaseDate === c.releaseDate && existing.format === c.format)) {
        allCandidates.push(c);
      }
    }
    allCandidates.sort((a, b) => {
      const yA = parseInt(a.releaseDate.slice(0, 4), 10) || 9999;
      const yB = parseInt(b.releaseDate.slice(0, 4), 10) || 9999;
      if (Math.abs(yA - yB) <= 1 && a.releaseDate.length !== b.releaseDate.length) {
        return b.releaseDate.length - a.releaseDate.length;
      }
      return compareVinylCandidates(a, b);
    });
    const primary = allCandidates[0];
    if (!primary) {
      return {
        id: q.id,
        found: false,
        candidates: [],
        summary: "\u540C\u30BF\u30A4\u30C8\u30EB\u306ELP\u30FBEP\u30EC\u30B3\u30FC\u30C9\u767A\u58F2\u65E5\u306F\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F"
      };
    }
    const sourceLabel = primary.source === "musicbrainz" ? "MusicBrainz API" : primary.source === "discogs" ? "Discogs API" : primary.source === "ndl" ? "\u56FD\u7ACB\u56FD\u4F1A\u56F3\u66F8\u9928(NDL) API" : "Discogs/MusicBrainz + Gemini\u7D71\u5408\u691C\u8A3C";
    return {
      id: q.id,
      found: true,
      vinylRecordReleaseDate: primary.releaseDate,
      vinylRecordFormat: primary.format.startsWith("EP") ? "EP" : "LP",
      vinylRecordCatalogNumber: primary.catalogNumber || void 0,
      vinylRecordLabel: primary.label || void 0,
      source: sourceLabel,
      candidates: allCandidates,
      summary: `${primary.format}\u76E4 \u767A\u58F2\u65E5: ${primary.releaseDate}${primary.catalogNumber ? ` (\u898F\u683C\u54C1\u756A: ${primary.catalogNumber})` : ""} [${sourceLabel}]`
    };
  });
}

// server.ts
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
app.use(securityHeadersMiddleware);
var largeImageJsonParser = express.json({ limit: "15mb" });
var defaultJsonParser = express.json({ limit: "2mb" });
app.use((req, res, next) => {
  if (req.path === "/api/ocr" || req.path === "/api/upscale-jacket") {
    return largeImageJsonParser(req, res, next);
  }
  return defaultJsonParser(req, res, next);
});
var aiRateLimiter = createRateLimiter({
  windowMs: 60 * 1e3,
  maxRequests: 25,
  message: "AI\u5206\u6790API\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u56DE\u6570\u304C\u4E0A\u9650\uFF081\u5206\u3042\u305F\u308A25\u56DE\uFF09\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u5C11\u3057\u5F85\u3063\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
});
var searchRateLimiter = createRateLimiter({
  windowMs: 60 * 1e3,
  maxRequests: 60,
  message: "\u691C\u7D22API\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u56DE\u6570\u304C\u4E0A\u9650\uFF081\u5206\u3042\u305F\u308A60\u56DE\uFF09\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u5C11\u3057\u5F85\u3063\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
});
var imageProxyRateLimiter = createRateLimiter({
  windowMs: 60 * 1e3,
  maxRequests: 240,
  message: "\u753B\u50CF\u30D7\u30ED\u30AD\u30B7\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u56DE\u6570\u304C\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u3057\u3070\u3089\u304F\u5F85\u3063\u3066\u304B\u3089\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
});
var MAX_BATCH_ITEMS_PER_REQUEST = 50;
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
});
app.post("/api/search", searchRateLimiter, async (req, res) => {
  try {
    const { catalogNumber, catno, title, artist, trackTitle, barcode, freeText, sources, apiKeys } = req.body || {};
    const effectiveCatno = catalogNumber || catno;
    if (!effectiveCatno && !title && !artist && !trackTitle && !barcode && !freeText) {
      return res.status(400).json({ error: "\u691C\u7D22\u6761\u4EF6\uFF08\u578B\u756A\u3001\u30BF\u30A4\u30C8\u30EB\u3001\u6B4C\u624B\u540D\u3001\u66F2\u540D\u3001\u30D0\u30FC\u30B3\u30FC\u30C9\u7B49\uFF09\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
    const result = await performAggregatedSearch({
      catalogNumber: effectiveCatno,
      title,
      artist,
      trackTitle,
      barcode,
      freeText,
      sources,
      apiKeys
    });
    res.json(result);
  } catch (err) {
    console.error("Error handling /api/search:", err);
    res.status(500).json({ error: err.message || "\u30E1\u30BF\u30C7\u30FC\u30BF\u691C\u7D22\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" });
  }
});
app.get("/api/itunes/tracks", searchRateLimiter, async (req, res) => {
  try {
    const collectionId = req.query.collectionId ? parseInt(req.query.collectionId, 10) : 0;
    if (!collectionId) {
      return res.status(400).json({ error: "collectionId is required" });
    }
    const tracks = await fetchITunesTracks(collectionId);
    res.json({ tracks });
  } catch (err) {
    res.status(500).json({ error: err.message || "iTunes\u30C8\u30E9\u30C3\u30AF\u53D6\u5F97\u30A8\u30E9\u30FC" });
  }
});
app.post("/api/ocr", aiRateLimiter, async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "\u753B\u50CF\u30C7\u30FC\u30BF(imageBase64)\u304C\u5FC5\u8981\u3067\u3059\u3002" });
    }
    const ocrResult = await processCDImageOCR(imageBase64, mimeType || "image/jpeg");
    res.json(ocrResult);
  } catch (err) {
    console.error("Error in /api/ocr:", err);
    res.status(500).json({ error: err.message || "AI\u753B\u50CF\u89E3\u6790\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" });
  }
});
app.post("/api/lookup-vinyl-release", aiRateLimiter, async (req, res) => {
  try {
    const { items, discogsToken } = req.body || {};
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "LP/EP\u767A\u58F2\u65E5\u3092\u691C\u7D22\u3059\u308B\u5BFE\u8C61\u306ECD\u60C5\u5831(items)\u304C\u5FC5\u8981\u3067\u3059\u3002" });
    }
    if (items.length > MAX_BATCH_ITEMS_PER_REQUEST) {
      return res.status(400).json({
        error: `1\u56DE\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u3067\u51E6\u7406\u3067\u304D\u308B\u4EF6\u6570\u306F\u6700\u5927 ${MAX_BATCH_ITEMS_PER_REQUEST} \u4EF6\u307E\u3067\u3067\u3059\uFF08\u9001\u4FE1\u4EF6\u6570: ${items.length}\u4EF6\uFF09\u3002`
      });
    }
    const queries = items.map((item) => ({
      id: item.id,
      title: item.title || "",
      artist: item.artist || "",
      catalogNumber: item.catalogNumber || "",
      cdReleaseDate: item.releaseDate || "",
      discogsToken: discogsToken || item.discogsToken
    }));
    const results = await lookupVinylReleaseDates(queries);
    res.json({ results });
  } catch (err) {
    console.error("Error in /api/lookup-vinyl-release:", err);
    res.status(500).json({ error: err.message || "LP/EP\u30EC\u30B3\u30FC\u30C9\u767A\u58F2\u65E5\u306E\u53D6\u5F97\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" });
  }
});
app.post("/api/upscale-jacket", aiRateLimiter, async (req, res) => {
  try {
    const { imageBase64, title, artist, catalogNumber } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "\u753B\u50CFURL\u307E\u305F\u306F\u753B\u50CF\u30C7\u30FC\u30BF(imageBase64)\u304C\u5FC5\u8981\u3067\u3059\u3002" });
    }
    const result = await upscaleJacketImage(imageBase64, title, artist, catalogNumber);
    return res.status(200).json(result);
  } catch (err) {
    console.log("Handled /api/upscale-jacket fallback.");
    return res.status(200).json({
      error: "Gemini API\u5229\u7528\u5236\u9650\u306E\u305F\u3081\u3001\u30AD\u30E3\u30F3\u30D0\u30B9\u9AD8\u753B\u8CEA\u5316\u30D5\u30A3\u30EB\u30BF\u30FC\u3092\u4EE3\u66FF\u9069\u7528\u3057\u307E\u3059\u3002",
      isQuotaError: true
    });
  }
});
app.post("/api/ai-analyze-tags", aiRateLimiter, async (req, res) => {
  try {
    const { cds, options } = req.body || {};
    if (!cds || !Array.isArray(cds) || cds.length === 0) {
      return res.status(400).json({ error: "\u5206\u6790\u5BFE\u8C61\u306ECD\u30EA\u30B9\u30C8(cds)\u304C\u5FC5\u8981\u3067\u3059\u3002" });
    }
    if (cds.length > MAX_BATCH_ITEMS_PER_REQUEST) {
      return res.status(400).json({
        error: `1\u56DE\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u3067\u5206\u6790\u3067\u304D\u308BCD\u4EF6\u6570\u306F\u6700\u5927 ${MAX_BATCH_ITEMS_PER_REQUEST} \u4EF6\u307E\u3067\u3067\u3059\uFF08\u9001\u4FE1\u4EF6\u6570: ${cds.length}\u4EF6\uFF09\u3002`
      });
    }
    const results = await analyzeCDTagsWithGemini(cds, options);
    res.json({ results });
  } catch (err) {
    console.error("Error in /api/ai-analyze-tags:", err);
    res.status(500).json({ error: err.message || "AI\u30BF\u30B0\u5206\u6790\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" });
  }
});
app.post("/api/ai-backfill-metadata", aiRateLimiter, async (req, res) => {
  try {
    const { cds } = req.body || {};
    if (!cds || !Array.isArray(cds) || cds.length === 0) {
      return res.status(400).json({ error: "\u88DC\u5B8C\u5BFE\u8C61\u306ECD\u30EA\u30B9\u30C8(cds)\u304C\u5FC5\u8981\u3067\u3059\u3002" });
    }
    if (cds.length > MAX_BATCH_ITEMS_PER_REQUEST) {
      return res.status(400).json({
        error: `1\u56DE\u306E\u30EA\u30AF\u30A8\u30B9\u30C8\u3067\u88DC\u5B8C\u3067\u304D\u308BCD\u4EF6\u6570\u306F\u6700\u5927 ${MAX_BATCH_ITEMS_PER_REQUEST} \u4EF6\u307E\u3067\u3067\u3059\uFF08\u9001\u4FE1\u4EF6\u6570: ${cds.length}\u4EF6\uFF09\u3002`
      });
    }
    const results = await backfillCDMetadataWithGemini(cds);
    res.json({ results });
  } catch (err) {
    console.error("Error in /api/ai-backfill-metadata:", err);
    res.status(500).json({ error: err.message || "Gemini API\u306B\u3088\u308B\u81EA\u52D5\u88DC\u5B8C\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F" });
  }
});
app.get("/api/image-proxy", imageProxyRateLimiter, async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send("\u6709\u52B9\u306A\u753B\u50CFURL\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
    const { buffer, mimeType } = await fetchSafeExternalImage(imageUrl);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
    );
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, immutable");
    res.send(buffer);
  } catch (err) {
    res.status(400).send(err.message || "\u753B\u50CF\u30D7\u30ED\u30AD\u30B7\u51E6\u7406\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002");
  }
});
app.post("/api/image-base64", imageProxyRateLimiter, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "\u6709\u52B9\u306A\u753B\u50CFURL\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
    const trimmedUrl = url.trim();
    if (trimmedUrl.startsWith("data:image/")) {
      const lowerData = trimmedUrl.slice(0, 64).toLowerCase();
      if (lowerData.includes("svg") || lowerData.includes("xml") || lowerData.includes("html")) {
        return res.status(400).json({ error: "\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u4FDD\u8B77\u306E\u305F\u3081\u3001SVG\u5F62\u5F0F\u306E\u30C7\u30FC\u30BFURL\u306F\u8A31\u53EF\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002" });
      }
      return res.json({ dataUrl: trimmedUrl });
    }
    const { buffer, mimeType } = await fetchSafeExternalImage(trimmedUrl);
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;
    res.json({ dataUrl, mimeType });
  } catch (err) {
    res.status(400).json({ error: err.message || "\u753B\u50CF\u306EBASE64\u5909\u63DB\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" });
  }
});
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom"
    });
    app.use(vite.middlewares);
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith("/api")) {
        return next();
      }
      try {
        const fs2 = await import("fs");
        let template = fs2.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    const distDir = fs.existsSync(path.resolve(__dirname, "..", "dist")) ? path.resolve(__dirname, "..", "dist") : path.resolve(process.cwd(), "dist");
    app.use(express.static(distDir));
    app.use("*", (req, res, next) => {
      if (req.originalUrl.startsWith("/api")) {
        return next();
      }
      res.sendFile(path.resolve(distDir, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CD Catalog App server listening on port ${PORT}`);
  });
}
startServer();
