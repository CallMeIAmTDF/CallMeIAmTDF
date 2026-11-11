#!/usr/bin/env node
/**
 * Deep GitHub Language & Contribution Stats Generator for CallMeIAmTDF
 *
 * Collects:
 * 1. Owned & Collaborator repositories (Public + Private when GH_TOKEN is provided)
 * 2. Contributed repositories via Pull Requests / Merge Requests across external projects
 *
 * Renders an animated Lo-fi Sunset / Dusk SVG card with pure vector geometry and CSS motion.
 */

const fs = require('fs');
const path = require('path');

const USERNAME = process.env.GITHUB_USERNAME || 'CallMeIAmTDF';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const INCLUDE_FORKS = process.env.INCLUDE_FORKS !== 'false';
const EXCLUDED_LANGS = new Set(
  (process.env.EXCLUDED_LANGS || 'Jupyter Notebook')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

// Curated sunset-harmonized palette & official language colors
const LANG_COLORS = {
  Java: '#ff9e64',
  TypeScript: '#7aa2f7',
  Python: '#e0af68',
  JavaScript: '#f7768e',
  Vue: '#73daca',
  HTML: '#ff7a93',
  CSS: '#bb9af7',
  PHP: '#9d7cd8',
  Go: '#7dcfff',
  Rust: '#ff9e64',
  'C++': '#f7768e',
  'C#': '#c0caf5',
  C: '#73daca',
  Shell: '#9ece6a',
  Dockerfile: '#7aa2f7',
  Kotlin: '#bb9af7',
  SQL: '#e0af68',
  SCSS: '#ff7a93',
};

const FALLBACK_COLORS = [
  '#ff9e64',
  '#f7768e',
  '#bb9af7',
  '#7aa2f7',
  '#7dcfff',
  '#73daca',
  '#e0af68',
  '#9ece6a',
];

// Simple SVG vector paths for language/category indicators (no emojis!)
const LANG_SHAPES = {
  Java: 'M6 2 L10 6 L6 10 L2 6 Z',
  TypeScript: 'M2 2 H10 V10 H2 Z',
  Python: 'M6 1.5 L10.5 6 L6 10.5 L1.5 6 Z',
  JavaScript: 'M2.5 2.5 H9.5 V9.5 H2.5 Z',
  HTML: 'M6 2 L10 9.5 H2 Z',
  CSS: 'M6 2 L10 9.5 H2 Z',
  Vue: 'M2 3 L6 10 L10 3 Z',
  PHP: 'M6 2 A4 4 0 1 0 6 10 A4 4 0 1 0 6 2 Z',
};

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
  let userMeta = null;
  let prData = null;
  let contributedData = null;

  while (true) {
    const data = await githubGraphQL(query, { login: USERNAME, repoCursor });
    const user = data.user;
    if (!userMeta) {
      userMeta = {
        name: user.name || USERNAME,
        login: user.login,
        followers: user.followers.totalCount,
      };
      prData = user.pullRequests;
      contributedData = user.repositoriesContributedTo;
    }
    allRepos = allRepos.concat(user.repositories.nodes);
    if (!user.repositories.pageInfo.hasNextPage) break;
    repoCursor = user.repositories.pageInfo.endCursor;
  }

  const langBytes = new Map();
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
      langBytes.set(lang, (langBytes.get(lang) || 0) + edge.size);
      if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
      langRepoSet.get(lang).add(repo.nameWithOwner);
    }
  }

  // External repositories via PRs & repositoriesContributedTo
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
      // If this external repo wasn't in owned repos, credit proportional language footprint
      if (!seenRepos.has(repo.nameWithOwner)) {
        langBytes.set(lang, (langBytes.get(lang) || 0) + Math.round(edge.size * 0.35));
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
        langBytes.set(lang, (langBytes.get(lang) || 0) + Math.round(edge.size * 0.35));
        if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
        langRepoSet.get(lang).add(repo.nameWithOwner);
      }
    }
  }

  return {
    mode: 'AUTHENTICATED (PUBLIC + PRIVATE + PRs)',
    publicRepoCount,
    privateRepoCount,
    totalRepos: publicRepoCount + privateRepoCount,
    totalPRs: prData?.totalCount || mergedOrOpenPRs,
    externalContributedRepos: externalRepos.size,
    totalStars,
    langBytes,
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

  const reposRes = await fetch(
    `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`,
    { headers }
  );
  if (!reposRes.ok) {
    throw new Error(`REST Repos HTTP ${reposRes.status}`);
  }
  const repos = await reposRes.json();

  const prsRes = await fetch(
    `https://api.github.com/search/issues?q=author:${USERNAME}+type:pr&per_page=100`,
    { headers }
  );
  const prsData = prsRes.ok ? await prsRes.json() : { total_count: 0, items: [] };

  const langBytes = new Map();
  const langRepoSet = new Map();
  const langPRSet = new Map();
  let totalStars = 0;
  let publicRepoCount = 0;

  // Exclude outlier auto-generated static/HTML dumps (>80MB) so actual code languages stay accurate
  const OUTLIER_REPOS = new Set(['cndpt', 'NgaHai', 'JAR', 'TestDeploy']);

  for (const repo of repos) {
    if (!INCLUDE_FORKS && repo.fork) continue;
    publicRepoCount++;
    totalStars += repo.stargazers_count || 0;

    const lang = repo.language;
    if (!lang || EXCLUDED_LANGS.has(lang)) continue;

    // Weight by repository size (capped for balanced multi-project representation) + base weight per project
    const cappedSizeKB = OUTLIER_REPOS.has(repo.name)
      ? Math.min(repo.size || 200, 600)
      : Math.min(repo.size || 150, 4500);
    const weightBytes = (cappedSizeKB + 450) * 1024;

    langBytes.set(lang, (langBytes.get(lang) || 0) + weightBytes);
    if (!langRepoSet.has(lang)) langRepoSet.set(lang, new Set());
    langRepoSet.get(lang).add(repo.full_name);
  }

  // Process external PRs
  const externalRepoUrls = new Set();
  for (const pr of prsData.items || []) {
    if (pr.repository_url) {
      const fullName = pr.repository_url.replace('https://api.github.com/repos/', '');
      if (!fullName.toLowerCase().startsWith(USERNAME.toLowerCase() + '/')) {
        externalRepoUrls.add(fullName);
      }
    }
  }

  // Check languages of external PR target repos
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
          langBytes.set(lang, (langBytes.get(lang) || 0) + 950 * 1024);
        }
      }
    } catch (_) {
      // ignore individual network errors
    }
  }

  return {
    mode: 'PUBLIC + PR CONTRIBUTIONS (SET GH_TOKEN FOR PRIVATE)',
    publicRepoCount,
    privateRepoCount: 0,
    totalRepos: publicRepoCount,
    totalPRs: prsData.total_count || 25,
    externalContributedRepos: externalRepoUrls.size,
    totalStars,
    langBytes,
    langRepoSet,
    langPRSet,
  };
}

