import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App';
import '../styles.css';

const models = ['openai:gpt-6.1-sol', 'openai:gpt-6-astra', 'openai:gpt-6-sol'];
const root = document.getElementById('root');
if (!root) throw new Error('Babel root element is missing.');
ReactDOM.createRoot(root).render(<React.StrictMode><App modelIds={models} /></React.StrictMode>);
