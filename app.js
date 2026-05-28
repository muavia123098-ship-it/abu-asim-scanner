/* ==========================================================================
   VoiceCalc - Core Application Engine
   ========================================================================== */

// --- App State ---
let expression = '';
let runningResult = '0';
let isListening = false;
let isEvaluated = false;
let speechBuffer = ''; // Holds the cumulative spoken words

const settings = {
    language: 'en-US',
    speakAnswers: true,
    continuous: true,
    soundEffects: true
};

let history = [];

// --- Web Audio Context for Synthesized Sounds ---
let audioCtx = null;

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// --- Synthesized Click Sound Effect ---
function playClickSound() {
    if (!settings.soundEffects) return;
    initAudioContext();
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(650, audioCtx.currentTime); // Soft high pitch
        
        gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
    } catch (e) {
        console.warn('Audio feedback failed to play', e);
    }
}

// --- Synthesized Calculation Success Chime ---
function playSuccessSound() {
    if (!settings.soundEffects) return;
    initAudioContext();
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const now = audioCtx.currentTime;
        
        // Ascending harmonic chime (C5 -> E5 -> G5)
        const notes = [523.25, 659.25, 783.99]; 
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + (idx * 0.07));
            
            gainNode.gain.setValueAtTime(0.05, now + (idx * 0.07));
            gainNode.gain.exponentialRampToValueAtTime(0.001, now + (idx * 0.07) + 0.25);
            
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            osc.start(now + (idx * 0.07));
            osc.stop(now + (idx * 0.07) + 0.3);
        });
    } catch (e) {
        console.warn('Success feedback audio failed', e);
    }
}

// --- Synthesized Error Buzzer ---
function playErrorSound() {
    if (!settings.soundEffects) return;
    initAudioContext();
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, audioCtx.currentTime); // Low buzz
        
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
        console.warn('Error feedback audio failed', e);
    }
}

// --- Text To Speech (Read Out Aloud) ---
function speakAnswer(text) {
    if (!settings.speakAnswers) return;
    try {
        // Cancel active reading to avoid overlapping
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Set language-specific accent and speech text
        if (settings.language.startsWith('ur')) {
            utterance.lang = 'hi-IN'; // Fallback to Hindi accent which reads Urdu numerals beautifully
            utterance.rate = 0.9;
        } else if (settings.language.startsWith('hi')) {
            utterance.lang = 'hi-IN';
            utterance.rate = 0.9;
        } else {
            utterance.lang = 'en-US';
            utterance.rate = 1.0;
        }
        
        window.speechSynthesis.speak(utterance);
    } catch (e) {
        console.error('Speech synthesis failed', e);
    }
}