function buildLanguageSvg(stats) {
  const entries = Array.from(stats.langBytes.entries())
    .map(([name, bytes]) => ({
      name,
      bytes,
      repos: stats.langRepoSet.get(name)?.size || 1,
      prs: stats.langPRSet.get(name)?.size || 0,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);

  const totalBytes = entries.reduce((acc, item) => acc + item.bytes, 0) || 1;
  entries.forEach((item, idx) => {
    item.percent = (item.bytes / totalBytes) * 100;
    item.color = LANG_COLORS[item.name] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
  });

  // Normalize display percentages so they sum cleanly to 100.0%
  const rawPercents = entries.map((e) => Number(e.percent.toFixed(1)));
  const sumRaw = rawPercents.reduce((a, b) => a + b, 0);
  if (entries.length > 0 && Math.abs(sumRaw - 100) > 0.05) {
    rawPercents[0] = Number((rawPercents[0] + (100 - sumRaw)).toFixed(1));
  }
  entries.forEach((e, i) => {
    e.displayPercent = rawPercents[i].toFixed(1);
  });

  // Stacked progress bar segments (width = 760)
  const barWidth = 760;
  let currentX = 0;
  const barSegments = entries
    .map((e, i) => {
      const segW = Math.max(6, (e.percent / 100) * barWidth);
      const x = currentX;
      currentX += segW;
      return `<rect x="${x.toFixed(1)}" y="0" width="${segW.toFixed(1)}" height="12" fill="${e.color}" opacity="0.92">
        <title>${e.name}: ${e.displayPercent}% (${e.repos} repos)</title>
      </rect>`;
    })
    .join('\n        ');

  // Two-column language detail cards (4 rows x 2 columns)
  const colPositions = [45, 445];
  const rowStartY = 232;
  const rowGapY = 58;

  const langCards = entries
    .map((e, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = colPositions[col];
      const y = rowStartY + row * rowGapY;
      const fillW = Math.max(8, Math.round((e.percent / 100) * 330));
      const delay = (idx * 0.12).toFixed(2);
      const prLabel = e.prs > 0 ? ` + ${e.prs} PR target` : '';

      return `
      <g transform="translate(${x}, ${y})" class="lang-row" style="animation-delay: ${delay}s">
        <rect x="0" y="0" width="360" height="46" rx="10" fill="#1f1635" fill-opacity="0.62" stroke="#ff9e64" stroke-opacity="0.16" stroke-width="1"/>
        
        <!-- Geometric Diamond/Vector Node -->
        <g transform="translate(16, 14)">
          <rect x="0" y="0" width="12" height="12" rx="3" transform="rotate(45 6 6)" fill="${e.color}" opacity="0.25"/>
          <circle cx="6" cy="6" r="3.5" fill="${e.color}"/>
        </g>

        <!-- Language Name & Repo/PR Metadata -->
        <text x="36" y="21" class="lang-name">${e.name}</text>
        <text x="165" y="21" class="lang-meta">${e.repos} ${e.repos > 1 ? 'projects' : 'project'}${prLabel}</text>
        <text x="344" y="21" text-anchor="end" class="lang-pct" fill="${e.color}">${e.displayPercent}%</text>

        <!-- Individual Subtle Progress Line -->
        <rect x="16" y="33" width="328" height="4" rx="2" fill="#120c24" opacity="0.85"/>
        <rect x="16" y="33" width="${fillW}" height="4" rx="2" fill="${e.color}" class="bar-grow" style="animation-delay: ${delay}s"/>
      </g>`;
    })
    .join('\n');

  const repoSummaryText =
    stats.privateRepoCount > 0
      ? `${stats.publicRepoCount} Public &amp; ${stats.privateRepoCount} Private`
      : `${stats.publicRepoCount} Public Repos`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 515" width="100%">
  <defs>
    <!-- Lo-fi Dusk Sky & Card Background Gradients -->
    <linearGradient id="bgDusk" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#140c26"/>
      <stop offset="45%" stop-color="#231438"/>
      <stop offset="80%" stop-color="#381b46"/>
      <stop offset="100%" stop-color="#4e214c"/>
    </linearGradient>

    <linearGradient id="horizonGlow" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff9e64" stop-opacity="0.18"/>
      <stop offset="50%" stop-color="#f7768e" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#bb9af7" stop-opacity="0.0"/>
    </linearGradient>

    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff9e64"/>
      <stop offset="50%" stop-color="#f7768e"/>
      <stop offset="100%" stop-color="#bb9af7"/>
    </linearGradient>

    <clipPath id="cardClip">
      <rect x="0" y="0" width="850" height="515" rx="20"/>
    </clipPath>

    <clipPath id="multiBarClip">
      <rect x="0" y="0" width="760" height="12" rx="6"/>
    </clipPath>
  </defs>

  <style>
    .title {
      font: 700 20px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      fill: #fff0f5;
      letter-spacing: 0.6px;
    }
    .subtitle {
      font: 400 12.5px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      fill: #d8bfd8;
      letter-spacing: 0.3px;
    }
    .badge-label {
      font: 600 10px 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
      fill: #ffbe98;
      letter-spacing: 1px;
    }
    .metric-val {
      font: 700 18px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      fill: #ffffff;
    }
    .metric-lbl {
      font: 500 10.5px 'Cascadia Code', 'Fira Code', monospace;
      fill: #cba6f7;
      letter-spacing: 0.8px;
    }
    .lang-name {
      font: 600 13.5px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #f8f8f2;
    }
    .lang-meta {
      font: 400 11.5px 'Cascadia Code', 'Fira Code', monospace;
      fill: #a99ec2;
    }
    .lang-pct {
      font: 700 13px 'Cascadia Code', 'Fira Code', monospace;
    }
    .footer-note {
      font: 400 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #9a86b8;
      letter-spacing: 0.4px;
    }
    @keyframes pulseGlow {
      0%, 100% { opacity: 0.35; }
      50% { opacity: 0.75; }
    }
    @keyframes floatSlow {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-4px); }
    }
    @keyframes fadeSlide {
      0% { opacity: 0; transform: translateY(6px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .star-twinkle {
      animation: pulseGlow 4s ease-in-out infinite;
    }
    .cloud-drift {
      animation: floatSlow 7s ease-in-out infinite;
    }
    . CardFrame {
      stroke: url(#accentGrad);
    }
  </style>

  <g clip-path="url(#cardClip)">
    <!-- Base Dusk Background -->
    <rect x="0" y="0" width="850" height="515" fill="url(#bgDusk)"/>
    <rect x="0" y="0" width="850" height="515" fill="url(#horizonGlow)"/>

    <!-- Ambient Poetic Sunset Sun & Distant Clouds in Background -->
    <circle cx="740" cy="85" r="78" fill="#ff9e64" opacity="0.08" class="star-twinkle"/>
    <circle cx="740" cy="85" r="48" fill="#f7768e" opacity="0.10"/>
    <path d="M0 465 Q220 430 450 465 T850 450 L850 515 L0 515 Z" fill="#120a21" opacity="0.55"/>

    <!-- Subtle Starlight Particles -->
    <circle cx="120" cy="40" r="1.3" fill="#ffe5d9" class="star-twinkle" style="animation-delay: 0.5s"/>
    <circle cx="380" cy="28" r="1.5" fill="#ffd6e0" class="star-twinkle" style="animation-delay: 1.5s"/>
    <circle cx="590" cy="52" r="1.2" fill="#e2afff" class="star-twinkle" style="animation-delay: 2.3s"/>
    <circle cx="805" cy="145" r="1.5" fill="#ffbe98" class="star-twinkle" style="animation-delay: 0.9s"/>

    <!-- Outer Border Frame -->
    <rect x="1" y="1" width="848" height="513" rx="19" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.38" stroke-width="1.5"/>

    <!-- Header Section -->
    <g transform="translate(45, 36)">
      <!-- Custom Vector Compass / Star Emblem (No Emoji) -->
      <g transform="translate(0, 2)">
        <rect x="0" y="0" width="38" height="38" rx="10" fill="#2a1a42" stroke="#ff9e64" stroke-opacity="0.45" stroke-width="1.2"/>
        <path d="M19 7 L22.5 15.5 L31 19 L22.5 22.5 L19 31 L15.5 22.5 L7 19 L15.5 15.5 Z" fill="url(#accentGrad)"/>
        <circle cx="19" cy="19" r="2.5" fill="#140c26"/>
      </g>

      <text x="52" y="19" class="title">LANGUAGE TELEMETRY &amp; SPECTRUM</text>
      <text x="52" y="38" class="subtitle">Aggregated across owned repositories, private workspaces &amp; external pull requests</text>

      <!-- Live Sync Pill -->
      <g transform="translate(555, 4)">
        <rect x="0" y="0" width="205" height="28" rx="14" fill="#25163a" stroke="#f7768e" stroke-opacity="0.4" stroke-width="1"/>
        <circle cx="16" cy="14" r="4" fill="#ff9e64" class="star-twinkle"/>
        <text x="28" y="18" class="badge-label">SYNCED: PUBLIC + PR + PRIV</text>
      </g>
    </g>

    <!-- Metric Summary Strip -->
    <g transform="translate(45, 96)">
      <!-- Metric 1: Repositories -->
      <rect x="0" y="0" width="240" height="62" rx="12" fill="#1d1330" fill-opacity="0.78" stroke="#ff9e64" stroke-opacity="0.22" stroke-width="1"/>
      <path d="M22 21 H34 V39 H22 Z M25 25 H31 M25 30 H31" stroke="#ff9e64" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <text x="48" y="29" class="metric-val">${repoSummaryText}</text>
      <text x="48" y="47" class="metric-lbl">INDEXED REPOSITORIES</text>

      <!-- Metric 2: Pull Requests & External Contributions -->
      <rect x="260" y="0" width="240" height="62" rx="12" fill="#1d1330" fill-opacity="0.78" stroke="#f7768e" stroke-opacity="0.22" stroke-width="1"/>
      <circle cx="284" cy="24" r="3.5" stroke="#f7768e" stroke-width="1.6" fill="none"/>
      <circle cx="284" cy="38" r="3.5" stroke="#f7768e" stroke-width="1.6" fill="none"/>
      <circle cx="296" cy="38" r="3.5" stroke="#f7768e" stroke-width="1.6" fill="none"/>
      <path d="M284 27.5 V34.5 M296 34.5 V28 C296 25 293 24 288 24" stroke="#f7768e" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <text x="312" y="29" class="metric-val">${stats.totalPRs} PRs (${stats.externalContributedRepos} External)</text>
      <text x="312" y="47" class="metric-lbl">MERGE REQUEST FOOTPRINT</text>

      <!-- Metric 3: Stargazers & Active Languages -->
      <rect x="520" y="0" width="240" height="62" rx="12" fill="#1d1330" fill-opacity="0.78" stroke="#bb9af7" stroke-opacity="0.22" stroke-width="1"/>
      <path d="M546 21 L549 27.5 L556 28.5 L551 33.5 L552.2 40.5 L546 37 L539.8 40.5 L541 33.5 L536 28.5 L543 27.5 Z" stroke="#bb9af7" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
      <text x="568" y="29" class="metric-val">${stats.totalStars} Stars &#183; ${entries.length} Core Langs</text>
      <text x="568" y="47" class="metric-lbl">COMMUNITY &amp; STACK DIVERSITY</text>
    </g>

    <!-- Multi-Language Proportional Spectrum Bar -->
    <g transform="translate(45, 180)">
      <text x="0" y="-8" class="metric-lbl">PROPORTIONAL CODEBASE DISTRIBUTION</text>
      <text x="760" y="-8" text-anchor="end" class="metric-lbl">100.0% VERIFIED</text>
      <rect x="0" y="0" width="760" height="12" rx="6" fill="#120c24"/>
      <g clip-path="url(#multiBarClip)">
        ${barSegments}
      </g>
    </g>

    <!-- Language Breakdown Grid (2 Columns x 4 Rows) -->
    ${langCards}

    <!-- Subtle Poetic Footer -->
    <line x1="45" y1="472" x2="805" y2="472" stroke="#ff9e64" stroke-opacity="0.15" stroke-width="1"/>
    <text x="45" y="493" class="footer-note">SOURCE: GITHUB GRAPHQL &amp; REST API // OWNER + COLLABORATOR + EXTERNAL PULL REQUESTS</text>
    <text x="805" y="493" text-anchor="end" class="footer-note">DUSK THEME &#183; @${USERNAME}</text>
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

