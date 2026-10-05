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
    if (query.barcode) {
      luceneParts.push(`barcode:${query.barcode.trim()}`);
    } else if (query.catno) {
      const cleanCat = query.catno.trim();
      luceneParts.push(`catno:"${cleanCat}" OR catno:"${cleanCat.replace(/[- ]/g, "")}"`);
    } else if (query.title || query.artist || query.trackTitle) {
      if (query.title) luceneParts.push(`release:"${query.title.trim()}"`);
      if (query.artist) luceneParts.push(`artist:"${query.artist.trim()}"`);
      if (query.trackTitle) luceneParts.push(`recording:"${query.trackTitle.trim()}"`);
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
  try {
    const params = new URLSearchParams({
      type: "release",
      per_page: "8"
    });
    if (query.apiKeys?.discogsToken) {
      params.append("token", query.apiKeys.discogsToken.trim());
    }
    if (query.catno) {
      params.append("catno", query.catno.trim());
    } else if (query.barcode) {
      params.append("barcode", query.barcode.trim());
    } else if (query.title || query.artist || query.trackTitle) {
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
        headers: {
          "User-Agent": "CDCatalogApp/1.0 (https://github.com/aistudio-applet)",
          "Accept": "application/json"
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      console.warn(`Discogs API returned status ${res.status}`);
      return [];
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
      const catalogNumber = r.catno || query.catno || "";
      const releaseDate = r.year ? String(r.year) : "";
      const country = r.country || "JP";
      const label = Array.isArray(r.label) ? r.label[0] : r.label || "";
      const coverUrl = r.cover_image || r.thumb || "";
      const format = Array.isArray(r.format) ? r.format.join(", ") : r.format || "CD";
      const barcode = Array.isArray(r.barcode) ? r.barcode[0] : r.barcode || "";
      items.push({
        id: `discogs-${r.id}`,
        catalogNumber: catalogNumber || query.catno || "",
        title,
        artist,
        label,
        releaseDate,
        barcode,
        country,
        format,
        coverUrl,
        tracks: [],
        // Track list fetched on demand if needed
        source: "discogs",
        sourceDetails: {
          discogsId: String(r.id)
        },
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    return items;
  } catch (err) {
    if (err.name === "AbortError") {
      console.warn("Discogs API fetch timed out (10s limit)");
    } else {
      console.error("Error searching Discogs API:", err?.message || err);
    }
    return [];
  }
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
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&country=jp&limit=8`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6e3);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
      console.warn(`iTunes API returned status ${res.status}`);
      return [];
    }
    const data = await res.json();
    const results = data.results || [];
    const items = [];
    for (const album of results) {
      const collectionId = album.collectionId;
      const title = album.collectionName || album.collectionCensoredName || "Unknown Title";
      const artist = album.artistName || "Unknown Artist";
      const releaseDate = album.releaseDate ? album.releaseDate.slice(0, 10) : "";
      const genre = album.primaryGenreName || "";
      let coverUrl = album.artworkUrl100 || "";
      if (coverUrl) {
        coverUrl = coverUrl.replace("100x100bb", "600x600bb").replace("100x100", "600x600");
      }
      let tracks = [];
      if (items.length < 3 && collectionId) {
        tracks = await fetchITunesTracks(collectionId);
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
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=album&limit=8&market=JP`;
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
    const albums = data.albums?.items || [];
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
    if (query.barcode && /^\d{12,13}$/.test(query.barcode.trim())) {
      params.append("jan", query.barcode.trim());
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

// server/search.ts
async function performAggregatedSearch(query) {
  const startTime = Date.now();
  const selectedSources = query.sources && query.sources.length > 0 ? query.sources : ["musicbrainz", "discogs", "itunes", "ndl", "spotify", "rakuten"];
  const normalizedQuery = {
    ...query,
    catno: query.catalogNumber || query.catno
  };
  const searchPromises = [];
  if (selectedSources.includes("musicbrainz")) {
    searchPromises.push(
      searchMusicBrainz(normalizedQuery).then((items) => ({ source: "musicbrainz", items })).catch((err) => ({ source: "musicbrainz", items: [], error: err.message }))
    );
  }
  if (selectedSources.includes("discogs")) {
    searchPromises.push(
      searchDiscogs(normalizedQuery).then((items) => ({ source: "discogs", items })).catch((err) => ({ source: "discogs", items: [], error: err.message }))
    );
  }
  if (selectedSources.includes("itunes")) {
    searchPromises.push(
      searchITunes(normalizedQuery).then((items) => ({ source: "itunes", items })).catch((err) => ({ source: "itunes", items: [], error: err.message }))
    );
  }
  if (selectedSources.includes("ndl")) {
    searchPromises.push(
      searchNDL(normalizedQuery).then((items) => ({ source: "ndl", items })).catch((err) => ({ source: "ndl", items: [], error: err.message }))
    );
  }
  if (selectedSources.includes("spotify")) {
    searchPromises.push(
      searchSpotify(normalizedQuery).then((items) => ({ source: "spotify", items })).catch((err) => ({ source: "spotify", items: [], error: err.message }))
    );
  }
  if (selectedSources.includes("rakuten")) {
    searchPromises.push(
      searchRakutenBooks(normalizedQuery).then((items) => ({ source: "rakuten", items })).catch((err) => ({ source: "rakuten", items: [], error: err.message }))
    );
  }
  const sourceResultsList = await Promise.all(searchPromises);
  const sourceResults = {};
  const allItems = [];
  for (const sr of sourceResultsList) {
    sourceResults[sr.source] = {
      count: sr.items.length,
      items: sr.items,
      error: sr.error
    };
    allItems.push(...sr.items);
  }
  const candidates = mergeCDCandidates(allItems, query);
  return {
    candidates,
    sourceResults,
    searchedSources: selectedSources,
    searchTimeMs: Date.now() - startTime
  };
}
function mergeCDCandidates(items, query) {
  if (items.length === 0) return [];
  const groups = /* @__PURE__ */ new Map();
  items.forEach((item) => {
    const cleanCat = normalizeCatNo(item.catalogNumber);
    const cleanTitle = normalizeString(item.title);
    const cleanArtist = normalizeString(item.artist);
    let key = "";
    if (cleanCat && cleanCat.length >= 4) {
      key = `cat:${cleanCat}`;
    } else if (cleanTitle && cleanArtist) {
      key = `ta:${cleanArtist.slice(0, 10)}_${cleanTitle.slice(0, 15)}`;
    } else {
      key = `id:${item.id}`;
    }
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  });
  const candidates = [];
  groups.forEach((groupItems) => {
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
    let matchScore = 50 + sourcesMatched.length * 15;
    if (query.catalogNumber && catalogNumber && normalizeCatNo(catalogNumber) === normalizeCatNo(query.catalogNumber)) {
      matchScore += 25;
    }
    if (tracks.length > 0) matchScore += 10;
    if (coverUrl) matchScore += 10;
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
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    candidates.push({
      cd: consolidatedCD,
      sourcesMatched,
      matchScore
    });
  });
  candidates.sort((a, b) => b.matchScore - a.matchScore);
  return candidates;
}
function normalizeCatNo(str) {
  if (!str) return "";
  return str.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function normalizeString(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/[\s\-_,\.]/g, "");
}
function isJapanese(str) {
  if (!str) return false;
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(str);
}

// server/ocr.ts
import { GoogleGenAI } from "@google/genai";
async function processCDImageOCR(imageBase64, mimeType = "image/jpeg") {
  try {
    const ai = new GoogleGenAI();
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
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
      ]
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

// server/aiTagging.ts
import { GoogleGenAI as GoogleGenAI2 } from "@google/genai";
async function analyzeCDTagsWithGemini(cds, options = {}) {
  if (!cds || cds.length === 0) return [];
  const CHUNK_SIZE = 8;
  const allResults = [];
  const ai = new GoogleGenAI2();
  for (let i = 0; i < cds.length; i += CHUNK_SIZE) {
    const chunk = cds.slice(i, i + CHUNK_SIZE);
    const simplifiedChunk = chunk.map((cd) => ({
      id: cd.id,
      title: cd.title,
      artist: cd.artist,
      catalogNumber: cd.catalogNumber || "",
      label: cd.label || "",
      releaseDate: cd.releaseDate || "",
      trackListSample: (cd.tracks || []).slice(0, 8).map((t) => t.title).join(", "),
      existingGenre: cd.genre || "",
      existingTags: cd.existingTags || []
    }));
    const prompt = `
You are an expert Japanese and international music archivist, record store curator, and discographer.
Analyze the following CD albums to classify their musical genre, mood/atmosphere, release era/decade, and produce 3 to 5 concise, standardized Japanese tags for music collection management.

Options requested:
- Include Musical Genre/Sub-genre: ${options.includeGenre !== false ? "Yes" : "No"}
- Include Mood/Atmosphere (\u96F0\u56F2\u6C17): ${options.includeMood !== false ? "Yes" : "No"}
- Include Era/Decade (\u30EA\u30EA\u30FC\u30B9\u5E74\u4EE3): ${options.includeEra !== false ? "Yes" : "No"}
- Maximum tags per album: ${options.maxTagsPerCD || 5}

CDs to analyze:
${JSON.stringify(simplifiedChunk, null, 2)}

Instructions:
1. "genre": The primary music genre in Japanese (e.g., "J-POP", "\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7", "\u30ED\u30C3\u30AF", "\u30A2\u30CB\u30E1\u30BD\u30F3\u30B0", "\u30B8\u30E3\u30BA", "\u662D\u548C\u6B4C\u8B21", "\u30D5\u30A9\u30FC\u30AF", "R&B", "\u30D2\u30C3\u30D7\u30DB\u30C3\u30D7", "\u30A2\u30A4\u30C9\u30EB", "\u30AF\u30E9\u30B7\u30C3\u30AF", "\u30CF\u30FC\u30C9\u30ED\u30C3\u30AF", "\u30CB\u30E5\u30FC\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF", "\u30A8\u30EC\u30AF\u30C8\u30ED\u30CB\u30C3\u30AF").
2. "subGenre": Sub-genre or musical style if applicable (e.g., "\u30AC\u30FC\u30EB\u30BA\u30DD\u30C3\u30D7", "\u9752\u6625\u30D1\u30F3\u30AF", "AOR", "\u30E1\u30ED\u30B3\u30A2", "\u6E0B\u8C37\u7CFB", "\u30C6\u30AF\u30CE\u30DD\u30C3\u30D7").
3. "mood": Atmosphere & emotional feel keywords in Japanese (e.g., "\u723D\u5FEB\u30FB\u75BE\u8D70\u611F", "\u5207\u306A\u3044\u30FB\u54C0\u6101", "\u30E1\u30ED\u30A6\u30FB\u30C1\u30EB", "\u30A8\u30E2\u30FC\u30B7\u30E7\u30CA\u30EB", "\u30EA\u30E9\u30C3\u30AF\u30B9\u30FB\u591C", "\u30C0\u30F3\u30B5\u30D6\u30EB", "\u91CD\u539A\u30FB\u30C0\u30FC\u30AF").
4. "era": Era/decade classification (e.g., "70\u5E74\u4EE3", "80\u5E74\u4EE3", "90\u5E74\u4EE3", "2000\u5E74\u4EE3", "2010\u5E74\u4EE3", "2020\u5E74\u4EE3", "\u662D\u548C\u6B4C\u8B21", "\u5E73\u6210\u521D\u671F", "\u4EE4\u548C").
5. "suggestedTags": Array of 3 to 5 concise Japanese tags. Examples: ["J-POP", "90\u5E74\u4EE3", "\u30DF\u30EA\u30AA\u30F3\u30BB\u30E9\u30FC", "\u5207\u306A\u3044", "\u540D\u76E4"], ["\u30B7\u30C6\u30A3\u30DD\u30C3\u30D7", "80\u5E74\u4EE3", "\u723D\u3084\u304B", "\u30C9\u30E9\u30A4\u30D6"], ["\u30A2\u30CB\u30BD\u30F3", "2000\u5E74\u4EE3", "\u71B1\u3044", "\u4E3B\u984C\u6B4C"].
6. "reasoning": A 1-sentence Japanese summary describing the musical sound and features.

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
      "reasoning": "..."
    }
  ]
}
`;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      const text = response.text || "";
      const cleanJson = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed && Array.isArray(parsed.results)) {
        allResults.push(...parsed.results);
      } else {
        console.warn("Gemini returned unexpected structure for AI tagging:", text);
      }
    } catch (err) {
      console.error(`Error in Gemini AI tagging chunk ${i}:`, err);
      chunk.forEach((cd) => {
        const year = cd.releaseDate?.slice(0, 4);
        let era = "";
        if (year) {
          const y = parseInt(year, 10);
          if (y >= 1970 && y < 1980) era = "70\u5E74\u4EE3";
          else if (y >= 1980 && y < 1990) era = "80\u5E74\u4EE3";
          else if (y >= 1990 && y < 2e3) era = "90\u5E74\u4EE3";
          else if (y >= 2e3 && y < 2010) era = "2000\u5E74\u4EE3";
          else if (y >= 2010 && y < 2020) era = "2010\u5E74\u4EE3";
          else if (y >= 2020) era = "2020\u5E74\u4EE3";
        }
        allResults.push({
          id: cd.id,
          genre: "J-POP / \u90A6\u697D",
          mood: "\u30DD\u30C3\u30D7\u30FB\u30E1\u30ED\u30C7\u30A3\u30A2\u30B9",
          era: era || "\u90A6\u697D",
          suggestedTags: [era, "J-POP", "\u90A6\u697D"].filter(Boolean),
          reasoning: "AI\u901A\u4FE1\u30D5\u30A9\u30FC\u30EB\u30D0\u30C3\u30AF\u306B\u3088\u308B\u7C21\u6613\u5224\u5B9A"
        });
      });
    }
  }
  return allResults;
}

// server.ts
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3e3;
app.use(express.json({ limit: "15mb" }));
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: (/* @__PURE__ */ new Date()).toISOString() });
});
app.post("/api/search", async (req, res) => {
  try {
    const { catalogNumber, title, artist, trackTitle, barcode, freeText, sources, apiKeys } = req.body || {};
    if (!catalogNumber && !title && !artist && !trackTitle && !barcode && !freeText) {
      return res.status(400).json({ error: "\u691C\u7D22\u6761\u4EF6\uFF08\u578B\u756A\u3001\u30BF\u30A4\u30C8\u30EB\u3001\u6B4C\u624B\u540D\u3001\u66F2\u540D\u3001\u30D0\u30FC\u30B3\u30FC\u30C9\u7B49\uFF09\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002" });
    }
    const result = await performAggregatedSearch({
      catalogNumber,
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
app.get("/api/itunes/tracks", async (req, res) => {
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
app.post("/api/ocr", async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ error: "\u753B\u50CF\u30C7\u30FC\u30BF(imageBase64)\u304C\u5FC5\u8981\u3067\u3059\u3002" });
    }
    const ocrResult = await processCDImageOCR(imageBase64, mimeType || "image/jpeg");
    res.json(ocrResult);
  } catch (err) {
    console.error("Error in /api/ocr:", err);
    res.status(500).json({ error: err.message || "AI\u753B\u50CF\u89E3\u6790\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" });
  }
});
app.post("/api/ai-analyze-tags", async (req, res) => {
  try {
    const { cds, options } = req.body || {};
    if (!cds || !Array.isArray(cds) || cds.length === 0) {
      return res.status(400).json({ error: "\u5206\u6790\u5BFE\u8C61\u306ECD\u30EA\u30B9\u30C8(cds)\u304C\u5FC5\u8981\u3067\u3059\u3002" });
    }
    const results = await analyzeCDTagsWithGemini(cds, options);
    res.json({ results });
  } catch (err) {
    console.error("Error in /api/ai-analyze-tags:", err);
    res.status(500).json({ error: err.message || "AI\u30BF\u30B0\u5206\u6790\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002" });
  }
});
app.get("/api/image-proxy", async (req, res) => {
  try {
    const imageUrl = req.query.url;
    if (!imageUrl || !imageUrl.startsWith("http://") && !imageUrl.startsWith("https://")) {
      return res.status(400).send("\u6709\u52B9\u306A\u753B\u50CFURL\u3092\u6307\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e3);
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": new URL(imageUrl).origin
      }
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
      return res.status(response.status).send(`\u753B\u50CF\u53D6\u5F97\u30A8\u30E9\u30FC: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, immutable");
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send(err.message || "\u753B\u50CF\u30D7\u30ED\u30AD\u30B7\u51E6\u7406\u4E2D\u306B\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002");
  }
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