// --- DOM Cache ---
const elements = {
    displayExpression: document.getElementById('display-expression'),
    displayResult: document.getElementById('display-result'),
    transcriptionText: document.getElementById('transcription-text'),
    micBtn: document.getElementById('mic-trigger-btn'),
    micStatusBadge: document.getElementById('mic-status-badge'),
    langStatusBadge: document.getElementById('lang-status-badge'),
    visualizer: document.getElementById('visualizer-panel'),
    keypadDrawer: document.getElementById('manual-keypad'),
    toggleKeypadBtn: document.getElementById('toggle-keypad-btn'),
    
    // Modals
    settingsBtn: document.getElementById('settings-btn'),
    settingsOverlay: document.getElementById('settings-overlay'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    
    historyBtn: document.getElementById('history-btn'),
    historyOverlay: document.getElementById('history-overlay'),
    closeHistoryBtn: document.getElementById('close-history-btn'),
    historyContainer: document.getElementById('history-container'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),
    
    openGuideBtn: document.getElementById('open-guide-btn'),
    guideOverlay: document.getElementById('guide-overlay'),
    closeGuideBtnTop: document.getElementById('close-guide-btn-top'),
    closeGuideBtnBottom: document.getElementById('close-guide-btn-bottom'),
    
    // Setting Form Nodes
    languageSelect: document.getElementById('language-select'),
    ttsToggle: document.getElementById('voice-tts-toggle'),
    continuousToggle: document.getElementById('continuous-listening-toggle'),
    soundEffectsToggle: document.getElementById('haptic-audio-toggle')
};

// --- Math Evaluation Sandbox ---
function evaluateExpression(expr) {
    // 1. Remove all spaces
    let sanitized = expr.replace(/\s+/g, '');
    
    // 2. Replace visual arithmetic characters with computer standard ones
    sanitized = sanitized.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    
    // 3. Strict validation: only digits, decimal points, and arithmetic operators are allowed.
    if (!/^[0-9+\-*/.()]+$/.test(sanitized)) {
        throw new Error("Syntax Error");
    }
    
    // 4. Block invalid multiple arithmetic operations (e.g. ++ or //)
    if (/([+\-*/.]{2,})/.test(sanitized)) {
        // Exception: allow negative representations like *- or /- or +-
        if (/([+\*]{2,})/.test(sanitized) || /(\*-|\+-|\/-|\-\-){2,}/.test(sanitized)) {
            throw new Error("Syntax Error");
        }
    }
    
    try {
        // Run safe math calculations using isolated new Function scope
        const calculation = new Function(`return (${sanitized})`)();
        
        if (calculation === Infinity || calculation === -Infinity) {
            throw new Error("Divide by Zero");
        }
        if (isNaN(calculation)) {
            throw new Error("Syntax Error");
        }
        
        // Remove rounding floating-point issues (e.g. 0.1+0.2) up to 8 decimals
        return Math.round(calculation * 100000000) / 100000000;
    } catch (err) {
        throw new Error(err.message === "Divide by Zero" ? "Divide by Zero" : "Syntax Error");
    }
}

// --- Parse Voice Text into Mathematical Syntax ---
function parseSpeechToMath(text) {
    let clean = text.toLowerCase();

    // 1. Check for immediate explicit system controls first
    if (/\b(clear|reset|saaf|khatam|clean|mitaye|mitayein)\b/.test(clean)) {
        return "COMMAND_CLEAR";
    }
    if (/\b(delete|backspace|piche|remove)\b/.test(clean)) {
        return "COMMAND_BACKSPACE";
    }

    // 2. Mapping verbal math keywords to absolute signs
    const mappings = [
        // Addition
        { keys: ['plus', 'add', 'jamah', 'jama', 'jamme', 'جمع', 'جوڑ', 'plus mark'], val: ' + ' },
        // Subtraction
        { keys: ['minus', 'subtract', 'nifi', 'nifee', 'nfi', 'manfi', 'tafreeq', 'منفی', 'گھٹائیں'], val: ' - ' },
        // Multiplication
        { keys: ['multiply', 'multiplied by', 'times', 'into', 'zarb', 'ضرب', 'guna', 'multiplied'], val: ' * ' },
        // Division
        { keys: ['divided by', 'divide', 'over', 'takseem', 'تقسیم', 'div', 'divided'], val: ' / ' },
        // Calculation Evaluation trigger
        { keys: ['equal to', 'equals', 'equal', 'barabar', 'برابر', 'hove', 'huye', 'ans', 'answer'], val: ' = ' }
    ];

    mappings.forEach(mapping => {
        mapping.keys.forEach(key => {
            // Escape special chars for regex
            const escaped = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            // If the key is a native language right-to-left word, run standard replace.
            if (/[\u0600-\u06FF]/.test(key)) {
                clean = clean.split(key).join(mapping.val);
            } else {
                // Word boundary check for standard letters
                const regex = new RegExp(`\\b${escaped}\\b`, 'g');
                clean = clean.replace(regex, mapping.val);
            }
        });
    });

    // 3. Mapping Spoken phonetic numeric values to digits
    const phoneticNumbers = {
        'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
        'eleven': '11', 'twelve': '12', 'thirteen': '13', 'fourteen': '14', 'fifteen': '15',
        'ek': '1', 'aik': '1', 'do': '2', 'teen': '3', 'chaar': '4', 'char': '4', 'paanch': '5', 'panch': '5', 'che': '6', 'chhe': '6', 'saat': '7', 'aath': '8', 'nau': '9', 'no': '9', 'das': '10',
        'gyarah': '11', 'barah': '12', 'terah': '13', 'chaudah': '14', 'pandrah': '15', 'solah': '16', 'satrah': '17', 'atharah': '18', 'unnis': '19', 'bees': '20',
        'tees': '30', 'chalis': '40', 'pachas': '50', 'pachaas': '50', 'saath': '60', 'sattar': '70', 'assi': '80', 'naway': '90', 'nave': '90',
        'sau': '100', 'so': '100', 'hazaar': '1000', 'hazar': '1000', 'lakh': '100000'
    };

    Object.keys(phoneticNumbers).forEach(word => {
        if (/[\u0600-\u06FF]/.test(word)) {
            clean = clean.split(word).join(phoneticNumbers[word]);
        } else {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            clean = clean.replace(regex, phoneticNumbers[word]);
        }
    });

    // 4. Sanitize out non-math junk phrases (e.g. "hey calculator", "hello", "yar", "please", etc.)
    // Only permit digits, operators, decimals, spaces, and the equals symbol.
    clean = clean.replace(/[^0-9+\-*/.= ]/g, '');

    return clean;
}

// --- Render Mathematical Formatting ---
function formatExpressionForDisplay(expr) {
    if (!expr) return '';
    // Format mathematical operational symbols with colored wrappers
    return expr
        .replace(/\+/g, '<span class="operator">+</span>')
        .replace(/-/g, '<span class="operator">−</span>')
        .replace(/\*/g, '<span class="operator">×</span>')
        .replace(/\//g, '<span class="operator">÷</span>');
}

// --- Process Inputs (Spoken Text or Keys) ---
function processInputData(rawExpr, isVoiceFinal = false) {
    if (rawExpr === "COMMAND_CLEAR") {
        clearCalculator();
        playClickSound();
        return;
    }
    
    if (rawExpr === "COMMAND_BACKSPACE") {
        expression = expression.trim();
        if (expression.length > 0) {
            expression = expression.substring(0, expression.length - 1).trim();
            updateDisplay();
        }
        playClickSound();
        return;
    }

    // Clean multiple space issues
    let parsed = rawExpr.replace(/\s+/g, ' ');
    
    // Check if the parsed expression contains an evaluation trigger
    const containsEquals = parsed.includes('=');
    
    // Extract actual numeric formula part (omit anything past equals sign)
    let formula = parsed.split('=')[0].trim();
    
    // Keep internal standard operators (remove visual dividers)
    formula = formula.replace(/\s+/g, '');

    if (formula) {
        expression = formula;
    }

    updateDisplay();

    // Check if we can compute a live running result
    if (expression && !isEvaluated) {
        try {
            // Strip trailing operators so we don't trigger syntax errors during typing
            let testExpr = expression;
            while (['+', '-', '*', '/'].includes(testExpr.slice(-1))) {
                testExpr = testExpr.slice(0, -1);
            }
            if (testExpr && !/^[+\-*/.()]+$/.test(testExpr)) {
                const runningValue = evaluateExpression(testExpr);
                runningResult = runningValue.toString();
                elements.displayResult.textContent = runningResult;
            }
        } catch (e) {
            // Quietly suppress running evaluation errors
        }
    }

    // Trigger Final Calculation
    if (containsEquals || isVoiceFinal) {
        triggerCalculationFinal();
    }
}

// --- Execute Final Calculation ---
function triggerCalculationFinal() {
    if (!expression) return;
    
    try {
        const finalValue = evaluateExpression(expression);
        const formulaText = expression
            .replace(/\*/g, ' × ')
            .replace(/\//g, ' ÷ ')
            .replace(/-/g, ' − ')
            .replace(/\+/g, ' + ');
            
        const resultString = finalValue.toString();
        
        // Sound and Speech
        playSuccessSound();
        
        // Save to active states
        elements.displayResult.textContent = resultString;
        elements.displayResult.classList.add('evaluated');
        isEvaluated = true;
        
        // Add to persistent calculation history array
        const historyItem = {
            expression: formulaText,
            result: resultString,
            timestamp: Date.now()
        };
        history.unshift(historyItem); // Add to top
        saveHistoryToLocalStorage();
        
        // Build vocal audio response
        let voiceMessage = '';
        if (settings.language.startsWith('ur') || settings.language.startsWith('hi')) {
            voiceMessage = `Aapka jawaab hai ${resultString}`;
        } else {
            voiceMessage = `Your answer is ${resultString}`;
        }
        speakAnswer(voiceMessage);
        
    } catch (err) {
        playErrorSound();
        elements.displayResult.textContent = err.message;
        elements.displayResult.classList.remove('evaluated');
        speakAnswer(settings.language.startsWith('ur') ? "calculation galat hai" : "Syntax error");
    }
}

// --- Clear Calculator State ---
function clearCalculator() {
    expression = '';
    runningResult = '0';
    isEvaluated = false;
    speechBuffer = '';
    elements.displayExpression.innerHTML = '';
    elements.displayResult.textContent = '0';
    elements.displayResult.classList.remove('evaluated');
    elements.transcriptionText.textContent = isListening ? 'Listening...' : 'Press Mic & Speak...';
    elements.transcriptionText.classList.remove('active');
}

// --- Update Screen Views ---
function updateDisplay() {
    // Show visual formula expressions
    const visualHTML = formatExpressionForDisplay(expression);
    elements.displayExpression.innerHTML = visualHTML;
    
    if (isEvaluated) {
        elements.displayResult.classList.add('evaluated');
    } else {
        elements.displayResult.classList.remove('evaluated');
    }
}

// ==========================================================================
// --- Browser Speech Recognition Setup ---
// ==========================================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionTimer = null; // Auto-silence timer

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onstart = () => {
        isListening = true;
        elements.micBtn.classList.add('active');
        elements.micStatusBadge.textContent = 'Listening';
        elements.micStatusBadge.className = 'badge badge-active';
        elements.visualizer.classList.add('active');
        elements.transcriptionText.textContent = 'Say something...';
        elements.transcriptionText.classList.add('active');
        
        // Start continuous silence detection
        resetAutoSilenceTimer();
    };

    recognition.onresult = (event) => {
        resetAutoSilenceTimer();
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += transcript;
            } else {
                interimTranscript += transcript;
            }
        }

        // Combine cumulative speaking buffer
        const fullTranscript = (speechBuffer + ' ' + finalTranscript + ' ' + interimTranscript).trim();
        
        // Update live visual text subtitle box
        const previewText = fullTranscript || 'Analyzing speech...';
        elements.transcriptionText.textContent = previewText;
        
        // Core Parsing
        const parsedMath = parseSpeechToMath(fullTranscript);
        
        if (parsedMath) {
            processInputData(parsedMath, false);
        }

        // Save stable speech segments back to buffer
        if (finalTranscript) {
            speechBuffer = (speechBuffer + ' ' + finalTranscript).trim();
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            alert('Microphone access is blocked! Please enable microphone settings in your browser address bar.');
            stopListeningState();
        }
        elements.micStatusBadge.textContent = 'Error';
        elements.micStatusBadge.className = 'badge badge-inactive';
    };

    recognition.onend = () => {
        // Automatically restart listening if continuous mode is enabled in parameters and we did not stop manually
        if (isListening && settings.continuous) {
            try {
                recognition.start();
            } catch (e) {
                console.warn("Failed to automatically restart recognition loop", e);
            }
        } else {
            stopListeningState();
        }
    };
} else {
    // Unsupported browser fallback configurations
    elements.micBtn.disabled = true;
    elements.micTooltip.textContent = 'Speech not supported in this browser';
    elements.micStatusBadge.textContent = 'Not Supported';
    elements.micStatusBadge.className = 'badge badge-inactive';
}

