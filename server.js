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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

async function fetchBavastroLots(keywordList, minPricePesos, USD_TO_PESOS) {
    const allMatchingLots = [];
    try {
        console.log('Fetching active auctions list from Bavastro...');
        const auctionsUrl = 'https://api-parseo.bavastronline.com/published_auctions/?limit=100';
        const auctionsRes = await axios.get(auctionsUrl);
        const activeAuctions = (auctionsRes.data.results || []).filter(a => a.state === 'active' || a.active === true);
        
        for (const auction of activeAuctions) {
            const auctionId = auction.id;
            try {
                let page = 1;
                let hasMore = true;
                
                while (hasMore) {
                    const lotsUrl = `https://api-parseo.bavastronline.com/auctions/${auctionId}/lots/published/?page=${page}&sort=lot_number&page_size=100`;
                    const lotsRes = await axios.get(lotsUrl);
                    const lots = lotsRes.data.results || [];
                    
                    if (lots.length === 0) {
                        hasMore = false;
                        break;
                    }

                    for (const lotItem of lots) {
                        const description = (lotItem.lot.description || '').toLowerCase();
                        const matchesKeyword = keywordList.some(kw => description.includes(kw));
                        
                        if (matchesKeyword) {
                            let imageUrl = '';
                            if (lotItem.lot.images && lotItem.lot.images.length > 0) {
                                imageUrl = lotItem.lot.images[0].image;
                            }
                            
                            const currencyPrefix = lotItem.lot.currency ? lotItem.lot.currency.prefix : '$';
                            const isUsd = currencyPrefix && currencyPrefix.toUpperCase().includes('USD');
                            const baseP = parseFloat(lotItem.lot.base_price) || 0;
                            const currP = parseFloat(lotItem.best_price) || 0;
                            const maxP = Math.max(baseP, currP);
                            const maxPInPesos = isUsd ? maxP * USD_TO_PESOS : maxP;
                            
                            if (maxPInPesos < minPricePesos) continue;
                            
                            allMatchingLots.push({
                                source: 'Bavastro',
                                auctionId: auctionId,
                                auctionName: lotItem.lot.auction.name,
                                lotId: lotItem.id,
                                description: lotItem.lot.description,
                                imageUrl: imageUrl,
                                url: `https://www.bavastronline.com.uy/lot/${lotItem.id}`,
                                basePrice: lotItem.lot.base_price,
                                currentPrice: lotItem.best_price,
                                currencyPrefix: currencyPrefix
                            });
                        }
                    }

                    if (lotsRes.data.next) {
                        page++;
                    } else {
                        hasMore = false;
                    }
                }
            } catch (err) {
                console.error(`Bavastro: Error procesando remate ${auctionId}:`, err.message);
            }
        }
    } catch (error) {
        console.error('Bavastro Error:', error.message);
    }
    return allMatchingLots;
}

