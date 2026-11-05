// Keeps the browser's last warnings and errors so a problem report can carry
// them. Only text is kept, never objects, and the server redacts it again.
const LIMIT = 50;
const entries = [];
let started = false;

function text(args) {
  return args.map((arg) => {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ').slice(0, 1000);
}

function keep(level, args) {
  entries.push({ level, message: text(args) });
  if (entries.length > LIMIT) entries.shift();
}

export function startRecentMessages() {
  if (started || typeof window === 'undefined') return;
  started = true;
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      keep(level, args);
      original(...args);
    };
  }
  window.addEventListener('error', (event) => keep('error', [event.message || 'Script error']));
  window.addEventListener('unhandledrejection', (event) => keep('error', ['Unhandled rejection:', event.reason]));
}

export function recentMessages() {
  return entries.slice();
}