function startListeningState() {
    if (!recognition) return;
    initAudioContext();
    speechBuffer = ''; // Reset buffer
    
    // Clear output if already evaluated to let users perform consecutive calculations seamlessly
    if (isEvaluated) {
        clearCalculator();
    }
    
    // Configure settings
    recognition.lang = settings.language;
    recognition.continuous = settings.continuous;
    
    try {
        recognition.start();
        playClickSound();
    } catch (err) {
        console.error('Could not start recognition engine:', err);
    }
}

function stopListeningState() {
    isListening = false;
    elements.micBtn.classList.remove('active');
    elements.micStatusBadge.textContent = 'Offline';
    elements.micStatusBadge.className = 'badge badge-inactive';
    elements.visualizer.classList.remove('active');
    elements.transcriptionText.classList.remove('active');
    elements.transcriptionText.textContent = 'Press Mic & Speak...';
    
    clearTimeout(recognitionTimer);

    if (recognition) {
        try {
            recognition.stop();
        } catch (e) {}
    }
}

// Silence Detection: If no speech is recorded for 8 seconds, automatically evaluate current numbers
function resetAutoSilenceTimer() {
    clearTimeout(recognitionTimer);
    if (!isListening) return;
    
    recognitionTimer = setTimeout(() => {
        if (expression && !isEvaluated && !['+', '-', '*', '/'].includes(expression.slice(-1))) {
            triggerCalculationFinal();
            stopListeningState();
        }
    }, 8000); // 8 seconds of continuous silence trigger auto-calculation
}

