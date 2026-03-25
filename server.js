if (!Object.hasOwn) {
  Object.hasOwn = function(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}
if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function(str, newStr) {
    return this.split(str).join(newStr);
  };
}

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Cache de resultados (en memoria, TTL 10 min) ────────────────────────────
// Cachea por keyword INDIVIDUAL. Así "piedra" buscado como parte de
// "bronce hierro piedra" queda cacheado y la próxima búsqueda de solo "piedra"
// es instantánea. Al combinar múltiples keywords se deduplican los lotes.
const RESULT_CACHE = {};
const RESULT_CACHE_TTL = 10 * 60 * 1000; // 10 minutos

function deduplicateLots(lots) {
    const seen = new Set();
    return lots.filter(lot => {
        const key = `${lot.source}-${lot.lotId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ─── Cache de lotes por remate (en disco) ────────────────────────────────────
// Estructura: { bavastro: { [auctionId]: { [keyword]: [lotId, ...] } }, arechaga: {}, castells: {} }
// [] (array vacío) = "ya se buscó esta keyword en este remate y no hubo coincidencias"
// clave ausente    = "todavía no se buscó"
//
// Lógica por remate:
//   - Si TODAS las keywords tienen [] en cache → skip total (no se hace ningún fetch)
//   - Si alguna keyword tiene matches en cache → se re-fetcha el remate para actualizar precios
//   - Si alguna keyword no está en cache → full scan del remate
//
// Expiración: cada búsqueda obtiene los remates activos frescos y elimina del cache
// cualquier remate que ya no esté activo.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_FILE = path.join(__dirname, 'search_cache.json');

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) { console.error('Error cargando cache:', e.message); }
    return { bavastro: {}, arechaga: {}, castells: {}, reysubastas: {} };
}

function saveCache() {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); }
    catch (e) { console.error('Error guardando cache:', e.message); }
}

let cache = loadCache();

// Dado el cache de un remate y la lista de keywords, determina qué hay que hacer
function getCacheStatus(auctionCache, keywordList) {
    const uncached = keywordList.filter(kw => !(kw in auctionCache));
    const cachedWithMatches = keywordList.filter(kw => kw in auctionCache && auctionCache[kw].length > 0);
    // skip si todas las keywords ya se buscaron y ninguna tuvo resultado
    const skip = uncached.length === 0 && cachedWithMatches.length === 0;
    return { uncached, cachedWithMatches, skip };
}

// ─── Prado Remates ────────────────────────────────────────────────────────────
// Usa WooCommerce + plugin "ultimate-woocommerce-auction-pro".
// No tiene API REST propia → se busca por el endpoint de búsqueda de WooCommerce,
// se parsea el HTML y se filtran lotes activos (sin clase winning_bid).

function decodeHtmlEntities(str) {
    return str
        .replace(/&#8211;/g, '-').replace(/&#8212;/g, '—').replace(/&#8216;/g, "'")
        .replace(/&#8217;/g, "'").replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').trim();
}

async function fetchPradoRematesLots(keywordList, minPricePesos) {
    const allMatchingLots = [];
    try {
        console.log('PradoRemates: buscando...');
        const kwResults = await Promise.all(keywordList.map(async (kw) => {
            const lots = [];
            let page = 1;
            let hasMore = true;
            while (hasMore) {
                const searchUrl = `https://pradorematesenlinea.uy/?s=${encodeURIComponent(kw)}&post_type=product${page > 1 ? `&paged=${page}` : ''}`;
                const r = await axios.get(searchUrl, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } });
                const html = r.data;
                const items = [...html.matchAll(/<li[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]+?)<\/li>/g)];

                for (const item of items) {
                    const raw = item[1];
                    if (raw.includes('winning_bid')) continue; // lote cerrado/ganado

                    const title = (raw.match(/woocommerce-loop-product__title[^>]*>([^<]+)/) || [])[1];
                    const url = (raw.match(/href="(https:\/\/pradorematesenlinea[^"]+)"/) || [])[1];
                    const img = (raw.match(/<img[^>]+src="([^"]+)"/) || [])[1];
                    const productId = (raw.match(/data-product_id="(\d+)"/) || [])[1];
                    const bdi = raw.match(/<bdi>([\s\S]+?)<\/bdi>/);
                    const rawPrice = bdi
                        ? bdi[1].replace(/<[^>]+>/g, '').replace(/&#36;|&nbsp;/g, '').replace(/\./g, '').trim()
                        : '0';
                    const price = parseFloat(rawPrice) || 0;

                    if (!title || !url || price < minPricePesos) continue;

                    lots.push({
                        source: 'PradoRemates',
                        auctionId: 'prado',
                        auctionName: 'Prado Remates en Línea',
                        lotId: productId || url,
                        lotNumber: productId,
                        endDate: null, // Prado is scraped HTML, no easy end date
                        description: decodeHtmlEntities(title),
                        imageUrl: img || '',
                        url,
                        basePrice: price,
                        currentPrice: price,
                        currencyPrefix: '$'
                    });
                }

                hasMore = html.includes('class="next page-numbers"') && items.length > 0;
                page++;
                if (page > 5) hasMore = false; // límite de seguridad
            }
            return lots;
        }));
        allMatchingLots.push(...kwResults.flat());
    } catch (e) {
        console.error('PradoRemates Error:', e.message);
    }
    return allMatchingLots;
}

