document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('searchForm');
    const keywordsInput = document.getElementById('keywords');
    const minPriceInput = document.getElementById('minPrice');

    const btnSelectAllTags = document.getElementById('btnSelectAllTags');
    const btnClearTags = document.getElementById('btnClearTags');

    if (btnSelectAllTags) {
        btnSelectAllTags.addEventListener('click', () => {
            const allWords = Array.from(document.querySelectorAll('.tag-chip')).map(chip => chip.dataset.word);
            
            // Reemplazar el input pero asegurando que estén entre comillas dobles los que tienen espacios (Art Deco), no es necesario en este contexto porque se separan por espacio las búsquedas simples, pero para que no rompa, lo pasamos tal cual. NOTA: el backend parsea por split(/\s+/) con que si hay Art Deco se buscará Art y Deco. Para evitarlo mantendremos Art Deco... Espera, el servidor busca con regex split.
            // Ojo, si el usuario tiene palabras en el input previas podrian combinarse.
            keywordsInput.value = allWords.join(' ');
            document.querySelectorAll('.tag-chip').forEach(chip => chip.classList.add('active'));
        });
    }

    if (btnClearTags) {
        btnClearTags.addEventListener('click', () => {
            keywordsInput.value = '';
            document.querySelectorAll('.tag-chip').forEach(chip => chip.classList.remove('active'));
        });
    }

    // Tag chips: clicking toggles a word in the keywords input
    document.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const word = chip.dataset.word;
            const current = keywordsInput.value.trim();
            const words = current ? current.split(/\s+/) : [];
            
            if (words.includes(word)) {
                // Remove word
                keywordsInput.value = words.filter(w => w !== word).join(' ');
                chip.classList.remove('active');
            } else {
                // Add word
                keywordsInput.value = current ? current + ' ' + word : word;
                chip.classList.add('active');
            }
        });
    });

    // Sync chip active state when user types manually
    keywordsInput.addEventListener('input', () => {
        const words = keywordsInput.value.split(/\s+/);
        document.querySelectorAll('.tag-chip').forEach(chip => {
            chip.classList.toggle('active', words.includes(chip.dataset.word));
        });
    });

    const loadingSec = document.getElementById('loadingSection');
    const errorSec = document.getElementById('errorSection');
    const errorMsg = document.getElementById('errorMessage');
    const resultsSec = document.getElementById('resultsSection');
    const resultsGrid = document.getElementById('resultsGrid');
    const resultsCount = document.getElementById('resultsCount');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const keywords = keywordsInput.value.trim();
        const minPrice = parseFloat(minPriceInput.value) || 1000;
        
        if (!keywords) return;
        
        // UI state: loading
        errorSec.classList.add('hidden');
        resultsSec.classList.add('hidden');
        loadingSec.classList.remove('hidden');
        resultsGrid.innerHTML = '';
        
        try {
            const queryParams = new URLSearchParams({
                keywords: keywords,
                minPrice: minPrice
            }).toString();

            const response = await fetch(`/api/search?${queryParams}`);
            const data = await response.json();
            
            loadingSec.classList.add('hidden');
            
            if (!response.ok) {
                throw new Error(data.error || 'Error al buscar artículos');
            }
            
            displayResults(data.results);
            
        } catch (error) {
            loadingSec.classList.add('hidden');
            errorMsg.textContent = error.message;
            errorSec.classList.remove('hidden');
        }
    });
    
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    function displayResults(results) {
        resultsCount.textContent = `${results.length} artículos`;
        
        if (results.length === 0) {
            resultsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">No se encontraron artículos que coincidan con la búsqueda.</p>';
        } else {
            results.forEach(item => {
                const formatPrice = (val, prefix) => val ? `${prefix} ${Number(val).toLocaleString('es-UY', { minimumFractionDigits: 2 })}` : 'N/A';
                
                const card = document.createElement('a');
                card.href = item.url;
                card.target = '_blank';
                card.className = 'card';
                
                const imageHtml = item.imageUrl 
                    ? `<img src="${item.imageUrl}" alt="Lote" class="card-image" loading="lazy">`
                    : `<div class="card-image-placeholder">Sin Foto</div>`;
                
                const sourceClassMap = { Bavastro: 'badge-bavastro', Castells: 'badge-castells', Arechaga: 'badge-arechaga', ReySubastas: 'badge-reysubastas', PradoRemates: 'badge-pradoremates' };
                const sourceClass = sourceClassMap[item.source] || 'badge-bavastro';
                
                const lotNumStr = item.lotNumber ? `Lote ${escapeHtml(item.lotNumber)}` : '';
                const endDateStr = item.endDate ? ` | Termina: ${escapeHtml(item.endDate)}` : '';
                
                card.innerHTML = `
                    <div class="source-badge ${sourceClass}">${item.source}</div>
                    ${imageHtml}
                    <div class="card-content">
                        <div class="card-auction">Remate ${item.auctionId}${endDateStr}</div>
                        ${lotNumStr ? `<div class="card-lot-number" style="font-weight: 500; font-size: 0.9rem; margin-bottom: 0.2rem;">${lotNumStr}</div>` : ''}
                        <div class="card-desc">${escapeHtml(item.description)}</div>
                        <div class="card-footer">
                            <div>
                                <div class="card-price-label">Precio Base</div>
                                <div class="card-price-value" style="color: var(--text-primary); font-size: 1rem;">${formatPrice(item.basePrice, item.currencyPrefix)}</div>
                            </div>
                            <div style="text-align: right;">
                                <div class="card-price-label">Mejor Precio</div>
                                <div class="card-price-value">${formatPrice(item.currentPrice, item.currencyPrefix)}</div>
                            </div>
                        </div>
                    </div>
                `;
                
                resultsGrid.appendChild(card);
            });
        }
        
        resultsSec.classList.remove('hidden');
    }
    

});
