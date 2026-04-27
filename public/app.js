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
    
    // ── Visto / No Visto (localStorage) ──────────────────────────────
    const SEEN_KEY = 'buscolotes_seen_lots';
    function getSeenLots() {
        try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
        catch { return new Set(); }
    }
    function markLotsAsSeen(lots) {
        try {
            const seen = getSeenLots();
            lots.forEach(l => seen.add(`${l.source}|${l.lotId}`));
            // Limitar a 5000 entradas para no inflar el localStorage
            const arr = Array.from(seen);
            if (arr.length > 5000) arr.splice(0, arr.length - 5000);
            localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
        } catch {}
    }

    // ── Botón Back to Top ──────────────────────────────────────────────
    const backToTopBtn = document.getElementById('backToTopBtn');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
    }, { passive: true });
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

    // ── Alarma / Recordatorio ICS ──────────────────────────────────────
    const alarmModal    = document.getElementById('alarmModal');
    const alarmLotDesc  = document.getElementById('alarmLotDesc');
    const alarmDateTime = document.getElementById('alarmDateTime');
    const alarmConfirm  = document.getElementById('alarmConfirmBtn');
    const alarmAndroid  = document.getElementById('alarmAndroidBtn');
    const alarmCancel   = document.getElementById('alarmCancelBtn');
    let currentAlarmItem = null;

    // Detectar si es Android para mostrar botón de Alarma de Reloj
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid && alarmAndroid) {
        alarmAndroid.style.display = 'block';
    }

    function openAlarmModal(item) {
        currentAlarmItem = item;
        alarmLotDesc.textContent = item.description || 'Lote sin descripción';

        // Pre-fill datetime
        if (item.fullDate) {
            // fullDate es ISO: 2026-04-27T23:02:00
            alarmDateTime.value = item.fullDate.substring(0, 16);
        } else if (item.endDate) {
            const parts = item.endDate.split('/');
            if (parts.length === 3) {
                const [d, m, y] = parts;
                const year = parseInt(y) < 100 ? 2000 + parseInt(y) : parseInt(y);
                alarmDateTime.value = `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T20:00`;
            }
        } else {
            alarmDateTime.value = '';
        }
        alarmModal.style.display = 'flex';
    }

    alarmCancel.addEventListener('click', () => { alarmModal.style.display = 'none'; });
    alarmModal.addEventListener('click', (e) => { if (e.target === alarmModal) alarmModal.style.display = 'none'; });

    function padZ(n) { return String(n).padStart(2, '0'); }
    function toIcsDate(d) {
        return `${d.getUTCFullYear()}${padZ(d.getUTCMonth()+1)}${padZ(d.getUTCDate())}T${padZ(d.getUTCHours())}${padZ(d.getUTCMinutes())}00Z`;
    }

    alarmConfirm.addEventListener('click', () => {
        if (!alarmDateTime.value) { alert('Por favor ingresá la fecha y hora de cierre.'); return; }
        const closeTime = new Date(alarmDateTime.value);
        if (isNaN(closeTime)) { alert('Fecha inválida.'); return; }
        const reminderTime = new Date(closeTime.getTime() - 15 * 60 * 1000);
        const item = currentAlarmItem;
        const desc = item.description || 'Lote de subasta';
        const url  = item.url || '';
        const ics = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//BuscoLotes//Recordatorio//ES',
            'BEGIN:VEVENT',
            `UID:buscolotes-${Date.now()}@buscolotes`,
            `DTSTAMP:${toIcsDate(new Date())}`,
            `DTSTART:${toIcsDate(reminderTime)}`,
            `DTEND:${toIcsDate(closeTime)}`,
            `SUMMARY:\u2022 Cierra: ${desc.substring(0,80)}`,
            `DESCRIPTION:Ver lote: ${url}`,
            'BEGIN:VALARM',
            'TRIGGER:PT0S',
            'ACTION:DISPLAY',
            `DESCRIPTION:Recordatorio - ${desc.substring(0,60)}`,
            'END:VALARM',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\r\n');
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `recordatorio-subasta.ics`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        alarmModal.style.display = 'none';
    });

    if (alarmAndroid) {
        alarmAndroid.addEventListener('click', () => {
            if (!alarmDateTime.value) { alert('Por favor ingresá la fecha y hora de cierre.'); return; }
            const closeTime = new Date(alarmDateTime.value);
            if (isNaN(closeTime)) { alert('Fecha inválida.'); return; }
            
            // Calculamos 15 mins antes
            const alarmTime = new Date(closeTime.getTime() - 15 * 60 * 1000);
            
            const hour = alarmTime.getHours();
            const minutes = alarmTime.getMinutes();
            const message = `Lote Subasta: ${currentAlarmItem.description?.substring(0, 30) || 'Cierre'}`;
            
            // Intent para abrir el reloj en Android
            // Probamos con intent:// y duplicando los extras para mayor compatibilidad
            const intentUrl = `intent://#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${hour};i.android.intent.extra.alarm.MINUTES=${minutes};S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(message)};i.hour=${hour};i.minutes=${minutes};S.message=${encodeURIComponent(message)};B.android.intent.extra.alarm.SKIP_UI=false;end`;
            
            try {
                // Informar al usuario la hora que se va a setear (útil si el intent falla en abrir la app)
                console.log("Intent URL:", intentUrl);
                
                const a = document.createElement('a');
                a.href = intentUrl;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                // Pequeño feedback visual
                const originalText = alarmAndroid.textContent;
                alarmAndroid.textContent = '✅ Enviado';
                setTimeout(() => {
                    alarmAndroid.textContent = originalText;
                    alarmModal.style.display = 'none';
                }, 1000);
            } catch (err) {
                console.error('Error al disparar intent:', err);
                alert('No se pudo abrir la app de reloj automáticamente.');
            }
        });
    }

    function displayResults(results) {
        const seenLots = getSeenLots();
        resultsCount.textContent = `${results.length} artículos`;
        
        if (results.length === 0) {
            resultsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary);">No se encontraron artículos que coincidan con la búsqueda.</p>';
        } else {
            results.forEach(item => {
                const lotKey = `${item.source}|${item.lotId}`;
                const isNew = !seenLots.has(lotKey);
                const isRemotes = item.source && item.source.startsWith('Remotes');
                const isPrado   = item.source === 'PradoRemates';
                const noPriceInfo = (isRemotes || isPrado) && !item.basePrice && !item.currentPrice;

                const formatPrice = (val, prefix) => {
                    if (noPriceInfo) return 'Ver en sitio';
                    return (val && val > 0) ? `${prefix} ${Number(val).toLocaleString('es-UY', { minimumFractionDigits: 2 })}` : 'N/A';
                };
                
                const card = document.createElement('a');
                card.href = item.url;
                card.target = '_blank';
                card.className = 'card';
                
                const imageHtml = item.imageUrl 
                    ? `<img src="${item.imageUrl}" alt="Lote" class="card-image" loading="lazy" referrerpolicy="no-referrer">`
                    : `<div class="card-image-placeholder">Sin Foto</div>`;
                
                const sourceClassMap = { Bavastro: 'badge-bavastro', Castells: 'badge-castells', Arechaga: 'badge-arechaga', ReySubastas: 'badge-reysubastas', PradoRemates: 'badge-pradoremates' };
                const sourceClass = sourceClassMap[item.source] || 'badge-bavastro';
                
                const lotNumStr = item.lotNumber ? `Lote ${escapeHtml(item.lotNumber)}` : '';
                const endDateStr = item.endDate ? ` | Termina: ${escapeHtml(item.endDate)}` : '';
                
                const newBadgeHtml = isNew ? `<div class="new-badge">✨ NUEVO</div>` : '';
                
                card.innerHTML = `
                    ${newBadgeHtml}
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

                // Botón de alarma (fuera del <a> para no seguir link)
                const alarmBtn = document.createElement('button');
                alarmBtn.className = 'alarm-trigger-btn';
                alarmBtn.title = 'Agregar recordatorio 15 min antes del cierre';
                alarmBtn.textContent = '🔔';
                alarmBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openAlarmModal(item);
                });
                card.appendChild(alarmBtn);
                
                resultsGrid.appendChild(card);
            });
            // Marcar todos los lotes como vistos en localStorage
            markLotsAsSeen(results);
        }
        
        resultsSec.classList.remove('hidden');
    }
    

});
