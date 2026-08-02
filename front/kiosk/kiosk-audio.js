(function () {
  'use strict';

  const STORAGE_KEY = 'medipointKioskAudioEnabled';
  const DEFAULT_LANG = 'en-US';

  let enabled = localStorage.getItem(STORAGE_KEY) !== 'false';
  let preferredVoice = null;
  let toggleButton = null;

  function isSupported() {
    return 'speechSynthesis' in window;
  }

  function getEnglishVoice() {
    const voices = window.speechSynthesis.getVoices();
    return voices.find(voice => voice.lang.startsWith('en')) || voices[0] || null;
  }

  function ensureVoice() {
    if (!preferredVoice) {
      preferredVoice = getEnglishVoice();
    }
    return preferredVoice;
  }

  if (isSupported()) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      preferredVoice = getEnglishVoice();
    });
    window.speechSynthesis.getVoices();
  }

  function stop() {
    if (!isSupported()) return;
    window.speechSynthesis.cancel();
  }

  function isEnabled() {
    return enabled && isSupported();
  }

  function updateToggleUI() {
    if (!toggleButton) return;

    toggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    toggleButton.setAttribute(
      'aria-label',
      enabled ? 'Turn audio guidance off' : 'Turn audio guidance on'
    );
    toggleButton.classList.toggle('is-muted', !enabled);

    const label = toggleButton.querySelector('.kiosk-audio-toggle__label');
    if (label) {
      label.textContent = enabled ? 'Audio On' : 'Audio Off';
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    if (!enabled) stop();
    updateToggleUI();
  }

  function toggle() {
    setEnabled(!enabled);
    if (enabled) {
      speak('Audio guidance is on.');
    }
  }

  function speak(text, options = {}) {
    if (!isEnabled() || !text) {
      return Promise.resolve();
    }

    stop();

    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(String(text).trim());
      utterance.lang = options.lang || DEFAULT_LANG;
      utterance.rate = options.rate ?? 0.95;
      utterance.pitch = options.pitch ?? 1;
      utterance.volume = options.volume ?? 1;

      const voice = options.voice || ensureVoice();
      if (voice) utterance.voice = voice;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }

  function speakInstructions(title, info) {
    if (!info) return speak(title);

    const parts = [title];
    if (info.sensor) parts.push(info.sensor);

    (info.steps || []).forEach((step, index) => {
      parts.push(`Step ${index + 1}. ${step}`);
    });

    if (info.text) parts.push(info.text);
    parts.push('Press Start when you are ready.');

    return speak(parts.join('. '));
  }

  function bindNavigationStop() {
    window.addEventListener('pagehide', stop);
    window.addEventListener('beforeunload', stop);
  }

  function createToggleButton(mountEl) {
    if (!mountEl || toggleButton) return toggleButton;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kiosk-audio-toggle';
    button.innerHTML = `
      <svg class="kiosk-audio-toggle__icon kiosk-audio-toggle__icon--on" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M11 5L6 9H3V15H6L11 19V5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M15.5 8.5C16.6 9.6 17.2 11 17.2 12.5C17.2 14 16.6 15.4 15.5 16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M18.5 5.5C20.4 7.4 21.5 9.8 21.5 12.5C21.5 15.2 20.4 17.6 18.5 19.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <svg class="kiosk-audio-toggle__icon kiosk-audio-toggle__icon--off" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M11 5L6 9H3V15H6L11 19V5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M22 9L16 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M16 9L22 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span class="kiosk-audio-toggle__label">Audio On</span>
    `;

    button.addEventListener('click', toggle);
    mountEl.prepend(button);
    toggleButton = button;
    updateToggleUI();
    return button;
  }

  bindNavigationStop();

  window.MediPointKioskAudio = {
    isSupported,
    isEnabled,
    setEnabled,
    toggle,
    speak,
    stop,
    speakInstructions,
    createToggleButton
  };
})();
