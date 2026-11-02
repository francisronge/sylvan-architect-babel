import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

// public/browser-support.js has already shown a message in place of the app.
const unsupported = (window as Window & { __BABEL_UNSUPPORTED__?: string[] }).__BABEL_UNSUPPORTED__;
if (!unsupported?.length) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
