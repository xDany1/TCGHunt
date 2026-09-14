import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './style.css';
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