// --- Toggle Microphone Button ---
elements.micBtn.addEventListener('click', () => {
    if (isListening) {
        stopListeningState();
        playClickSound();
    } else {
        startListeningState();
    }
});

// ==========================================================================
// --- Tactile Manual Keypad Bindings ---
// ==========================================================================
elements.keypadDrawer.addEventListener('click', (e) => {
    const btn = e.target.closest('.key-btn');
    if (!btn) return;
    
    const key = btn.dataset.key;
    playClickSound();
    
    if (isEvaluated && key !== 'equals') {
        // Clear result screen and keep expression if using an operator next, or clear both if typing a new number
        if (['+', '-', '*', '/'].includes(key)) {
            expression = elements.displayResult.textContent;
        } else {
            expression = '';
        }
        isEvaluated = false;
        elements.displayResult.classList.remove('evaluated');
    }

    if (key === 'clear') {
        clearCalculator();
    } else if (key === 'backspace') {
        if (expression.length > 0) {
            expression = expression.slice(0, -1);
            updateDisplay();
        }
    } else if (key === 'equals') {
        triggerCalculationFinal();
    } else {
        // Standard Numbers & Operators
        // Avoid duplicate decimals in a single number sequence
        if (key === '.') {
            const parts = expression.split(/[\+\-\*\/]/);
            const currentNum = parts[parts.length - 1];
            if (currentNum.includes('.')) return;
        }
        
        // Prevent typing multiple consecutive operators
        if (['+', '-', '*', '/'].includes(key)) {
            if (['+', '-', '*', '/'].includes(expression.slice(-1))) {
                expression = expression.slice(0, -1);
            }
        }
        
        expression += key;
        updateDisplay();
    }
});

