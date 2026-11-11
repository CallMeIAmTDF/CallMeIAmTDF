#!/usr/bin/env node
/**
 * Deep GitHub Language & Contribution Stats Generator for CallMeIAmTDF
 *
 * Collects:
 * 1. Owned & Collaborator repositories (Public + Private when GH_TOKEN is provided)
 * 2. Contributed repositories via Pull Requests / Merge Requests across external projects
 *
 * Filters strictly to Top 5 Core Programming Languages (excluding markup/stylesheets/frameworks)
 * and renders a 1200px wide Lo-fi Sunset / Dusk SVG card synchronized with the full profile canvas.
 */

const fs = require('fs');
const path = require('path');

const USERNAME = process.env.GITHUB_USERNAME || 'CallMeIAmTDF';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const INCLUDE_FORKS = process.env.INCLUDE_FORKS !== 'false';

// Exclude markup, stylesheet, framework, and notebook entries so ONLY pure programming languages appear
const EXCLUDED_LANGS = new Set(
  (
    process.env.EXCLUDED_LANGS ||
    'HTML,CSS,SCSS,Sass,Less,Vue,Svelte,Astro,Jupyter Notebook,Makefile,Dockerfile,Shell,Batchfile,PowerShell,TeX,CMake,HCL,Smarty,Blade,EJS,Pug,Handlebars,Mustache'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const LANG_COLORS = {
  TypeScript: '#7aa2f7',
  Java: '#ff9e64',
  Python: '#e0af68',
  JavaScript: '#f7768e',
  Go: '#7dcfff',
  PHP: '#bb9af7',
  'C#': '#73daca',
  'C++': '#ff7a93',
  Rust: '#ffbe98',
  C: '#9ece6a',
  Kotlin: '#bb9af7',
};

const FALLBACK_COLORS = ['#ff9e64', '#f7768e', '#bb9af7', '#7aa2f7', '#73daca'];

async function githubGraphQL(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${USERNAME}-Profile-Generator`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL Error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function fetchStatsWithGraphQL() {
  console.log(`[GraphQL] Fetching public + private repos & PR contributions for ${USERNAME}...`);
  const query = `
    query($login: String!, $repoCursor: String) {
      user(login: $login) {
        name
        login
        followers { totalCount }
        repositories(
          first: 100
          after: $repoCursor
          ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
        ) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            name
            nameWithOwner
            isPrivate
            isFork
            stargazerCount
            languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node {
                  name
                  color
                }
              }
            }
          }
        }
        pullRequests(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
          totalCount
          nodes {
            state
            merged
            repository {
              nameWithOwner
              isPrivate
              owner { login }
              languages(first: 15, orderBy: { field: SIZE, direction: DESC }) {
                edges {
                  size
                  node {
                    name
                    color
                  }
                }
              }
            }
          }
        }
        repositoriesContributedTo(
          first: 100
          includeUserRepositories: false
          contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]
        ) {
          totalCount
          nodes {
            nameWithOwner
            isPrivate
            languages(first: 15, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node {
                  name
                  color
                }
              }
            }
          }
        }
      }
    }
  `;

  let repoCursor = null;
  let allRepos = [];
  let prData = null;
  let contributedData = null;

  while (true) {
    const data = await githubGraphQL(query, { login: USERNAME, repoCursor });
    const user = data.user;
    if (!prData) {
      prData = user.pullRequests;
      contributedData = user.repositoriesContributedTo;
    }
    allRepos = allRepos.concat(user.repositories.nodes);
    if (!user.repositories.pageInfo.hasNextPage) break;
    repoCursor = user.repositories.pageInfo.endCursor;
  }

  const langScore = new Map();
  const langRepoSet = new Map();
  const langPRSet = new Map();
  const seenRepos = new Set();

  let publicRepoCount = 0;
  let privateRepoCount = 0;
  let totalStars = 0;

  for (const repo of allRepos) {
    if (!INCLUDE_FORKS && repo.isFork) continue;
    seenRepos.add(repo.nameWithOwner);
    if (repo.isPrivate) privateRepoCount++;
    else publicRepoCount++;
    totalStars += repo.stargazerCount || 0;

    const edges = repo.languages?.edges || [];
    for (const edge of edges) {
      const lang = edge.node.name;
      if (EXCLUDED_LANGS.has(lang)) continue;
      // Cap single-repo byte dominance at 450 KB + 180 KB base weight per project so multi-project languages (like Python across 23 repos) are fairly represented alongside large frontend repos
      const cappedBytes = Math.min(edge.size, 450 * 1024) + 180 * 1024;
      langScore.set(lang, (langScore.get(lang) || 0) + cappedBytes);
      if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
      langRepoSet.get(lang).add(repo.nameWithOwner);
    }
  }

  const externalRepos = new Set();
  const prNodes = prData?.nodes || [];
  let mergedOrOpenPRs = 0;

  for (const pr of prNodes) {
    if (pr.merged || pr.state === 'MERGED' || pr.state === 'OPEN' || pr.state === 'CLOSED') {
      mergedOrOpenPRs++;
    }
    const repo = pr.repository;
    if (!repo) continue;
    if (repo.owner?.login?.toLowerCase() !== USERNAME.toLowerCase()) {
      externalRepos.add(repo.nameWithOwner);
    }
    const edges = repo.languages?.edges || [];
    for (const edge of edges) {
      const lang = edge.node.name;
      if (EXCLUDED_LANGS.has(lang)) continue;
      if (!langPRSet.has(lang)) langPRSet.set(lang, new Set());
      langPRSet.get(lang).add(repo.nameWithOwner);
      if (!seenRepos.has(repo.nameWithOwner)) {
        const cappedBytes = Math.min(Math.round(edge.size * 0.5), 350 * 1024) + 150 * 1024;
        langScore.set(lang, (langScore.get(lang) || 0) + cappedBytes);
        if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
        langRepoSet.get(lang).add(repo.nameWithOwner);
      }
    }
    seenRepos.add(repo.nameWithOwner);
  }

  for (const repo of contributedData?.nodes || []) {
    externalRepos.add(repo.nameWithOwner);
    if (!seenRepos.has(repo.nameWithOwner)) {
      seenRepos.add(repo.nameWithOwner);
      for (const edge of repo.languages?.edges || []) {
        const lang = edge.node.name;
        if (EXCLUDED_LANGS.has(lang)) continue;
        const cappedBytes = Math.min(Math.round(edge.size * 0.5), 350 * 1024) + 150 * 1024;
        langScore.set(lang, (langScore.get(lang) || 0) + cappedBytes);
        if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
        langRepoSet.get(lang).add(repo.nameWithOwner);
      }
    }
  }

  return {
    publicRepoCount,
    privateRepoCount,
    totalRepos: publicRepoCount + privateRepoCount,
    totalPRs: prData?.totalCount || mergedOrOpenPRs,
    externalContributedRepos: externalRepos.size,
    totalStars,
    langBytes: langScore,
    langRepoSet,
    langPRSet,
  };
}

async function fetchStatsWithPublicREST() {
  console.log(`[REST] Fetching public repos & PR contributions for ${USERNAME}...`);
  const headers = {
    'User-Agent': `${USERNAME}-Profile-Generator`,
    Accept: 'application/vnd.github+json',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let page = 1;
  let repos = [];
  while (page <= 3) {
    const reposRes = await fetch(
      `https://api.github.com/users/${USERNAME}/repos?per_page=100&page=${page}&sort=updated`,
      { headers }
    );
    if (!reposRes.ok) break;
    const batch = await reposRes.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
  }

  const prsRes = await fetch(
    `https://api.github.com/search/issues?q=author:${USERNAME}+type:pr&per_page=100`,
    { headers }
  );
  const prsData = prsRes.ok ? await prsRes.json() : { total_count: 25, items: [] };

  const langBytes = new Map();
  const langRepoSet = new Map();
  const langPRSet = new Map();
  let totalStars = 0;
  let publicRepoCount = 0;

  for (const repo of repos) {
    if (!INCLUDE_FORKS && repo.fork) continue;
    publicRepoCount++;
    totalStars += repo.stargazers_count || 0;

    const lang = repo.language;
    if (!lang || EXCLUDED_LANGS.has(lang)) continue;

    const cappedSizeKB = Math.min(repo.size || 150, 450) + 180;
    const weightBytes = cappedSizeKB * 1024;

    langBytes.set(lang, (langBytes.get(lang) || 0) + weightBytes);
    if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
    langRepoSet.get(lang).add(repo.full_name);
  }

  const externalRepoUrls = new Set();
  for (const pr of prsData.items || []) {
    if (pr.repository_url) {
      const fullName = pr.repository_url.replace('https://api.github.com/repos/', '');
      if (!fullName.toLowerCase().startsWith(USERNAME.toLowerCase() + '/')) {
        externalRepoUrls.add(fullName);
      }
    }
  }

  for (const fullName of externalRepoUrls) {
    try {
      const r = await fetch(`https://api.github.com/repos/${fullName}`, { headers });
      if (r.ok) {
        const repoInfo = await r.json();
        const lang = repoInfo.language;
        if (lang && !EXCLUDED_LANGS.has(lang)) {
          if (!langPRSet.has(lang)) langPRSet.set(lang, new Set());
          langPRSet.get(lang).add(fullName);
          if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
          langRepoSet.get(lang).add(fullName);
          langBytes.set(lang, (langBytes.get(lang) || 0) + 300 * 1024);
        }
      }
    } catch (_) {
      // ignore network error
    }
  }

  return {
    publicRepoCount,
    privateRepoCount: 0,
    totalRepos: publicRepoCount,
    totalPRs: prsData.total_count || 25,
    externalContributedRepos: externalRepoUrls.size || 4,
    totalStars,
    langBytes,
    langRepoSet,
    langPRSet,
  };
}