// ─── Bavastro ─────────────────────────────────────────────────────────────────

async function fetchBavastroLots(keywordList, minPricePesos, USD_TO_PESOS) {
    const allMatchingLots = [];
    try {
        console.log('Bavastro: obteniendo remates activos...');
        const auctionsRes = await axios.get('https://api-parseo.bavastronline.com/published_auctions/?limit=100');
        const activeAuctions = (auctionsRes.data.results || []).filter(a => a.state === 'active' || a.active === true);
        const activeIds = new Set(activeAuctions.map(a => String(a.id)));

        // Expirar remates terminados
        for (const id of Object.keys(cache.bavastro)) {
            if (!activeIds.has(id)) {
                console.log(`Bavastro: remate ${id} finalizado, eliminado del cache`);
                delete cache.bavastro[id];
            }
        }

        const auctionResults = await Promise.all(activeAuctions.map(async (auction) => {
            const auctionId = String(auction.id);
            const auctionCache = cache.bavastro[auctionId] || {};
            const { uncached, cachedWithMatches, skip } = getCacheStatus(auctionCache, keywordList);

            if (skip) {
                console.log(`Bavastro: remate ${auctionId} saltado (sin coincidencias en cache)`);
                return [];
            }

            console.log(`Bavastro: remate ${auctionId} — scan: [${uncached.join(',')}] | refresh: [${cachedWithMatches.join(',')}]`);

            if (!cache.bavastro[auctionId]) cache.bavastro[auctionId] = {};
            for (const kw of uncached) cache.bavastro[auctionId][kw] = [];

            const cachedLotIds = new Set(
                cachedWithMatches.flatMap(kw => (auctionCache[kw] || []).map(String))
            );

            const matchingLots = [];
            try {
                let page = 1;
                let hasMore = true;

                while (hasMore) {
                    const lotsUrl = `https://api-parseo.bavastronline.com/auctions/${auctionId}/lots/published/?page=${page}&sort=lot_number&page_size=100`;
                    const lotsRes = await axios.get(lotsUrl);
                    const lots = lotsRes.data.results || [];

                    if (lots.length === 0) { hasMore = false; break; }

                    for (const lotItem of lots) {
                        const lotId = String(lotItem.id);
                        const description = (lotItem.lot.description || '').toLowerCase();
                        let isMatch = false;

                        for (const kw of uncached) {
                            if (description.includes(kw)) {
                                cache.bavastro[auctionId][kw].push(lotId);
                                isMatch = true;
                            }
                        }

                        if (cachedLotIds.has(lotId)) isMatch = true;

                        if (isMatch) {
                            const currencyPrefix = lotItem.lot.currency ? lotItem.lot.currency.prefix : '$';
                            const isUsd = currencyPrefix && currencyPrefix.toUpperCase().includes('USD');
                            const baseP = parseFloat(lotItem.lot.base_price) || 0;
                            const currP = parseFloat(lotItem.best_price) || 0;
                            const maxP = Math.max(baseP, currP);
                            const maxPInPesos = isUsd ? maxP * USD_TO_PESOS : maxP;
                            if (maxPInPesos < minPricePesos) continue;

                            let imageUrl = '';
                            if (lotItem.lot.images && lotItem.lot.images.length > 0) imageUrl = lotItem.lot.images[0].image;

                            let rawDate = lotItem.end_date || lotItem.lot.end_date || auction.end_date || '';
                            let formattedDate = '';
                            if (rawDate) {
                                try {
                                    const d = new Date(rawDate);
                                    if (!isNaN(d)) formattedDate = d.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' });
                                } catch(e){}
                            }

                            matchingLots.push({
                                source: 'Bavastro',
                                auctionId: auction.id,
                                auctionName: lotItem.lot.auction.name,
                                lotId: lotItem.id,
                                lotNumber: lotItem.lot_number || lotItem.lot.number || lotItem.number,
                                endDate: formattedDate,
                                description: lotItem.lot.description,
                                imageUrl,
                                url: `https://www.bavastronline.com.uy/lot/${lotItem.id}`,
                                basePrice: lotItem.lot.base_price,
                                currentPrice: lotItem.best_price,
                                currencyPrefix
                            });
                        }
                    }

                    hasMore = !!lotsRes.data.next;
                    page++;
                }
            } catch (err) {
                console.error(`Bavastro: error procesando remate ${auctionId}:`, err.message);
            }
            return matchingLots;
        }));
        allMatchingLots.push(...auctionResults.flat());
    } catch (error) {
        console.error('Bavastro Error:', error.message);
    }
    return allMatchingLots;
}