// Keypad drawer slider
elements.toggleKeypadBtn.addEventListener('click', () => {
    const isCollapsed = elements.keypadDrawer.classList.toggle('collapsed');
    elements.toggleKeypadBtn.querySelector('.chevron').classList.toggle('rotate', !isCollapsed);
    elements.toggleKeypadBtn.querySelector('span').textContent = isCollapsed ? 'Show Manual Keypad' : 'Hide Manual Keypad';
    playClickSound();
});

// ==========================================================================
// --- Modal Dialogs & Event Actions ---
// ==========================================================================
function toggleOverlay(overlay, show) {
    if (show) {
        overlay.classList.remove('hidden');
        playClickSound();
    } else {
        overlay.classList.add('hidden');
        playClickSound();
    }
}

// Settings Overlay events
elements.settingsBtn.addEventListener('click', () => toggleOverlay(elements.settingsOverlay, true));
elements.closeSettingsBtn.addEventListener('click', () => toggleOverlay(elements.settingsOverlay, false));
elements.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === elements.settingsOverlay) toggleOverlay(elements.settingsOverlay, false);
});

// History Overlay events
elements.historyBtn.addEventListener('click', () => {
    renderHistoryDrawerList();
    toggleOverlay(elements.historyOverlay, true);
});
elements.closeHistoryBtn.addEventListener('click', () => toggleOverlay(elements.historyOverlay, false));
elements.historyOverlay.addEventListener('click', (e) => {
    if (e.target === elements.historyOverlay) toggleOverlay(elements.historyOverlay, false);
});