async function fetchArechagaLots(keywordList, minPricePesos, USD_TO_PESOS) {
    const allMatchingLots = [];
    try {
        console.log('Fetching active auctions list from Arechaga...');
        const auctionsRes = await axios.get('https://api.arechaga.com.uy/public/auctions/');
        const activeAuctions = (auctionsRes.data.data && auctionsRes.data.data.inProgress) || [];

        for (const auction of activeAuctions) {
            const auctionId = auction.id;
            const isUsd = auction.money === 2;
            try {
                const auctionRes = await axios.get(`https://api.arechaga.com.uy/public/auctions/${auctionId}`);
                const lots = (auctionRes.data.data && auctionRes.data.data.lots) || [];

                for (const lot of lots) {
                    const titleText = (lot.title || '').toLowerCase();
                    const descText = (lot.description || '').toLowerCase();
                    const matchesKeyword = keywordList.some(kw => titleText.includes(kw) || descText.includes(kw));

                    if (matchesKeyword) {
                        const baseP = parseFloat(lot.price_base) || 0;
                        const currP = parseFloat(lot.offer) || parseFloat(lot.bestOffer) || 0;
                        const maxP = Math.max(baseP, currP);
                        const maxPInPesos = isUsd ? maxP * USD_TO_PESOS : maxP;

                        if (maxPInPesos < minPricePesos) continue;

                        allMatchingLots.push({
                            source: 'Arechaga',
                            auctionId: auctionId,
                            auctionName: auction.title,
                            lotId: lot.id,
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
                console.error(`Arechaga: Error procesando remate ${auctionId}:`, err.message);
            }
        }
    } catch (error) {
        console.error('Arechaga Error:', error.message);
    }
    return allMatchingLots;
}

async function fetchCastellsLots(keywordList, minPricePesos, USD_TO_PESOS) {
    const allMatchingLots = [];
    try {
        console.log('Fetching active auctions list from Castells...');
        const homeRes = await axios.get('https://subastascastells.com/frontend.home.aspx', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const html = homeRes.data;
        const match = html.match(/"vSUBASTASENPROGRESO":(\[.+?\])/);
        
        if (match && match[1]) {
            const activeAuctions = JSON.parse(match[1]);
            
            for (const auction of activeAuctions) {
                if (!auction.RemateId) continue;
                const testId = auction.RemateId;
                try {
                    const lotsUrl = `https://subastascastells.com/rest/API/Remate/lotes?Remateid=${testId}&RemateTipo=1&Cerrado=false`;
                    const lotsRes = await axios.get(lotsUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    const lots = (lotsRes.data && lotsRes.data.data) ? lotsRes.data.data : (Array.isArray(lotsRes.data) ? lotsRes.data : []);
                    for (const lot of lots) {
                        const description = (lot.LoteDescripcion || '').toLowerCase();
                        const matchesKeyword = keywordList.some(kw => description.includes(kw));
                        
                        if (matchesKeyword) {
                            const isUsd = (lot.LotePrecioSalidaMonedaWF || '').toUpperCase().includes('USD');
                            const baseP = parseFloat(lot.LotePrecioSalidaValorWF || lot.LotePrecioSalida) || 0;
                            const currP = parseFloat(lot.ValorActual) || 0;
                            const maxP = Math.max(baseP, currP);
                            const maxPInPesos = isUsd ? maxP * USD_TO_PESOS : maxP;
                            if (maxPInPesos < minPricePesos) continue;
                            
                            allMatchingLots.push({
                                source: 'Castells',
                                auctionId: auction.RemateId,
                                auctionName: auction.RemateNombre,
                                lotId: lot.LoteId,
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
                    console.error(`Castells: Error procesando remate ${testId}:`, e.message);
                }
            }
        } else {
             console.error('Castells Error: vSUBASTASENPROGRESO no encontrado en el HTML.');
        }
    } catch (e) {
        console.error('Castells Error:', e.message);
    }
    return allMatchingLots;
}

// API route to search auctions
app.get('/api/search', async (req, res) => {
    try {
        const { keywords, minPrice } = req.query;
        
        if (!keywords) {
            return res.status(400).json({ error: 'Faltan parámetros: keywords' });
        }

        const keywordList = keywords.toLowerCase().split(/\s+/).filter(k => k);
        // minPrice default 1000 pesos; USD 25 = 1000 pesos
        const minPricePesos = minPrice !== undefined && minPrice !== '' ? parseFloat(minPrice) : 1000;
        const USD_TO_PESOS = 40;
        console.log(`Searching for [${keywordList.join(', ')}] with minPrice=${minPricePesos} pesos in multiple sources...`);

        const [bavastroLots, castellsLots, arechagaLots] = await Promise.all([
            fetchBavastroLots(keywordList, minPricePesos, USD_TO_PESOS),
            fetchCastellsLots(keywordList, minPricePesos, USD_TO_PESOS),
            fetchArechagaLots(keywordList, minPricePesos, USD_TO_PESOS)
        ]);

        // Unify
        const allMatchingLots = [...bavastroLots, ...castellsLots, ...arechagaLots];
        res.json({ results: allMatchingLots });
    } catch (error) {
        console.error('Error in /api/search:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
