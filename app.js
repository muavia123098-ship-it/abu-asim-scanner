/* ==========================================================================
   Karachi Green Line BRT - Smart QR Ticket & Reusable Card System
   Native Browser Camera Permission Prompt & PWA Install Auto-Hide Fix
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ----------------------------------------------------------------------
    // 1. PWA INSTALL BUTTON HANDLER (PERMANENT AUTO-HIDE ONCE INSTALLED)
    // ----------------------------------------------------------------------
    let deferredPrompt = null;
    const btnInstallPwa = document.getElementById('btn-install-pwa');

    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                             window.navigator.standalone === true || 
                             document.referrer.includes('android-app://');

    // Auto-hide button if app is installed or recorded as installed
    if (isStandaloneMode || localStorage.getItem('pwa_app_installed') === 'true') {
        if (btnInstallPwa) {
            btnInstallPwa.classList.add('hidden');
            btnInstallPwa.style.display = 'none';
        }
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (btnInstallPwa && !isStandaloneMode && localStorage.getItem('pwa_app_installed') !== 'true') {
            btnInstallPwa.classList.remove('hidden');
            btnInstallPwa.style.display = 'inline-flex';
        }
    });

    if (btnInstallPwa) {
        btnInstallPwa.addEventListener('click', async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    localStorage.setItem('pwa_app_installed', 'true');
                }
                deferredPrompt = null;
                btnInstallPwa.classList.add('hidden');
                btnInstallPwa.style.display = 'none';
            } else {
                localStorage.setItem('pwa_app_installed', 'true');
                btnInstallPwa.classList.add('hidden');
                btnInstallPwa.style.display = 'none';
            }
        });
    }

    window.addEventListener('appinstalled', () => {
        localStorage.setItem('pwa_app_installed', 'true');
        if (btnInstallPwa) {
            btnInstallPwa.classList.add('hidden');
            btnInstallPwa.style.display = 'none';
        }
        console.log('🟢 PWA App Installed Successfully!');
    });

    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => console.log('Audio resume error:', e));
        }
        return audioCtx;
    }

    window.addEventListener('touchstart', () => getAudioContext(), { once: true });
    window.addEventListener('click', () => getAudioContext(), { once: true });

    // ----------------------------------------------------------------------
    // 2. FIREBASE CONFIGURATION & FAIL-SAFE DUAL CLOUD ENGINE
    // ----------------------------------------------------------------------
    const firebaseConfig = {
        apiKey: "AIzaSyAVuxdQ-k8pZyy2PnoTwBG3XEpAt2-cLsc",
        authDomain: "greenline-system.firebaseapp.com",
        projectId: "greenline-system",
        storageBucket: "greenline-system.firebasestorage.app",
        messagingSenderId: "639566437448",
        appId: "1:639566437448:web:ed646713ae76f0ff3b0c7d"
    };

    const PUBLIC_CLOUD_ENDPOINT = "https://greenline-system-default-rtdb.firebaseio.com/cards.json";

    let db = null;
    let isCloudOnline = false;

    if (typeof firebase !== 'undefined') {
        try {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            isCloudOnline = true;
            console.log("🟢 Firebase App Initialized!");
        } catch (e) {
            console.warn("Firebase init info:", e);
        }
    }

    const FARE_PER_SCAN = 25;

    let state = {
        cards: [],
        revenue: 0,
        gateMode: 'ENTRY',
        activeView: 'GUARD',
        activeAdminTab: 'dash',
        scannerActive: false,
        rechargeScannerActive: false,
        lastScanTime: 0,
        activeCardId: null,
        rechargeTargetCardId: null,
        adminPin: localStorage.getItem('gl_admin_pin') || '1234'
    };

    let html5QrCodeGuard = null;
    let html5QrCodeRecharge = null;

    function initStore() {
        loadLocalStorageBackup();

        if (isCloudOnline && db) {
            try {
                db.collection("cards").onSnapshot((snapshot) => {
                    const cloudCards = [];
                    let calcRevenue = 0;

                    snapshot.forEach((doc) => {
                        const data = doc.data();
                        cloudCards.push(data);
                        if (typeof data.initialBalance === 'number') calcRevenue += data.initialBalance;
                    });

                    if (cloudCards.length > 0) {
                        mergeAndRenderCards(cloudCards);
                    }
                }, (error) => {
                    console.warn("Firestore notice, loading REST fallback:", error);
                });
            } catch (err) {
                console.warn("Firestore error:", err);
            }
        }

        startCloudRestPoller();
    }

    function startCloudRestPoller() {
        fetchCloudRestData();
        setInterval(fetchCloudRestData, 2500);
    }

    function fetchCloudRestData() {
        fetch(PUBLIC_CLOUD_ENDPOINT)
            .then(res => res.json())
            .then(data => {
                if (data && typeof data === 'object') {
                    const cloudCards = Object.values(data);
                    if (cloudCards.length > 0) {
                        mergeAndRenderCards(cloudCards);
                    }
                }
            })
            .catch(err => console.log("Cloud REST fetch info:", err));
    }

    function mergeAndRenderCards(cloudCards) {
        const map = new Map();
        state.cards.forEach(c => map.set(c.id, c));
        cloudCards.forEach(c => map.set(c.id, c));

        state.cards = Array.from(map.values());
        
        let calcRev = 0;
        state.cards.forEach(c => {
            const val = typeof c.initialBalance === 'number' ? c.initialBalance : c.balance;
            calcRev += (typeof val === 'number' ? val : 0);
        });
        state.revenue = calcRev;

        saveLocalStorageBackup();
        renderApp();
    }

    function loadLocalStorageBackup() {
        const savedCards = localStorage.getItem('gl_cards_db');
        const savedRevenue = localStorage.getItem('gl_revenue');

        if (savedCards) {
            state.cards = JSON.parse(savedCards);
        } else {
            state.cards = [];
        }

        if (savedRevenue) {
            state.revenue = parseFloat(savedRevenue);
        }
        renderApp();
    }

    function saveLocalStorageBackup() {
        localStorage.setItem('gl_cards_db', JSON.stringify(state.cards));
        localStorage.setItem('gl_revenue', state.revenue.toString());
    }

    function syncCardToCloud(card) {
        saveLocalStorageBackup();
        
        if (isCloudOnline && db) {
            db.collection("cards").doc(card.id).set(card, { merge: true })
                .then(() => console.log(`Firestore Synced: ${card.id}`))
                .catch(err => console.warn("Firestore info:", err));
        }

        fetch(`https://greenline-system-default-rtdb.firebaseio.com/cards/${card.id}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(card)
        }).then(() => console.log(`REST Cloud Synced: ${card.id}`))
        .catch(err => console.log("REST Sync Error:", err));
    }

    // ----------------------------------------------------------------------
    // 3. SOUND SYNTHESIZER
    // ----------------------------------------------------------------------
    function playGrantedSound() {
        try {
            const ctx = getAudioContext();
            const now = ctx.currentTime;
            
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();

            osc1.type = 'sine';
            osc2.type = 'sine';

            osc1.frequency.setValueAtTime(523.25, now);
            osc1.frequency.setValueAtTime(659.25, now + 0.12);

            osc2.frequency.setValueAtTime(1046.50, now);
            osc2.frequency.setValueAtTime(1318.51, now + 0.12);

            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);

            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.45);
            osc2.stop(now + 0.45);
        } catch (e) {
            console.log('Audio playback prevented:', e);
        }
    }

    function playDeniedAlarmSound() {
        try {
            const ctx = getAudioContext();
            const now = ctx.currentTime;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sawtooth';

            for (let i = 0; i < 6; i++) {
                osc.frequency.setValueAtTime(850, now + (i * 0.15));
                osc.frequency.setValueAtTime(450, now + (i * 0.15) + 0.075);
            }

            gain.gain.setValueAtTime(0.4, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 1.0);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 1.0);
        } catch (e) {
            console.log('Audio playback prevented:', e);
        }
    }

    // ----------------------------------------------------------------------
    // 4. QR CODE GENERATOR UTILITY
    // ----------------------------------------------------------------------
    function generateQRCode(elementId, textData, size = 100) {
        const container = document.getElementById(elementId);
        if (!container) return;
        container.innerHTML = '';

        if (typeof QRCode !== 'undefined') {
            new QRCode(container, {
                text: textData,
                width: size,
                height: size,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        } else {
            container.innerHTML = `<div style="padding:8px; background:#fff; color:#000; font-size:9px; word-break:break-all; text-align:center;"><b>${textData}</b></div>`;
        }
    }

    // ----------------------------------------------------------------------
    // 5. GUARD SCANNER CORE LOGIC
    // ----------------------------------------------------------------------
    function processGuardScan(rawText) {
        if (!rawText) return;

        const now = Date.now();
        if (now - state.lastScanTime < 600) return;
        state.lastScanTime = now;

        const cardId = rawText.trim();
        console.log("Scanned QR Code Text:", cardId);

        const card = state.cards.find(c => c.id.toUpperCase() === cardId.toUpperCase());

        if (!card) {
            triggerSignalResult(false, 'INVALID / UNREGISTERED QR', `QR Code "${cardId}" System DB Mein Register Nahi Hai!`);
            addScanHistoryLog(cardId, 'Unknown', 'DENIED - UNREGISTERED', 0);
            return;
        }

        const currentBalance = typeof card.balance === 'number' ? card.balance : 0;

        if (state.gateMode === 'ENTRY') {
            if (card.status === 'IN_TRANSIT') {
                triggerSignalResult(false, 'ALREADY INSIDE', `${card.name} Pehle Se Station Ke Andar Hai! Exit Gate Scan Karein.`);
                addScanHistoryLog(card.id, card.name, 'DENIED - ALREADY IN', 0);
                return;
            }

            if (currentBalance < FARE_PER_SCAN) {
                triggerSignalResult(false, 'INSUFFICIENT BALANCE 🔴', `${card.name} Ka Balance Kam Hai! Current: Rs. ${currentBalance}`);
                addScanHistoryLog(card.id, card.name, 'DENIED - LOW BALANCE', currentBalance);
                return;
            }

            // SUCCESS ENTRY 🟢
            card.balance = currentBalance - FARE_PER_SCAN;
            card.status = 'IN_TRANSIT';
            
            syncCardToCloud(card);
            renderApp();

            triggerSignalResult(true, 'ENTRY GRANTED 🟢', `Fare Deducted: Rs. ${FARE_PER_SCAN} | Remaining Balance: Rs. ${card.balance}`, card.name);
            addScanHistoryLog(card.id, card.name, 'GRANTED (ENTRY)', FARE_PER_SCAN);

        } else {
            if (card.status !== 'IN_TRANSIT') {
                triggerSignalResult(false, 'NO ENTRY RECORD', `${card.name} Ka Entry Record Nahi Mila!`);
                addScanHistoryLog(card.id, card.name, 'DENIED - NO ENTRY LOG', 0);
                return;
            }

            if (currentBalance < FARE_PER_SCAN) {
                triggerSignalResult(false, 'INSUFFICIENT FARE', `${card.name} Ka Remaining Exit Fare Kam Hai! Balance: Rs. ${currentBalance}`);
                addScanHistoryLog(card.id, card.name, 'DENIED - LOW EXIT BALANCE', currentBalance);
                return;
            }

            // SUCCESS EXIT 🟢
            card.balance = currentBalance - FARE_PER_SCAN;
            card.status = 'COMPLETED';

            syncCardToCloud(card);
            renderApp();

            triggerSignalResult(true, 'EXIT CLEARED 🟢', `Journey Complete | Final Fare Deducted: Rs. ${FARE_PER_SCAN} | Remaining: Rs. ${card.balance}`, card.name);
            addScanHistoryLog(card.id, card.name, 'GRANTED (EXIT)', FARE_PER_SCAN);
        }
    }

    function triggerSignalResult(isSuccess, title, msg, cardUser = '') {
        const overlay = document.getElementById('signal-overlay');
        const iconEl = document.getElementById('signal-icon');
        const titleEl = document.getElementById('signal-title');
        const msgEl = document.getElementById('signal-msg');
        const infoEl = document.getElementById('signal-card-info');

        overlay.className = 'signal-overlay';

        if (isSuccess) {
            overlay.classList.add('signal-granted');
            iconEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            playGrantedSound();
        } else {
            overlay.classList.add('signal-denied');
            iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
            playDeniedAlarmSound();
        }

        titleEl.textContent = title;
        msgEl.textContent = msg;
        infoEl.textContent = cardUser ? `Passenger: ${cardUser}` : '';

        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 1600);
    }

    function addScanHistoryLog(cardId, name, resultText, fare) {
        const historyList = document.getElementById('scan-history-list');
        if (!historyList) return;

        const isGranted = resultText.includes('GRANTED');
        const timeStr = new Date().toLocaleTimeString();

        const logItem = document.createElement('div');
        logItem.className = `history-item ${isGranted ? 'status-granted' : 'status-denied'}`;
        logItem.innerHTML = `
            <div>
                <strong>${name}</strong> (${cardId})
                <br><span style="font-size:0.75rem; color:#aaa;">${state.gateMode} • ${resultText}</span>
            </div>
            <div style="text-align:right;">
                <span style="font-weight:700; color:${isGranted ? '#00e676' : '#ff1744'};">${fare > 0 ? '-Rs. ' + fare : 'Rs. 0'}</span>
                <br><span style="font-size:0.7rem; color:#8e9bb0;">${timeStr}</span>
            </div>
        `;

        if (historyList.querySelector('.empty-state')) {
            historyList.innerHTML = '';
        }

        historyList.prepend(logItem);
    }

    // ----------------------------------------------------------------------
    // 6. NATIVE BROWSER CAMERA PERMISSION & FAST SCANNING ENGINE
    // ----------------------------------------------------------------------
    async function startGuardCameraScanner() {
        try {
            // Explicitly request native browser camera permission prompt directly!
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" } }
                });
                // Stop temporary track once permission is granted so Html5Qrcode can bind
                stream.getTracks().forEach(track => track.stop());
            }

            if (typeof Html5Qrcode === 'undefined') return;

            if (!html5QrCodeGuard) {
                html5QrCodeGuard = new Html5Qrcode("reader", {
                    experimentalFeatures: {
                        useBarCodeDetectorIfSupported: true
                    }
                });
            }

            const cameraConfig = {
                fps: 40,
                disableFlip: false
            };

            const videoConstraints = {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 },
                focusMode: { ideal: "continuous" }
            };

            await html5QrCodeGuard.start(
                videoConstraints,
                cameraConfig,
                (decodedText) => processGuardScan(decodedText),
                (err) => {}
            );

            state.scannerActive = true;
            document.getElementById('btn-start-camera').classList.add('hidden');
            document.getElementById('btn-stop-camera').classList.remove('hidden');

            try {
                const track = html5QrCodeGuard.getRunningTrackCapabilities();
                if (track && track.focusMode && track.focusMode.includes('continuous')) {
                    html5QrCodeGuard.applyVideoConstraints({
                        advanced: [{ focusMode: 'continuous' }]
                    }).catch(e => {});
                }
            } catch(e) {}

        } catch (err) {
            console.error("Camera getUserMedia error:", err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                alert('🎥 CAMERA PERMISSION BLOCKED!\n\nBrowser Address Bar par bana LOCK 🔒 / TUNE icon click karke Camera Permission Ko "ALLOW" karein aur page reload karein.');
            } else {
                alert(`Camera Settings Alert: Browser me Camera permission allow karein (${err.message || 'Not Allowed'})`);
            }
        }
    }

    function stopGuardCameraScanner() {
        if (html5QrCodeGuard && state.scannerActive) {
            html5QrCodeGuard.stop().then(() => {
                state.scannerActive = false;
                document.getElementById('btn-start-camera').classList.remove('hidden');
                document.getElementById('btn-stop-camera').classList.add('hidden');
            }).catch(err => {});
        }
    }

    async function startRechargeCameraScanner() {
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" } }
                });
                stream.getTracks().forEach(track => track.stop());
            }

            if (typeof Html5Qrcode === 'undefined') return;

            if (!html5QrCodeRecharge) {
                html5QrCodeRecharge = new Html5Qrcode("recharge-reader", {
                    experimentalFeatures: {
                        useBarCodeDetectorIfSupported: true
                    }
                });
            }

            const cameraConfig = {
                fps: 40,
                disableFlip: false
            };

            const videoConstraints = {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 },
                focusMode: { ideal: "continuous" }
            };

            await html5QrCodeRecharge.start(
                videoConstraints,
                cameraConfig,
                (decodedText) => {
                    fetchCardForRecharge(decodedText);
                    playGrantedSound();
                },
                (err) => {}
            );

            state.rechargeScannerActive = true;
            document.getElementById('btn-recharge-camera-start').classList.add('hidden');
            document.getElementById('btn-recharge-camera-stop').classList.remove('hidden');

        } catch (err) {
            console.error("Recharge Camera Error:", err);
            alert('🎥 Browser Address Bar ke LOCK 🔒 icon se Camera Allow karein.');
        }
    }

    function stopRechargeCameraScanner() {
        if (html5QrCodeRecharge && state.rechargeScannerActive) {
            html5QrCodeRecharge.stop().then(() => {
                state.rechargeScannerActive = false;
                document.getElementById('btn-recharge-camera-start').classList.remove('hidden');
                document.getElementById('btn-recharge-camera-stop').classList.add('hidden');
            }).catch(err => {});
        }
    }

    // ----------------------------------------------------------------------
    // 7. DEDICATED RECHARGE TOOL LOGIC
    // ----------------------------------------------------------------------
    function fetchCardForRecharge(cardId) {
        if (!cardId) {
            document.getElementById('recharge-card-result').classList.add('hidden');
            return;
        }

        const card = state.cards.find(c => c.id.toUpperCase() === cardId.trim().toUpperCase());
        const resultContainer = document.getElementById('recharge-card-result');

        if (!card) {
            alert(`❌ Card ID "${cardId}" System Database Mein Nahi Mil Saka!`);
            resultContainer.classList.add('hidden');
            return;
        }

        state.rechargeTargetCardId = card.id;

        const realBal = typeof card.balance === 'number' ? card.balance : 0;

        document.getElementById('rc-name').textContent = card.name;
        document.getElementById('rc-id').textContent = card.id;
        document.getElementById('rc-phone').textContent = card.phone;
        document.getElementById('rc-balance').textContent = `Rs. ${realBal}`;

        resultContainer.classList.remove('hidden');
    }

    document.getElementById('btn-confirm-recharge').addEventListener('click', () => {
        if (!state.rechargeTargetCardId) return;

        const amountInput = document.getElementById('recharge-amount-input');
        const amount = parseFloat(amountInput.value);

        if (isNaN(amount) || amount <= 0) {
            alert('Sahi Recharge Amount enter karein.');
            return;
        }

        const card = state.cards.find(c => c.id === state.rechargeTargetCardId);
        if (card) {
            const currentBal = typeof card.balance === 'number' ? card.balance : 0;
            card.balance = currentBal + amount;
            card.initialBalance = (card.initialBalance || 0) + amount;
            
            syncCardToCloud(card);
            playGrantedSound();

            document.getElementById('rc-balance').textContent = `Rs. ${card.balance}`;
            alert(`⚡ RECHARGE SUCCESSFUL!\nPassenger: ${card.name}\nNaya Balance: Rs. ${card.balance}`);
        }
    });

    document.getElementById('btn-recharge-search-id').addEventListener('click', () => {
        const idVal = document.getElementById('recharge-search-id').value;
        if (idVal) fetchCardForRecharge(idVal);
    });

    document.getElementById('recharge-select-card').addEventListener('change', (e) => {
        if (e.target.value) {
            fetchCardForRecharge(e.target.value);
        } else {
            document.getElementById('recharge-card-result').classList.add('hidden');
        }
    });

    // ----------------------------------------------------------------------
    // 8. UI RENDER & SIDEBAR ROUTER
    // ----------------------------------------------------------------------
    function renderApp() {
        // Stats
        document.getElementById('stat-total-cards').textContent = state.cards.length;
        
        let totalRevenue = 0;
        state.cards.forEach(c => {
            const val = typeof c.initialBalance === 'number' ? c.initialBalance : c.balance;
            totalRevenue += (typeof val === 'number' ? val : 0);
        });
        document.getElementById('stat-total-revenue').textContent = `Rs. ${totalRevenue}`;
        
        const inTransitCount = state.cards.filter(c => c.status === 'IN_TRANSIT').length;
        document.getElementById('stat-in-transit').textContent = inTransitCount;

        // Recharge Select Dropdown
        const rechargeSelect = document.getElementById('recharge-select-card');
        if (rechargeSelect) {
            const selectedVal = rechargeSelect.value;
            rechargeSelect.innerHTML = '<option value="">-- Card Select Karein --</option>' +
                state.cards.map(c => {
                    const bal = typeof c.balance === 'number' ? c.balance : 0;
                    return `<option value="${c.id}">${c.name} (${c.id}) - Balance: Rs. ${bal}</option>`;
                }).join('');
            
            if (selectedVal) rechargeSelect.value = selectedVal;
        }

        // Update active target recharge card balance if currently visible
        if (state.rechargeTargetCardId && !document.getElementById('recharge-card-result').classList.contains('hidden')) {
            const activeRechargeCard = state.cards.find(c => c.id === state.rechargeTargetCardId);
            if (activeRechargeCard) {
                const realBal = typeof activeRechargeCard.balance === 'number' ? activeRechargeCard.balance : 0;
                document.getElementById('rc-balance').textContent = `Rs. ${realBal}`;
            }
        }

        // Render Cards Gallery
        const galleryGrid = document.getElementById('qr-gallery-grid');
        if (galleryGrid) {
            if (state.cards.length === 0) {
                galleryGrid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:30px; color:#8e9bb0;">Abhi tak koi card issue nahi hua. "Issue New Card" tab par ja kar naya card banayein!</div>`;
            } else {
                galleryGrid.innerHTML = state.cards.map(c => {
                    const bal = typeof c.balance === 'number' ? c.balance : 0;
                    return `
                        <div class="gallery-card-item">
                            <div class="gallery-qr-wrapper" id="gallery-qr-${c.id}"></div>
                            <div class="gallery-card-details">
                                <h4>${c.name}</h4>
                                <p>ID: <strong>${c.id}</strong></p>
                                <span class="bal-badge" style="color: ${bal >= FARE_PER_SCAN ? '#00e676' : '#ff1744'};">
                                    Balance: Rs. ${bal}
                                </span>
                            </div>
                        </div>
                    `;
                }).join('');

                state.cards.forEach(c => {
                    generateQRCode(`gallery-qr-${c.id}`, c.id, 140);
                });
            }
        }

        // Database Table Body
        const tbody = document.getElementById('cards-table-body');
        if (tbody) {
            if (state.cards.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#8e9bb0; padding:20px;">System DB Mein Koi Record Nahi Hai. Pehla card banayein!</td></tr>`;
            } else {
                tbody.innerHTML = state.cards.map(c => {
                    const bal = typeof c.balance === 'number' ? c.balance : 0;
                    return `
                        <tr>
                            <td><strong>${c.id}</strong></td>
                            <td>${c.name}</td>
                            <td>${c.phone}</td>
                            <td><strong style="color:#00e676;">Rs. ${bal}</strong></td>
                            <td>
                                <span class="status-badge ${c.status === 'IN_TRANSIT' ? 'status-transit' : 'status-active'}">
                                    ${c.status === 'IN_TRANSIT' ? 'IN TRANSIT 🚌' : 'COMPLETED ✅'}
                                </span>
                            </td>
                            <td>
                                <button class="btn btn-outline btn-view-card" data-card-id="${c.id}" style="padding:4px 10px; font-size:0.75rem;">
                                    <i class="fa-solid fa-qrcode"></i> View Card
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');

                tbody.querySelectorAll('.btn-view-card').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const id = btn.getAttribute('data-card-id');
                        switchAdminTab('issue');
                        displayCardPreview(id);
                    });
                });
            }
        }

        // Render PVC Card Preview ONLY IF a card is actively selected / freshly issued
        if (state.activeCardId) {
            displayCardPreview(state.activeCardId);
        } else {
            renderPlaceholderCardPreview();
        }
    }

    function renderPlaceholderCardPreview() {
        document.getElementById('preview-user-name').textContent = 'Naya Card Select/Issue Karein';
        document.getElementById('preview-card-id').textContent = 'GL-CARD-XXXX';
        document.getElementById('preview-card-phone').textContent = '03XX-XXXXXXX';
        document.getElementById('preview-card-balance').textContent = 'Rs. 0';
        document.getElementById('preview-card-status').textContent = 'NEW PASS';
        document.getElementById('preview-card-status').className = 'status-badge status-active';
        
        const qrBox = document.getElementById('preview-qr-code');
        if (qrBox) {
            qrBox.innerHTML = `<div style="width:95px; height:95px; display:flex; justify-content:center; align-items:center; color:#aaa; font-size:0.7rem; text-align:center;">QR PREVIEW</div>`;
        }
    }

    function displayCardPreview(cardId) {
        const card = state.cards.find(c => c.id === cardId);
        if (!card) {
            renderPlaceholderCardPreview();
            return;
        }

        state.activeCardId = cardId;
        const bal = typeof card.balance === 'number' ? card.balance : 0;

        document.getElementById('preview-user-name').textContent = card.name;
        document.getElementById('preview-card-id').textContent = card.id;
        document.getElementById('preview-card-phone').textContent = card.phone;
        document.getElementById('preview-card-balance').textContent = `Rs. ${bal}`;
        
        const statusEl = document.getElementById('preview-card-status');
        if (card.status === 'IN_TRANSIT') {
            statusEl.textContent = 'IN TRANSIT 🚌';
            statusEl.className = 'status-badge status-transit';
        } else {
            statusEl.textContent = 'ACTIVE ✅';
            statusEl.className = 'status-badge status-active';
        }

        generateQRCode('preview-qr-code', card.id, 105);
    }

    function switchAdminTab(tabName) {
        state.activeAdminTab = tabName;

        const navBtns = {
            dash: document.getElementById('nav-dash'),
            issue: document.getElementById('nav-issue'),
            recharge: document.getElementById('nav-recharge'),
            gallery: document.getElementById('nav-gallery'),
            settings: document.getElementById('nav-settings')
        };

        const pages = {
            dash: document.getElementById('tab-dash-content'),
            issue: document.getElementById('tab-issue-content'),
            recharge: document.getElementById('tab-recharge-content'),
            gallery: document.getElementById('tab-gallery-content'),
            settings: document.getElementById('tab-settings-content')
        };

        Object.keys(navBtns).forEach(k => {
            if (k === tabName && navBtns[k] && pages[k]) {
                navBtns[k].classList.add('active');
                pages[k].classList.remove('hidden');
            } else if (navBtns[k] && pages[k]) {
                navBtns[k].classList.remove('active');
                pages[k].classList.add('hidden');
            }
        });

        if (tabName === 'issue') {
            if (!state.activeCardId) renderPlaceholderCardPreview();
        } else if (tabName === 'recharge') {
            state.rechargeTargetCardId = null;
            document.getElementById('recharge-card-result').classList.add('hidden');
            const selectEl = document.getElementById('recharge-select-card');
            if (selectEl) selectEl.value = "";
            const searchInput = document.getElementById('recharge-search-id');
            if (searchInput) searchInput.value = "";
        } else {
            stopRechargeCameraScanner();
        }
    }

    if (document.getElementById('nav-dash')) document.getElementById('nav-dash').addEventListener('click', () => switchAdminTab('dash'));
    if (document.getElementById('nav-issue')) document.getElementById('nav-issue').addEventListener('click', () => switchAdminTab('issue'));
    if (document.getElementById('nav-recharge')) document.getElementById('nav-recharge').addEventListener('click', () => switchAdminTab('recharge'));
    if (document.getElementById('nav-gallery')) document.getElementById('nav-gallery').addEventListener('click', () => switchAdminTab('gallery'));
    if (document.getElementById('nav-settings')) document.getElementById('nav-settings').addEventListener('click', () => switchAdminTab('settings'));

    // ----------------------------------------------------------------------
    // 9. CHANGE SECURITY PIN FORM HANDLER
    // ----------------------------------------------------------------------
    const formChangePin = document.getElementById('form-change-pin');
    if (formChangePin) {
        formChangePin.addEventListener('submit', (e) => {
            e.preventDefault();
            const oldPin = document.getElementById('pin-old').value.trim();
            const newPin = document.getElementById('pin-new').value.trim();
            const confirmPin = document.getElementById('pin-confirm').value.trim();

            if (oldPin !== state.adminPin) {
                alert('❌ Purana PIN Code Galat Hai!');
                return;
            }

            if (newPin.length < 4) {
                alert('❌ Naya PIN kam se kam 4 digits ka hona chahiye!');
                return;
            }

            if (newPin !== confirmPin) {
                alert('❌ Naya PIN aur Confirm PIN aapas mein match nahi kar rahe!');
                return;
            }

            state.adminPin = newPin;
            localStorage.setItem('gl_admin_pin', newPin);
            playGrantedSound();
            alert(`✅ SECURITY PIN SUCCESSFUL CHANGED!\nAapka naya Admin PIN ab: ${newPin}`);
            formChangePin.reset();
        });
    }

    // ----------------------------------------------------------------------
    // 10. PRINT CARD & GENERAL EVENT LISTENERS
    // ----------------------------------------------------------------------
    document.getElementById('btn-print-card').addEventListener('click', () => {
        if (!state.activeCardId) {
            alert('Pehle Naya Card Issue Karein ya Table se View Card Select Karein.');
            return;
        }

        const card = state.cards.find(c => c.id === state.activeCardId);
        if (!card) return;

        const bal = typeof card.balance === 'number' ? card.balance : 0;

        const printArea = document.getElementById('printable-card-area');
        printArea.innerHTML = `
            <div class="smart-pvc-card" style="background:#0b1c38; border:3px solid #00e676; padding:20px; color:#fff; font-family:sans-serif; width:380px; border-radius:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #444; padding-bottom:8px;">
                    <strong style="color:#00e676; font-size:14px;">KARACHI GREEN LINE BRT</strong>
                    <span style="background:#ffd700; color:#000; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:8px;">OFFICIAL PASS</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
                    <div>
                        <h3 style="margin:0; font-size:18px;">${card.name}</h3>
                        <p style="margin:4px 0; font-size:12px; color:#aaa;">Card ID: <b>${card.id}</b></p>
                        <p style="margin:2px 0; font-size:12px; color:#aaa;">Phone: ${card.phone}</p>
                        <div style="margin-top:8px; background:rgba(0,230,118,0.2); color:#00e676; padding:4px 8px; border-radius:6px; font-weight:bold; font-size:13px; display:inline-block;">
                            INITIAL BALANCE: Rs. ${bal}
                        </div>
                    </div>
                    <div id="print-qr-target" style="background:#fff; padding:6px; border-radius:8px;"></div>
                </div>
            </div>
        `;

        generateQRCode('print-qr-target', card.id, 100);

        setTimeout(() => {
            window.print();
        }, 300);
    });

    document.getElementById('gate-mode-entry').addEventListener('click', () => {
        state.gateMode = 'ENTRY';
        document.getElementById('gate-mode-entry').classList.add('active');
        document.getElementById('gate-mode-exit').classList.remove('active');
    });

    document.getElementById('gate-mode-exit').addEventListener('click', () => {
        state.gateMode = 'EXIT';
        document.getElementById('gate-mode-exit').classList.add('active');
        document.getElementById('gate-mode-entry').classList.remove('active');
    });

    document.getElementById('btn-manual-scan').addEventListener('click', () => {
        const inputVal = document.getElementById('manual-qr-input').value;
        if (inputVal) {
            processGuardScan(inputVal);
            document.getElementById('manual-qr-input').value = '';
        }
    });

    document.getElementById('btn-start-camera').addEventListener('click', startGuardCameraScanner);
    document.getElementById('btn-stop-camera').addEventListener('click', stopGuardCameraScanner);

    document.getElementById('btn-recharge-camera-start').addEventListener('click', startRechargeCameraScanner);
    document.getElementById('btn-recharge-camera-stop').addEventListener('click', stopRechargeCameraScanner);

    const btnGuardMode = document.getElementById('btn-guard-mode');
    const btnAdminMode = document.getElementById('btn-admin-mode');
    const guardView = document.getElementById('guard-view');
    const adminView = document.getElementById('admin-view');
    const pinModal = document.getElementById('pin-modal');
    const pinInput = document.getElementById('pin-input');

    btnGuardMode.addEventListener('click', () => {
        state.activeView = 'GUARD';
        btnGuardMode.classList.add('active');
        btnAdminMode.classList.remove('active');
        guardView.classList.remove('hidden');
        adminView.classList.add('hidden');
        stopRechargeCameraScanner();
    });

    btnAdminMode.addEventListener('click', () => {
        pinModal.classList.remove('hidden');
        pinInput.value = '';
        pinInput.focus();
    });

    document.getElementById('btn-cancel-pin').addEventListener('click', () => {
        pinModal.classList.add('hidden');
    });

    document.getElementById('btn-verify-pin').addEventListener('click', verifyAdminPin);
    pinInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') verifyAdminPin();
    });

    function verifyAdminPin() {
        if (pinInput.value === state.adminPin) {
            pinModal.classList.add('hidden');
            state.activeView = 'ADMIN';
            btnAdminMode.classList.add('active');
            btnGuardMode.classList.remove('active');
            adminView.classList.remove('hidden');
            guardView.classList.add('hidden');
            stopGuardCameraScanner();
        } else {
            alert('❌ Galat Security PIN Code!');
            pinInput.value = '';
            pinInput.focus();
        }
    }

    // Create Card Form
    document.getElementById('form-create-card').addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('card-user-name').value.trim();
        const phone = document.getElementById('card-user-phone').value.trim();
        const cnic = document.getElementById('card-user-cnic').value.trim();
        const initialBal = parseFloat(document.getElementById('card-initial-balance').value);

        const newId = `GL-CARD-${1001 + state.cards.length}`;

        const newCard = {
            id: newId,
            name: name,
            phone: phone,
            cnic: cnic || 'N/A',
            balance: initialBal,
            initialBalance: initialBal,
            status: 'COMPLETED',
            createdAt: new Date().toLocaleDateString()
        };

        state.cards.push(newCard);
        syncCardToCloud(newCard);
        state.activeCardId = newId;

        renderApp();
        displayCardPreview(newId);
        playGrantedSound();
        alert(`✅ CARD ISSUED & SYNCED TO ALL DEVICES!\nCard ID: ${newId}\nBalance: Rs. ${initialBal}`);
        document.getElementById('form-create-card').reset();
    });

    initStore();
});
