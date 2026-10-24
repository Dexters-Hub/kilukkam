import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { unlockAudio } from './lib/audio.js';
import { isCompleteCode, normalizeCode } from './lib/store.js';
import { App } from './app/App.js';
import { connect, store } from './app/controller.js';

const root = document.getElementById('app');
if (!root) throw new Error('index.html is missing #app');

// Unlock audio on the very first gesture anywhere, not just on Join.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true, capture: true });

// /?code=ABCD links straight to the join screen with the code filled.
const linked = normalizeCode(new URLSearchParams(location.search).get('code') ?? '');
if (isCompleteCode(linked)) store.set({ route: 'join', joinCode: linked });

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

connect();