// ─── Arechaga ─────────────────────────────────────────────────────────────────

async function fetchArechagaLots(keywordList, minPricePesos, USD_TO_PESOS) {
    const allMatchingLots = [];
    try {
        console.log('Arechaga: obteniendo remates activos...');
        const auctionsRes = await axios.get('https://api.arechaga.com.uy/public/auctions/');
        const activeAuctions = (auctionsRes.data.data && auctionsRes.data.data.inProgress) || [];
        const activeIds = new Set(activeAuctions.map(a => String(a.id)));

        // Expirar remates terminados
        for (const id of Object.keys(cache.arechaga)) {
            if (!activeIds.has(id)) {
                console.log(`Arechaga: remate ${id} finalizado, eliminado del cache`);
                delete cache.arechaga[id];
            }
        }

        const auctionResults = await Promise.all(activeAuctions.map(async (auction) => {
            const auctionId = String(auction.id);
            const isUsd = auction.money === 2;
            const auctionCache = cache.arechaga[auctionId] || {};
            const { uncached, cachedWithMatches, skip } = getCacheStatus(auctionCache, keywordList);

            if (skip) {
                console.log(`Arechaga: remate ${auctionId} saltado (sin coincidencias en cache)`);
                return [];
            }

            console.log(`Arechaga: remate ${auctionId} — scan: [${uncached.join(',')}] | refresh: [${cachedWithMatches.join(',')}]`);

            if (!cache.arechaga[auctionId]) cache.arechaga[auctionId] = {};
            for (const kw of uncached) cache.arechaga[auctionId][kw] = [];

            const cachedLotIds = new Set(
                cachedWithMatches.flatMap(kw => (auctionCache[kw] || []).map(String))
            );

            const matchingLots = [];
            try {
                const auctionRes = await axios.get(`https://api.arechaga.com.uy/public/auctions/${auctionId}`);
                const lots = (auctionRes.data.data && auctionRes.data.data.lots) || [];

                for (const lot of lots) {
                    const lotId = String(lot.id);
                    const titleText = (lot.title || '').toLowerCase();
                    const descText = (lot.description || '').toLowerCase();
                    let isMatch = false;

                    for (const kw of uncached) {
                        if (titleText.includes(kw) || descText.includes(kw)) {
                            cache.arechaga[auctionId][kw].push(lotId);
                            isMatch = true;
                        }
                    }

                    if (cachedLotIds.has(lotId)) isMatch = true;

                    if (isMatch) {
                        const baseP = parseFloat(lot.price_base) || 0;
                        const currP = parseFloat(lot.offer) || parseFloat(lot.bestOffer) || 0;
                        const maxP = Math.max(baseP, currP);
                        const maxPInPesos = isUsd ? maxP * USD_TO_PESOS : maxP;
                        if (maxPInPesos < minPricePesos) continue;

                        let rawDate = lot.date_close || auction.date_to || '';
                        let formattedDate = '';
                        if (rawDate) {
                            try {
                                const d = new Date(rawDate);
                                if (!isNaN(d)) formattedDate = d.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' });
                            } catch(e){}
                        }

                        // Arechaga/ReySubastas text title often has the lot number if it's not in id_lot easily, but usually id_lot is the lot number or order
                        let lotNum = lot.id_lot || '';

                        matchingLots.push({
                            source: 'Arechaga',
                            auctionId: auction.id,
                            auctionName: auction.title,
                            lotId: lot.id,
                            lotNumber: lotNum,
                            endDate: formattedDate,
                            description: lot.title || lot.description,
                            imageUrl: lot.image_lot_thumb || lot.image_lot || '',
                            url: `https://arechaga.com.uy/lotes/${lot.id}`,
                            basePrice: lot.price_base,
                            currentPrice: lot.offer || lot.bestOffer || 0,
                            currencyPrefix: isUsd ? 'USD' : '$'
                        });
                    }
                }
            } catch (err) {
                console.error(`Arechaga: error procesando remate ${auctionId}:`, err.message);
            }
            return matchingLots;
        }));
        allMatchingLots.push(...auctionResults.flat());
    } catch (error) {
        console.error('Arechaga Error:', error.message);
    }
    return allMatchingLots;
}