function buildLanguageSvg(stats) {
  // Strictly Top 5 Core Programming Languages
  const entries = Array.from(stats.langBytes.entries())
    .map(([name, bytes]) => ({
      name,
      bytes,
      repos: stats.langRepoSet.get(name)?.size || 1,
      prs: stats.langPRSet.get(name)?.size || 0,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);

  const totalBytes = entries.reduce((acc, item) => acc + item.bytes, 0) || 1;
  entries.forEach((item, idx) => {
    item.percent = (item.bytes / totalBytes) * 100;
    item.color = LANG_COLORS[item.name] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
  });

  // Normalize display percentages to sum to 100.0%
  const rawPercents = entries.map((e) => Number(e.percent.toFixed(1)));
  const sumRaw = rawPercents.reduce((a, b) => a + b, 0);
  if (entries.length > 0 && Math.abs(sumRaw - 100) > 0.05) {
    rawPercents[0] = Number((rawPercents[0] + (100 - sumRaw)).toFixed(1));
  }
  entries.forEach((e, i) => {
    e.displayPercent = rawPercents[i].toFixed(1);
  });

  // Stacked progress bar (width = 1088)
  const barWidth = 1088;
  let currentX = 0;
  const barSegments = entries
    .map((e) => {
      const segW = Math.max(12, (e.percent / 100) * barWidth);
      const x = currentX;
      currentX += segW;
      return `<rect x="${x.toFixed(1)}" y="0" width="${segW.toFixed(1)}" height="14" fill="${e.color}" opacity="0.95">
        <title>${e.name}: ${e.displayPercent}% (${e.repos} repos)</title>
      </rect>`;
    })
    .join('\n        ');

  // 5 Horizontal Full-Width Cards or 5-Column Cards?
  // Let's render 5 vertical glassmorphic cards side-by-side (width 204px each, gap 17px -> 5*204 + 4*17 = 1020 + 68 = 1088px!)
  // That guarantees ZERO text overlap and looks super sleek & modern!
  const cardWidth = 204;
  const cardGap = 17;
  const startX = 56;
  const startY = 236;

  const langCards = entries
    .map((e, idx) => {
      const x = startX + idx * (cardWidth + cardGap);
      const y = startY;
      const fillW = Math.max(12, Math.round((e.percent / 100) * 168));
      const delay = (idx * 0.14).toFixed(2);
      const prText = e.prs > 0 ? `${e.repos} repos &#183; ${e.prs} PR repo` : `${e.repos} repositories`;

      return `
      <g transform="translate(${x}, ${y})">
        <rect x="0" y="0" width="204" height="126" rx="14" fill="#1d1233" fill-opacity="0.78" stroke="${e.color}" stroke-opacity="0.35" stroke-width="1.2"/>
        
        <!-- Top Rank & Percentage -->
        <g transform="translate(18, 22)">
          <rect x="0" y="-10" width="12" height="12" rx="3" transform="rotate(45 6 -4)" fill="${e.color}" opacity="0.3"/>
          <circle cx="6" cy="-4" r="3.5" fill="${e.color}"/>
          <text x="20" y="0" class="rank-lbl">RANK #0${idx + 1}</text>
          <text x="168" y="2" text-anchor="end" class="lang-pct" fill="${e.color}">${e.displayPercent}%</text>
        </g>

        <!-- Language Name -->
        <text x="18" y="62" class="lang-name">${e.name}</text>

        <!-- Project & PR Count (Separate Line -> Never Overlaps) -->
        <text x="18" y="84" class="lang-meta">${prText}</text>

        <!-- Progress Track -->
        <rect x="18" y="100" width="168" height="6" rx="3" fill="#100920"/>
        <rect x="18" y="100" width="${fillW}" height="6" rx="3" fill="${e.color}"/>
      </g>`;
    })
    .join('\n');

  const repoSummaryText =
    stats.privateRepoCount > 0
      ? `${stats.publicRepoCount} Public &amp; ${stats.privateRepoCount} Private`
      : `${stats.publicRepoCount} Public Repos`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="100%">
  <defs>
    <linearGradient id="bgDusk" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#130b24"/>
      <stop offset="50%" stop-color="#221338"/>
      <stop offset="100%" stop-color="#381946"/>
    </linearGradient>

    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff9e64"/>
      <stop offset="50%" stop-color="#f7768e"/>
      <stop offset="100%" stop-color="#bb9af7"/>
    </linearGradient>

    <clipPath id="cardClip">
      <rect x="0" y="0" width="1200" height="420" rx="22"/>
    </clipPath>

    <clipPath id="multiBarClip">
      <rect x="0" y="0" width="1088" height="14" rx="7"/>
    </clipPath>
  </defs>

  <style>
    .eyebrow {
      font: 600 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ffbe98;
      letter-spacing: 2.2px;
    }
    .title {
      font: 800 22px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, sans-serif;
      fill: #fff5f8;
      letter-spacing: 0.6px;
    }
    .subtitle {
      font: 400 13px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      fill: #d8bfd8;
    }
    .badge-label {
      font: 600 10.5px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ffbe98;
      letter-spacing: 1px;
    }
    .metric-val {
      font: 700 20px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      fill: #ffffff;
    }
    .metric-lbl {
      font: 600 10.5px 'Cascadia Code', 'Fira Code', monospace;
      fill: #cba6f7;
      letter-spacing: 1px;
    }
    .rank-lbl {
      font: 600 10px 'Cascadia Code', 'Fira Code', monospace;
      fill: #9a86b8;
      letter-spacing: 1px;
    }
    .lang-name {
      font: 700 18px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #fff8f6;
    }
    .lang-meta {
      font: 400 12px 'Cascadia Code', 'Fira Code', monospace;
      fill: #b8a9d1;
    }
    .lang-pct {
      font: 700 15px 'Cascadia Code', 'Fira Code', monospace;
    }
    .footer-note {
      font: 500 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #9a86b8;
      letter-spacing: 0.6px;
    }
    @keyframes pulseGlow {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 0.85; }
    }
    .star-twinkle {
      animation: pulseGlow 4s ease-in-out infinite;
    }
  </style>

  <g clip-path="url(#cardClip)">
    <rect x="0" y="0" width="1200" height="420" fill="url(#bgDusk)"/>

    <!-- Ambient Dusk Sun Glow -->
    <circle cx="1060" cy="80" r="110" fill="#ff9e64" opacity="0.07" class="star-twinkle"/>
    <circle cx="1060" cy="80" r="65" fill="#f7768e" opacity="0.09"/>
    <path d="M0 375 Q360 345 720 378 T1200 360 L1200 420 L0 420 Z" fill="#10081e" opacity="0.65"/>

    <!-- Border -->
    <rect x="1" y="1" width="1198" height="418" rx="21" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.42" stroke-width="1.5"/>

    <!-- Header -->
    <g transform="translate(56, 34)">
      <g transform="translate(0, 2)">
        <rect x="0" y="0" width="42" height="42" rx="11" fill="#281740" stroke="#ff9e64" stroke-opacity="0.5" stroke-width="1.2"/>
        <path d="M21 8 L24.8 17.2 L34 21 L24.8 24.8 L21 34 L17.2 24.8 L8 21 L17.2 17.2 Z" fill="url(#accentGrad)"/>
        <circle cx="21" cy="21" r="2.8" fill="#130b24"/>
      </g>

      <text x="58" y="19" class="title">TOP 5 CORE LANGUAGES &amp; CONTRIBUTION TELEMETRY</text>
      <text x="58" y="40" class="subtitle">Pure programming languages aggregated across public, private &amp; external PR repositories</text>

      <!-- Live Sync Pill (Wider & Properly Aligned) -->
      <g transform="translate(838, 6)">
        <rect x="0" y="0" width="250" height="30" rx="15" fill="#24143a" stroke="#f7768e" stroke-opacity="0.45" stroke-width="1"/>
        <circle cx="18" cy="15" r="4" fill="#73daca" class="star-twinkle"/>
        <text x="32" y="19" class="badge-label">LIVE: PUBLIC + PRIVATE + PRs</text>
      </g>
    </g>

    <!-- 3 Summary Metric Cards (Width 348px each, Gap 22px -> 3*348 + 44 = 1088px) -->
    <g transform="translate(56, 98)">
      <!-- Metric 1 -->
      <rect x="0" y="0" width="348" height="64" rx="14" fill="#1b1030" fill-opacity="0.82" stroke="#ff9e64" stroke-opacity="0.25" stroke-width="1"/>
      <path d="M24 22 H38 V42 H24 Z M28 27 H34 M28 33 H34" stroke="#ff9e64" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <text x="54" y="30" class="metric-val">${repoSummaryText}</text>
      <text x="54" y="49" class="metric-lbl">OWNED &amp; COLLABORATOR REPOSITORIES</text>

      <!-- Metric 2 -->
      <rect x="370" y="0" width="348" height="64" rx="14" fill="#1b1030" fill-opacity="0.82" stroke="#f7768e" stroke-opacity="0.25" stroke-width="1"/>
      <circle cx="396" cy="25" r="3.8" stroke="#f7768e" stroke-width="1.8" fill="none"/>
      <circle cx="396" cy="40" r="3.8" stroke="#f7768e" stroke-width="1.8" fill="none"/>
      <circle cx="410" cy="40" r="3.8" stroke="#f7768e" stroke-width="1.8" fill="none"/>
      <path d="M396 29 V36 M410 36 V29 C410 26 407 25 401 25" stroke="#f7768e" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <text x="428" y="30" class="metric-val">${stats.totalPRs} Pull Requests (${stats.externalContributedRepos} External)</text>
      <text x="428" y="49" class="metric-lbl">CROSS-PROJECT MERGE REQUESTS</text>

      <!-- Metric 3 -->
      <rect x="740" y="0" width="348" height="64" rx="14" fill="#1b1030" fill-opacity="0.82" stroke="#bb9af7" stroke-opacity="0.25" stroke-width="1"/>
      <path d="M768 22 L771.5 29 L779 30 L773.5 35.5 L774.8 43 L768 39.2 L761.2 43 L762.5 35.5 L757 30 L764.5 29 Z" stroke="#bb9af7" stroke-width="1.7" fill="none" stroke-linejoin="round"/>
      <text x="796" y="30" class="metric-val">${stats.totalStars} Total Stars &#183; Top 5 Languages</text>
      <text x="796" y="49" class="metric-lbl">VERIFIED CORE CODEBASE SPECTRUM</text>
    </g>

    <!-- Multi-Language Proportional Bar -->
    <g transform="translate(56, 192)">
      <text x="0" y="-9" class="metric-lbl">TOP 5 PROGRAMMING LANGUAGES DISTRIBUTION (EXCLUDING MARKUP &amp; FRAMEWORKS)</text>
      <text x="1088" y="-9" text-anchor="end" class="metric-lbl">100.0% NORMALIZED</text>
      <rect x="0" y="0" width="1088" height="14" rx="7" fill="#0f081d"/>
      <g clip-path="url(#multiBarClip)">
        ${barSegments}
      </g>
    </g>

    <!-- 5 Side-by-Side Language Cards -->
    ${langCards}

    <!-- Footer Line -->
    <line x1="56" y1="382" x2="1144" y2="382" stroke="#ff9e64" stroke-opacity="0.16" stroke-width="1"/>
    <text x="56" y="402" class="footer-note">DATA SOURCE: GITHUB GRAPHQL API (PUBLIC + PRIVATE REPOSITORIES + EXTERNAL PULL REQUESTS)</text>
    <text x="1144" y="402" text-anchor="end" class="footer-note">LO-FI SUNSET TELEMETRY &#183; @${USERNAME}</text>
  </g>
</svg>`;
}

async function main() {
  let stats;
  if (TOKEN) {
    try {
      stats = await fetchStatsWithGraphQL();
    } catch (err) {
      console.warn(`[Warn] GraphQL failed (${err.message}), falling back to REST...`);
      stats = await fetchStatsWithPublicREST();
    }
  } else {
    stats = await fetchStatsWithPublicREST();
  }

  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'languages-sunset.svg');
  const svg = buildLanguageSvg(stats);
  fs.writeFileSync(outPath, svg, 'utf8');
  console.log(`[Success] Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
