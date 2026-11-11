// The public videos page, docs/videos/index.html. preview-page.mjs writes it
// after each verified export; the markup matches the hand-written marketing
// pages (shared header, footer, styles.css and site.js).
export const titles={'general-trailer':'Introduction','publish-page':'Publish a page update','save-schedule':'Save your personal schedule','change-style':'Change your site style'};
export const sectionIds={'general-trailer':'introduction','publish-page':'publish-page','save-schedule':'save-schedule','change-style':'change-style'};
export const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=s=>escape(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
export const transcriptHtml=s=>s.split('\n\n').map(p=>p.trim()).filter(Boolean).map(p=>p.startsWith('## ')?`        <h4>${inline(p.slice(3))}</h4>`:p.startsWith('# ')?`        <h3>${inline(p.slice(2))}</h3>`:`        <p>${inline(p).replaceAll('\n','<br>')}</p>`).join('\n');
const label=format=>format[0].toUpperCase()+format.slice(1);

/** @param {{piece:string,players:{format:string,seconds:number}[],transcript:string}} section */
function section({piece,players,transcript}){
 const title=titles[piece];
 const figures=players.map(({format,seconds})=>{const name=`${piece}-${format}`;return[
  `        <figure class="${format}">`,
  `        <video controls playsinline preload="none" poster="${name}.png" aria-label="${escape(title)}, ${format}">`,
  `        <source src="${name}.mp4" type="video/mp4">`,
  '        </video>',
  `        <figcaption>${label(format)} · ${seconds} seconds · <a href="${name}.mp4" download>Download MP4</a></figcaption>`,
  '        </figure>'].join('\n');});
 return[
  `      <section class="section video-section" id="${sectionIds[piece]}">`,
  `        <h2>${escape(title)}</h2>`,
  '        <div class="players">',...figures,'        </div>',
  '        <details>',
  '        <summary>Read the descriptive transcript</summary>',
  '        <div class="transcript">',transcriptHtml(transcript),'        </div>',
  `        <a href="${piece}-transcript.md" download>Download transcript</a>`,
  '        </details>',
  '      </section>'].join('\n');
}

const description='Watch an introduction to Event Runner and walkthroughs of page publishing, personal schedules, and site styles.';
const url='https://centercoopmedia.github.io/eventrunner/';
const pageTitle='Videos and walkthroughs | Event Runner';
const imageAlt='Event Runner: conference websites your team can run';

/** @param {Parameters<typeof section>[0][]} sections */
export function videosPage(sections){return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}videos/">
  <link rel="icon" type="image/svg+xml" href="../favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="../favicon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Event Runner">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}videos/">
  <meta property="og:image" content="${url}social-preview.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${imageAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${url}social-preview.png">
  <meta name="twitter:image:alt" content="${imageAlt}">
  <meta name="theme-color" content="#fafaf9" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#191a1c" media="(prefers-color-scheme: dark)">
  <link rel="preload" href="../fonts/source-sans-3-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="../fonts/bricolage-grotesque-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="../tokens.css">
  <link rel="stylesheet" href="../styles.css">
  <script src="../site.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="wrap">
    <header class="site-header">
      <a class="brand" href="../">
        <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <g transform="scale(0.4)" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7 44h7 M8 50h4" fill="none" stroke="rgb(var(--color-accent-rgb))" stroke-width="3.5"/>
            <g transform="matrix(1 0 -0.16 1 8 0)">
              <path d="M28 6 40 23 50 6" fill="none" stroke="rgb(var(--color-accent-rgb))" stroke-width="3.5"/>
              <path d="m31 59-7 10-7-3-1 2 M43 59l9 12 5-2 M54 42l8-8" fill="none" stroke="currentColor" stroke-width="2.8"/>
              <rect x="23" y="23" width="32" height="36" rx="5" fill="rgb(var(--color-surface-rgb))" stroke="currentColor" stroke-width="2.5"/>
              <path d="M24.25 28a3.75 3.75 0 0 1 3.75-3.75h22A3.75 3.75 0 0 1 53.75 28v4.75h-29.5Z" fill="rgb(var(--color-accent-rgb))"/>
              <rect x="35" y="18" width="8" height="7" rx="1.5" fill="currentColor"/>
              <circle cx="33" cy="43" r="2.2" fill="currentColor"/>
              <circle cx="45" cy="43" r="2.2" fill="currentColor"/>
              <path d="M34 50q5 4 10 0" fill="none" stroke="currentColor" stroke-width="2.5"/>
            </g>
          </g>
        </svg>
        <span class="brand-words">
          <strong>Event Runner</strong>
          <span class="brand-line">Conference websites</span>
        </span>
      </a>
      <nav aria-label="Site">
        <a href="../features/">Features</a>
        <a href="../how-it-works/">How it works</a>
        <a href="../docs/">Guides</a>
        <a href="../project/">About</a>
        <a href="../demo/" class="btn nav-cta">Try the demo</a>
      </nav>
    </header>
    <main id="main">
      <section class="page-intro">
        <h1>See the work in motion.</h1>
        <p class="lede">Start with a short introduction. Then watch a page update, a personal schedule, or a site style change, one task at a time.</p>
        <p>These videos use Harborlight Forum, a fictional event. Every instruction appears on screen. Each video has a descriptive transcript.</p>
        <div class="actions"><a class="btn" href="../demo/">Explore the visitor demo</a><a class="btn btn-ghost" href="../docs/">Browse the guides</a></div>
      </section>

${sections.map(section).join('\n\n')}
    </main>
    <footer class="site-footer">
      <div>
        <strong>Event Runner</strong>
        <p>An initiative of the Center for Cooperative Media<br>at Montclair State University.</p>
      </div>
      <nav class="footer-links" aria-label="Footer">
        <a href="../support/">Support</a>
        <a href="../videos/">Videos</a>
        <a href="../docs/">Guides</a>
        <a href="../project/">About</a>
        <a href="../privacy/">Privacy</a>
        <a href="../terms-of-service/">Terms</a>
        <a href="https://github.com/CenterCoopMedia/eventrunner">GitHub</a>
      </nav>
    </footer>
  </div>
</body>
</html>
`;}
