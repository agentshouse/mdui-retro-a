import {createRoot} from 'react-dom/client';
import {App} from './App';
import './index.scss';
import './port.scss';
const root = document.getElementById('root');
if (!root) throw new Error('Retro board root is missing.');
createRoot(root).render(<App />);
