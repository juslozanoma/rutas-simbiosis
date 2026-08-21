/**
 * src/main.jsx
 * ---------------------------------------------------------------------------
 * Punto de entrada de React. Monta la cáscara estática de toda la app dentro
 * de #simbiosis-root (hijo de #app, que se conserva en index.html porque la
 * lógica vanilla togglea sus atributos de datos y clases).
 *
 * El mount se hace ANTES de que corran los scripts clásicos de /js/ (el
 * <script type="module"> va antes que los <script defer> en el body) y se
 * fuerza con flushSync para que el DOM esté presente de forma síncrona cuando
 * app.js ejecute su init() en DOMContentLoaded.
 * ---------------------------------------------------------------------------
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from './App';
import './styles/spinners/bike.css';
import './styles/spinners/monalisa.css';

const raiz = document.getElementById('simbiosis-root');
if (raiz) {
  flushSync(() => {
    createRoot(raiz).render(<App />);
  });
} else {
  console.warn('[Simbiosis] No se encontró #simbiosis-root para montar React');
}
