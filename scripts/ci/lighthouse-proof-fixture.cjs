'use strict';

const fs = require('node:fs');

const file = '.lighthouse-site/index.html';
const html = fs.readFileSync(file, 'utf8');
const script = `<script>
if (location.hash === '') {
  const observer = new PerformanceObserver((entries) => {
    if (!entries.getEntriesByName('first-contentful-paint').length) return;
    observer.disconnect();
    const deadline = performance.now() + 3000;
    while (performance.now() < deadline) {}
  });
  observer.observe({ type: 'paint', buffered: true });
}
</script>`;

if (!html.includes('</body>')) throw new Error('Demo has no closing body tag');
fs.writeFileSync(file, html.replace('</body>', script + '</body>'));