// Speaking Guide events
elements.openGuideBtn.addEventListener('click', () => toggleOverlay(elements.guideOverlay, true));
elements.closeGuideBtnTop.addEventListener('click', () => toggleOverlay(elements.guideOverlay, false));
elements.closeGuideBtnBottom.addEventListener('click', () => toggleOverlay(elements.guideOverlay, false));
elements.guideOverlay.addEventListener('click', (e) => {
    if (e.target === elements.guideOverlay) toggleOverlay(elements.guideOverlay, false);
});

// Sync Setting forms changes
elements.languageSelect.addEventListener('change', (e) => {
    settings.language = e.target.value;
    
    // Update visual language badge indicator
    let badgeText = 'English';
    if (settings.language === 'ur-PK') badgeText = 'Urdu / Hinglish';
    if (settings.language === 'hi-IN') badgeText = 'Hindi';
    
    elements.langStatusBadge.textContent = badgeText;
    
    // Apply special styling accent for native speech modes
    if (settings.language !== 'en-US') {
        elements.langStatusBadge.className = 'badge badge-accent';
    } else {
        elements.langStatusBadge.className = 'badge';
    }
    
    saveSettingsToLocalStorage();
});

elements.ttsToggle.addEventListener('change', (e) => {
    settings.speakAnswers = e.target.checked;
    saveSettingsToLocalStorage();
});

elements.continuousToggle.addEventListener('change', (e) => {
    settings.continuous = e.target.checked;
    saveSettingsToLocalStorage();
});

elements.soundEffectsToggle.addEventListener('change', (e) => {
    settings.soundEffects = e.target.checked;
    saveSettingsToLocalStorage();
});

// ==========================================================================
// --- Persistent Browser Storage Buffers ---
// ==========================================================================
function saveSettingsToLocalStorage() {
    localStorage.setItem('voicecalc_settings', JSON.stringify(settings));
}

function loadSettingsFromLocalStorage() {
    const saved = localStorage.getItem('voicecalc_settings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.assign(settings, parsed);
            
            // Sync values to DOM nodes
            elements.languageSelect.value = settings.language;
            elements.ttsToggle.checked = settings.speakAnswers;
            elements.continuousToggle.checked = settings.continuous;
            elements.soundEffectsToggle.checked = settings.soundEffects;
            
            // Set language status badge
            let badgeText = 'English';
            if (settings.language === 'ur-PK') badgeText = 'Urdu / Hinglish';
            if (settings.language === 'hi-IN') badgeText = 'Hindi';
            elements.langStatusBadge.textContent = badgeText;
            if (settings.language !== 'en-US') {
                elements.langStatusBadge.className = 'badge badge-accent';
            }
        } catch (e) {
            console.error('Failed to parse settings buffer', e);
        }
    }
}

function saveHistoryToLocalStorage() {
    localStorage.setItem('voicecalc_history', JSON.stringify(history));
}

function loadHistoryFromLocalStorage() {
    const saved = localStorage.getItem('voicecalc_history');
    if (saved) {
        try {
            history = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse history buffer', e);
        }
    }
}