// ─── Rey Subastas ─────────────────────────────────────────────────────────────

async function fetchReySubastasLots(keywordList, minPricePesos, USD_TO_PESOS) {
    const allMatchingLots = [];
    try {
        console.log('ReySubastas: obteniendo remates activos...');
        const auctionsRes = await axios.get('https://api.reysubastas.com/public/auctions/');
        const activeAuctions = (auctionsRes.data.data && auctionsRes.data.data.inProgress) || [];
        const activeIds = new Set(activeAuctions.map(a => String(a.id)));

        for (const id of Object.keys(cache.reysubastas)) {
            if (!activeIds.has(id)) {
                console.log(`ReySubastas: remate ${id} finalizado, eliminado del cache`);
                delete cache.reysubastas[id];
            }
        }

        const auctionResults = await Promise.all(activeAuctions.map(async (auction) => {
            const auctionId = String(auction.id);
            const isUsd = auction.money === 2;
            const auctionCache = cache.reysubastas[auctionId] || {};
            const { uncached, cachedWithMatches, skip } = getCacheStatus(auctionCache, keywordList);

            if (skip) {
                console.log(`ReySubastas: remate ${auctionId} saltado (sin coincidencias en cache)`);
                return [];
            }

            console.log(`ReySubastas: remate ${auctionId} — scan: [${uncached.join(',')}] | refresh: [${cachedWithMatches.join(',')}]`);

            if (!cache.reysubastas[auctionId]) cache.reysubastas[auctionId] = {};
            for (const kw of uncached) cache.reysubastas[auctionId][kw] = [];

            const cachedLotIds = new Set(
                cachedWithMatches.flatMap(kw => (auctionCache[kw] || []).map(String))
            );

            const matchingLots = [];
            try {
                const auctionRes = await axios.get(`https://api.reysubastas.com/public/auctions/${auctionId}`);
                const lots = (auctionRes.data.data && auctionRes.data.data.lots) || [];

                for (const lot of lots) {
                    const lotId = String(lot.id);
                    const titleText = (lot.title || '').toLowerCase();
                    const descText = (lot.description || '').toLowerCase();
                    let isMatch = false;

                    for (const kw of uncached) {
                        if (titleText.includes(kw) || descText.includes(kw)) {
                            cache.reysubastas[auctionId][kw].push(lotId);
                            isMatch = true;
                        }
                    }

                    if (cachedLotIds.has(lotId)) isMatch = true;

                    if (isMatch) {
                        const baseP = parseFloat(lot.price_base) || 0;
                        const currP = parseFloat(lot.offer) || parseFloat(lot.bestOffer) || 0;
                        const maxP = Math.max(baseP, currP);
                        const maxPInPesos = isUsd ? maxP * USD_TO_PESOS : maxP;
                        if (maxPInPesos < minPricePesos) continue;

                        let rawDate = lot.date_close || auction.date_to || '';
                        let formattedDate = '';
                        if (rawDate) {
                            try {
                                const d = new Date(rawDate);
                                if (!isNaN(d)) formattedDate = d.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' });
                            } catch(e){}
                        }

                        let lotNum = lot.id_lot || '';

                        matchingLots.push({
                            source: 'ReySubastas',
                            auctionId: auction.id,
                            auctionName: auction.title,
                            lotId: lot.id,
                            lotNumber: lotNum,
                            endDate: formattedDate,
                            description: lot.title || lot.description,
                            imageUrl: lot.image_lot_thumb || lot.image_lot || '',
                            url: `https://reysubastas.com/lotes/${lot.id}`,
                            basePrice: lot.price_base,
                            currentPrice: lot.offer || lot.bestOffer || 0,
                            currencyPrefix: isUsd ? 'USD' : '$'
                        });
                    }
                }
            } catch (err) {
                console.error(`ReySubastas: error procesando remate ${auctionId}:`, err.message);
            }
            return matchingLots;
        }));
        allMatchingLots.push(...auctionResults.flat());
    } catch (error) {
        console.error('ReySubastas Error:', error.message);
    }
    return allMatchingLots;
}

