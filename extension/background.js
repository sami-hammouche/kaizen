// Kaizen background service worker.
// It never talks to Vinted directly: it asks the content script (content.js)
// running in a Vinted tab. The code is split by feature in background/.
// Order matters only for files that run code at load time (core first, handlers last).
importScripts(
  'background/core.js',
  'background/tabs.js',
  'background/queue.js',
  'background/offers.js',
  'background/messages.js',
  'background/photos.js',
  'background/sales.js',
  'background/handlers.js'
);
