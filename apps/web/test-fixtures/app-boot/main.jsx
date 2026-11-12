import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LoadingState from '../../src/components/LoadingState.jsx';

function App() {
  const [loading, setLoading] = useState(new URLSearchParams(location.search).has('loading'));
  globalThis.finishBootFixture = () => setLoading(false);
  return loading
    ? createElement(LoadingState, { label: 'Opening the page…', rows: 0 })
    : createElement('h1', null, 'Page ready');
}

createRoot(document.getElementById('root')).render(createElement(App));