// ─── Castells ─────────────────────────────────────────────────────────────────

async function fetchCastellsLots(keywordList, minPricePesos, USD_TO_PESOS) {
    const allMatchingLots = [];
    try {
        console.log('Castells: obteniendo remates activos...');
        const homeRes = await axios.get('https://subastascastells.com/frontend.home.aspx', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const html = homeRes.data;
        const match = html.match(/"vSUBASTASENPROGRESO":(\[.+?\])/);

        if (match && match[1]) {
            const activeAuctions = JSON.parse(match[1]);
            const activeIds = new Set(
                activeAuctions.filter(a => a.RemateId).map(a => String(a.RemateId))
            );

            // Expirar remates terminados
            for (const id of Object.keys(cache.castells)) {
                if (!activeIds.has(id)) {
                    console.log(`Castells: remate ${id} finalizado, eliminado del cache`);
                    delete cache.castells[id];
                }
            }

            const auctionResults = await Promise.all(
                activeAuctions.filter(a => a.RemateId).map(async (auction) => {
                    const auctionId = String(auction.RemateId);
                    const auctionCache = cache.castells[auctionId] || {};
                    const { uncached, cachedWithMatches, skip } = getCacheStatus(auctionCache, keywordList);

                    if (skip) {
                        console.log(`Castells: remate ${auctionId} saltado (sin coincidencias en cache)`);
                        return [];
                    }

                    console.log(`Castells: remate ${auctionId} — scan: [${uncached.join(',')}] | refresh: [${cachedWithMatches.join(',')}]`);

                    if (!cache.castells[auctionId]) cache.castells[auctionId] = {};
                    for (const kw of uncached) cache.castells[auctionId][kw] = [];

                    const cachedLotIds = new Set(
                        cachedWithMatches.flatMap(kw => (auctionCache[kw] || []).map(String))
                    );

                    const matchingLots = [];
                    try {
                        const lotsUrl = `https://subastascastells.com/rest/API/Remate/lotes?Remateid=${auctionId}&RemateTipo=1&Cerrado=false`;
                        const lotsRes = await axios.get(lotsUrl, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                        });

                        const lots = (lotsRes.data && lotsRes.data.data)
                            ? lotsRes.data.data
                            : (Array.isArray(lotsRes.data) ? lotsRes.data : []);

                        for (const lot of lots) {
                            const lotId = String(lot.LoteId);
                            const description = (lot.LoteDescripcion || '').toLowerCase();
                            let isMatch = false;

                            for (const kw of uncached) {
                                if (description.includes(kw)) {
                                    cache.castells[auctionId][kw].push(lotId);
                                    isMatch = true;
                                }
                            }

                            if (cachedLotIds.has(lotId)) isMatch = true;

                            if (isMatch) {
                                const isUsd = (lot.LotePrecioSalidaMonedaWF || '').toUpperCase().includes('USD');
                                const baseP = parseFloat(lot.LotePrecioSalidaValorWF || lot.LotePrecioSalida) || 0;
                                const currP = parseFloat(lot.ValorActual) || 0;
                                const maxP = Math.max(baseP, currP);
                                const maxPInPesos = isUsd ? maxP * USD_TO_PESOS : maxP;
                                if (maxPInPesos < minPricePesos) continue;

                                let rawDate = lot.LoteCierre || lot.LoteCierreWF || auction.RemateCierre || '';
                                let formattedDate = '';
                                if (rawDate) {
                                    if (rawDate.includes('/Date(')) {
                                        try {
                                            const ts = parseInt(rawDate.match(/\d+/)[0], 10);
                                            formattedDate = new Date(ts).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' });
                                        } catch(e){}
                                    } else {
                                        // Might be already formatted or parseable
                                        formattedDate = rawDate; // En Castells LoteCierreWF suele ser dd/mm/yyyy hh:mm
                                        if (formattedDate.length > 10) formattedDate = formattedDate.substring(0, 10); // just keep the date part
                                    }
                                }

                                matchingLots.push({
                                    source: 'Castells',
                                    auctionId: auction.RemateId,
                                    auctionName: auction.RemateNombre,
                                    lotId: lot.LoteId,
                                    lotNumber: lot.LoteNumero,
                                    endDate: formattedDate,
                                    description: lot.LoteDescripcion,
                                    imageUrl: lot.LoteImageUrl,
                                    url: `https://subastascastells.com/${lot.DetalleUrl}`,
                                    basePrice: lot.LotePrecioSalidaValorWF || lot.LotePrecioSalida || 0,
                                    currentPrice: lot.ValorActual || 0,
                                    currencyPrefix: lot.LotePrecioSalidaMonedaWF || 'USD'
                                });
                            }
                        }
                    } catch (e) {
                        console.error(`Castells: error procesando remate ${auctionId}:`, e.message);
                    }
                    return matchingLots;
                })
            );
            allMatchingLots.push(...auctionResults.flat());
        } else {
            console.error('Castells Error: vSUBASTASENPROGRESO no encontrado en el HTML.');
        }
    } catch (e) {
        console.error('Castells Error:', e.message);
    }
    return allMatchingLots;
}