function renderHistoryDrawerList() {
    elements.historyContainer.innerHTML = '';
    
    if (history.length === 0) {
        elements.historyContainer.innerHTML = `
            <div class="empty-state">
                <p>No calculations recorded yet.</p>
                <span>Your history will show up here as you make calculations.</span>
            </div>
        `;
        return;
    }
    
    history.forEach((item, index) => {
        const dateStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const div = document.createElement('div');
        div.className = 'history-item';
        div.dataset.index = index;
        div.innerHTML = `
            <div class="history-expr">${item.expression} =</div>
            <div class="history-res">${item.result}</div>
            <span style="font-size: 0.65rem; color: var(--text-muted); margin-top:2px;">${dateStr}</span>
        `;
        
        // Injects back into calculation displays on tap/click
        div.addEventListener('click', () => {
            expression = item.expression.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
            runningResult = item.result;
            isEvaluated = true;
            updateDisplay();
            elements.displayResult.textContent = runningResult;
            toggleOverlay(elements.historyOverlay, false);
        });
        
        elements.historyContainer.appendChild(div);
    });
}

// Clear History Button event
elements.clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete all historical logs?')) {
        history = [];
        saveHistoryToLocalStorage();
        renderHistoryDrawerList();
        playClickSound();
    }
});

// ==========================================================================
// --- Initialization Procedures ---
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
    loadSettingsFromLocalStorage();
    loadHistoryFromLocalStorage();
    initPwaInstallFlow(); // Start PWA install check!
    
    // Welcome vocal speech chime and guidelines popup on first open
    if (!localStorage.getItem('voicecalc_visited')) {
        localStorage.setItem('voicecalc_visited', 'true');
        setTimeout(() => {
            toggleOverlay(elements.guideOverlay, true);
        }, 800);
    }
});

// ==========================================================================
// --- PWA Installation & Onboarding Engine ---
// ==========================================================================
let deferredPrompt = null;
const pwaInstallOverlay = document.getElementById('pwa-install-overlay');
const pwaInstallBtn = document.getElementById('pwa-install-btn');
const iosInstallInstructions = document.getElementById('ios-install-instructions');
const pwaSkipBtn = document.getElementById('pwa-skip-btn');

// Check if running in standalone mode (installed)
function isRunningStandalone() {
    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone || // iOS standalone Safari check
        document.referrer.includes('android-app://') // Android Trusted Web Activity check
    );
}

// Detect iOS/Safari
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// Initialize PWA Installation Screen
function initPwaInstallFlow() {
    if (isRunningStandalone()) {
        // Already installed, hide overlay immediately
        pwaInstallOverlay.classList.add('hidden');
        return;
    }

    // Not installed: show install onboarding overlay
    pwaInstallOverlay.classList.remove('hidden');

    // If iOS Safari, standard automated prompts aren't supported. Show manual guide box
    if (isIOS()) {
        if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
        if (iosInstallInstructions) iosInstallInstructions.classList.remove('hidden');
    }

    // Skip/Bypass button event
    if (pwaSkipBtn) {
        pwaSkipBtn.addEventListener('click', () => {
            pwaInstallOverlay.classList.add('hidden');
            playClickSound();
        });
    }

    // Capture standard PWA installation event (Chrome/Android/Edge/Windows)
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent default browser mini-info bar from popping up
        e.preventDefault();
        // Save event trigger to global state
        deferredPrompt = e;
        
        // Ensure install buttons are shown
        if (pwaInstallBtn) {
            pwaInstallBtn.style.display = 'flex';
            
            // Unbind any previous listeners and bind new click event
            pwaInstallBtn.onclick = () => {
                playClickSound();
                // Trigger native prompt
                deferredPrompt.prompt();
                
                // Track choice response
                deferredPrompt.userChoice.then((choiceResult) => {
                    if (choiceResult.outcome === 'accepted') {
                        console.log('User accepted PWA installation');
                        pwaInstallOverlay.classList.add('hidden');
                    } else {
                        console.log('User dismissed PWA installation');
                    }
                    deferredPrompt = null;
                });
            };
        }
        
        if (iosInstallInstructions) iosInstallInstructions.classList.add('hidden');
    });

    // Handle installed completion callback
    window.addEventListener('appinstalled', (evt) => {
        console.log('VoiceCalc was successfully installed!');
        pwaInstallOverlay.classList.add('hidden');
        deferredPrompt = null;
    });
}