// ─── API ──────────────────────────────────────────────────────────────────────

app.get('/api/search', async (req, res) => {
    try {
        const { keywords, minPrice } = req.query;
        if (!keywords) return res.status(400).json({ error: 'Faltan parámetros: keywords' });

        const keywordList = keywords.toLowerCase().split(/\s+/).filter(k => k).sort();
        const minPricePesos = minPrice !== undefined && minPrice !== '' ? parseFloat(minPrice) : 1000;
        const USD_TO_PESOS = 40;
        const ckFn = kw => `${kw}:${minPricePesos}`;
        const now = Date.now();

        // Separar keywords ya cacheadas de las que hay que buscar
        const cachedKeywords = keywordList.filter(kw => {
            const c = RESULT_CACHE[ckFn(kw)];
            return c && now - c.ts < RESULT_CACHE_TTL;
        });
        const uncachedKeywords = keywordList.filter(kw => !cachedKeywords.includes(kw));

        if (uncachedKeywords.length === 0) {
            const allResults = deduplicateLots(cachedKeywords.flatMap(kw => RESULT_CACHE[ckFn(kw)].results));
            console.log(`Full cache hit [${keywordList.join(', ')}] → ${allResults.length} lotes`);
            return res.json({ results: allResults });
        }

        console.log(`\nBuscando [${uncachedKeywords.join(', ')}] (cache: [${cachedKeywords.join(', ')}]) minPrice=${minPricePesos}...`);

        const [bavastroLots, castellsLots, arechagaLots, reySubastasLots, pradoLots] = await Promise.all([
            fetchBavastroLots(uncachedKeywords, minPricePesos, USD_TO_PESOS),
            fetchCastellsLots(uncachedKeywords, minPricePesos, USD_TO_PESOS),
            fetchArechagaLots(uncachedKeywords, minPricePesos, USD_TO_PESOS),
            fetchReySubastasLots(uncachedKeywords, minPricePesos, USD_TO_PESOS),
            fetchPradoRematesLots(uncachedKeywords, minPricePesos)
        ]);

        saveCache();

        const newLots = [...bavastroLots, ...castellsLots, ...arechagaLots, ...reySubastasLots, ...pradoLots];

        // Cachear cada keyword nueva por separado
        for (const kw of uncachedKeywords) {
            const kwLots = newLots.filter(lot => (lot.description || '').toLowerCase().includes(kw));
            RESULT_CACHE[ckFn(kw)] = { results: kwLots, ts: Date.now() };
        }

        // Combinar nuevos + cacheados y deduplicar
        const cachedLots = cachedKeywords.flatMap(kw => RESULT_CACHE[ckFn(kw)].results);
        const allMatchingLots = deduplicateLots([...newLots, ...cachedLots]);
        console.log(`Resultados: ${allMatchingLots.length} lotes (${uncachedKeywords.length} nuevas, ${cachedKeywords.length} del cache)`);
        res.json({ results: allMatchingLots });
    } catch (error) {
        console.error('Error in /api/search:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
