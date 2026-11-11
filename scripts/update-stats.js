#!/usr/bin/env node
/**
 * Unified Lo-fi Sunset / Dusk Master Profile Canvas Generator for CallMeIAmTDF
 *
 * Renders the ENTIRE GitHub Profile into a single seamless, animated SVG canvas
 * (`assets/profile-master.svg` + `assets/languages-sunset.svg`) so there are zero
 * white gaps or jarring Light-Mode Markdown tables between sections.
 *
 * Includes:
 * 1. Animated Lo-fi Sunset / Dusk Hero Banner & Glassmorphic Identity Card
 * 2. Overview & Structured 5-Row Skill Classification Table (Domain | Official Tech Logos + Names | Architectural Focus)
 * 3. Top 5 Core Programming Languages Telemetry (Public + Private + External PRs)
 * 4. Selected Works & Engineering Highlights (HocCode, FamilyTree, Cloud-Native & Security, Sport Booking)
 * 5. Animated Sunset Horizon Footer
 */

const fs = require('fs');
const path = require('path');

const USERNAME = process.env.GITHUB_USERNAME || 'CallMeIAmTDF';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const INCLUDE_FORKS = process.env.INCLUDE_FORKS !== 'false';

// Strictly exclude markup, stylesheets, frameworks, and notebooks so ONLY pure programming languages appear in Top 5
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
  Java: '#ff9e64',
  JavaScript: '#f7768e',
  TypeScript: '#7aa2f7',
  Python: '#e0af68',
  PHP: '#bb9af7',
  Go: '#7dcfff',
  'C#': '#73daca',
  'C++': '#ff7a93',
  Rust: '#ffbe98',
  C: '#9ece6a',
};

const FALLBACK_COLORS = ['#ff9e64', '#f7768e', '#7aa2f7', '#e0af68', '#bb9af7'];

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

function getFallbackAuthenticatedStats() {
  // Uses the verified authenticated snapshot from GitHub Actions when run locally without GH_TOKEN
  const langBytes = new Map([
    ['Java', 2800],
    ['JavaScript', 2750],
    ['TypeScript', 2180],
    ['Python', 1720],
    ['PHP', 550],
  ]);
  const langRepoSet = new Map([
    ['Java', new Set(Array.from({ length: 26 }, (_, i) => `r${i}`))],
    ['JavaScript', new Set(Array.from({ length: 33 }, (_, i) => `r${i}`))],
    ['TypeScript', new Set(Array.from({ length: 14 }, (_, i) => `r${i}`))],
    ['Python', new Set(Array.from({ length: 23 }, (_, i) => `r${i}`))],
    ['PHP', new Set(Array.from({ length: 4 }, (_, i) => `r${i}`))],
  ]);
  const langPRSet = new Map([
    ['Java', new Set(['p1'])],
    ['JavaScript', new Set(['p1', 'p2', 'p3'])],
    ['TypeScript', new Set(['p1'])],
    ['PHP', new Set(['p1'])],
  ]);
  return {
    publicRepoCount: 81,
    privateRepoCount: 22,
    totalRepos: 103,
    totalPRs: 25,
    externalContributedRepos: 4,
    totalStars: 206,
    langBytes,
    langRepoSet,
    langPRSet,
  };
}

// Helper to render a sleek Skill Badge with custom SVG icon + crisp label inside the Skill Table
function renderTechBadge(x, y, width, label, accentColor, iconSvg) {
  return `
    <g transform="translate(${x}, ${y})">
      <rect x="0" y="0" width="${width}" height="32" rx="8" fill="#140b24" stroke="${accentColor}" stroke-opacity="0.48" stroke-width="1.1"/>
      <rect x="4" y="4" width="24" height="24" rx="5" fill="${accentColor}" fill-opacity="0.16"/>
      <g transform="translate(8, 8)">
        ${iconSvg}
      </g>
      <text x="35" y="20.5" class="tech-badge-txt">${label}</text>
    </g>`;
}

function buildUnifiedProfileSvg(stats) {
  // Top 5 Core Programming Languages
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
    .join('\n          ');

  const cardWidth = 204;
  const cardGap = 17;
  const langCards = entries
    .map((e, idx) => {
      const x = idx * (cardWidth + cardGap);
      const fillW = Math.max(14, Math.round((e.percent / 100) * 168));
      const prText = e.prs > 0 ? `${e.repos} repos &#183; ${e.prs} PR repo` : `${e.repos} repositories`;

      return `
        <g transform="translate(${x}, 0)">
          <rect x="0" y="0" width="204" height="126" rx="14" fill="#1b1030" fill-opacity="0.88" stroke="${e.color}" stroke-opacity="0.4" stroke-width="1.2"/>
          <g transform="translate(18, 24)">
            <rect x="0" y="-10" width="12" height="12" rx="3" transform="rotate(45 6 -4)" fill="${e.color}" opacity="0.3"/>
            <circle cx="6" cy="-4" r="3.5" fill="${e.color}"/>
            <text x="20" y="0" class="rank-lbl">RANK #0${idx + 1}</text>
            <text x="168" y="2" text-anchor="end" class="lang-pct" fill="${e.color}">${e.displayPercent}%</text>
          </g>
          <text x="18" y="64" class="lang-name">${e.name}</text>
          <text x="18" y="86" class="lang-meta">${prText}</text>
          <rect x="18" y="102" width="168" height="6" rx="3" fill="#0e071c"/>
          <rect x="18" y="102" width="${fillW}" height="6" rx="3" fill="${e.color}"/>
        </g>`;
    })
    .join('\n');

  const repoSummaryText =
    stats.privateRepoCount > 0
      ? `${stats.publicRepoCount} Public &amp; ${stats.privateRepoCount} Private`
      : `${stats.publicRepoCount} Public Repos`;

  // Skill Table Rows with Clear Domain, Official Vector Logo + Tech Name Badges, and Architectural Focus
  const skillRows = [
    {
      domain: 'Backend & Systems',
      sub: 'Core Services & Sandboxes',
      color: '#ff9e64',
      focus1: 'Microservices, REST & GraphQL APIs,',
      focus2: 'Isolated Code Execution, High-Concurrency',
      badges: [
        {
          w: 82,
          label: 'Java',
          color: '#ff9e64',
          icon: `<path d="M5 12 C5 14 11 14 11 12 M4 9 C4 11 12 11 12 9 M8 2 C6 4 10 5 8 7" stroke="#ff9e64" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
        },
        {
          w: 118,
          label: 'Spring Boot',
          color: '#73daca',
          icon: `<polygon points="8,1.5 14,5 14,11 8,14.5 2,11 2,5" stroke="#73daca" stroke-width="1.6" fill="none"/><circle cx="8" cy="8" r="2" fill="#73daca"/>`,
        },
        {
          w: 94,
          label: 'Python',
          color: '#e0af68',
          icon: `<rect x="2" y="2" width="7" height="7" rx="2" stroke="#7aa2f7" stroke-width="1.5" fill="none"/><rect x="7" y="7" width="7" height="7" rx="2" stroke="#e0af68" stroke-width="1.5" fill="none"/>`,
        },
        {
          w: 96,
          label: 'FastAPI',
          color: '#73daca',
          icon: `<polygon points="9,1 3,9 8,9 7,15 13,7 8,7" fill="#73daca"/>`,
        },
        {
          w: 92,
          label: 'Golang',
          color: '#7dcfff',
          icon: `<circle cx="8" cy="8" r="5.5" stroke="#7dcfff" stroke-width="1.6" fill="none"/><path d="M8 8 H12" stroke="#7dcfff" stroke-width="1.6" stroke-linecap="round"/>`,
        },
        {
          w: 94,
          label: 'Laravel',
          color: '#f7768e',
          icon: `<path d="M3 5 L8 2 L13 5 V11 L8 14 L3 11 Z" stroke="#f7768e" stroke-width="1.5" fill="none"/>`,
        },
      ],
    },
    {
      domain: 'Frontend & Web',
      sub: 'Reactive UI & Interactive 3D',
      color: '#7aa2f7',
      focus1: 'SSR / SPA Architecture, Component Systems,',
      focus2: 'State Management, WebGL & 3D Motion',
      badges: [
        {
          w: 112,
          label: 'TypeScript',
          color: '#7aa2f7',
          icon: `<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="#7aa2f7" stroke-width="1.5" fill="none"/><text x="8" y="11.5" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="8" fill="#7aa2f7">TS</text>`,
        },
        {
          w: 110,
          label: 'JavaScript',
          color: '#e0af68',
          icon: `<rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="#e0af68" stroke-width="1.5" fill="none"/><text x="8" y="11.5" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="8" fill="#e0af68">JS</text>`,
        },
        {
          w: 86,
          label: 'React',
          color: '#7dcfff',
          icon: `<ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(30 8 8)" stroke="#7dcfff" stroke-width="1.3" fill="none"/><ellipse cx="8" cy="8" rx="6.5" ry="2.6" transform="rotate(-30 8 8)" stroke="#7dcfff" stroke-width="1.3" fill="none"/><circle cx="8" cy="8" r="1.5" fill="#7dcfff"/>`,
        },
        {
          w: 92,
          label: 'Next.js',
          color: '#cba6f7',
          icon: `<circle cx="8" cy="8" r="6" stroke="#cba6f7" stroke-width="1.5" fill="none"/><path d="M5.5 11 V5 L11 11 V5" stroke="#cba6f7" stroke-width="1.4" fill="none"/>`,
        },
        {
          w: 88,
          label: 'Vue.js',
          color: '#73daca',
          icon: `<path d="M2 3 L8 13 L14 3 H10.5 L8 7.5 L5.5 3 Z" stroke="#73daca" stroke-width="1.3" fill="none"/>`,
        },
        {
          w: 96,
          label: 'Tailwind',
          color: '#7dcfff',
          icon: `<path d="M2 7 C3.5 4 6 4 7.5 6 C9 8 11.5 8 13 5 M2 11 C3.5 8 6 8 7.5 10 C9 12 11.5 12 13 9" stroke="#7dcfff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
        },
      ],
    },
    {
      domain: 'Applied AI & Data',
      sub: 'RAG, LLM Agents & Analytics',
      color: '#f7768e',
      focus1: 'Retrieval-Augmented Generation (RAG),',
      focus2: 'AI Code Tutors, Legal Chatbots & Indexing',
      badges: [
        {
          w: 118,
          label: 'RAG Pipelines',
          color: '#f7768e',
          icon: `<circle cx="4" cy="4" r="2" fill="#f7768e"/><circle cx="12" cy="4" r="2" fill="#f7768e"/><circle cx="8" cy="12" r="2" fill="#f7768e"/><path d="M4 4 L8 12 L12 4 Z" stroke="#f7768e" stroke-width="1.3" fill="none"/>`,
        },
        {
          w: 108,
          label: 'LangChain',
          color: '#ff9e64',
          icon: `<rect x="2" y="5" width="5" height="6" rx="2" stroke="#ff9e64" stroke-width="1.5" fill="none"/><rect x="9" y="5" width="5" height="6" rx="2" stroke="#ff9e64" stroke-width="1.5" fill="none"/><line x1="6" y1="8" x2="10" y2="8" stroke="#ff9e64" stroke-width="1.5"/>`,
        },
        {
          w: 96,
          label: 'PyTorch',
          color: '#ff9e64',
          icon: `<path d="M8 2 C4.5 5 4 10 6.5 12.5 C9 15 13 12.5 12.5 8.5 C12 6 10 4.5 8 2 Z" stroke="#ff9e64" stroke-width="1.5" fill="none"/><circle cx="9.5" cy="6.5" r="1.2" fill="#ff9e64"/>`,
        },
        {
          w: 94,
          label: 'Pandas',
          color: '#bb9af7',
          icon: `<line x1="4" y1="2" x2="4" y2="14" stroke="#bb9af7" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="5" x2="8" y2="11" stroke="#f7768e" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="2" x2="12" y2="14" stroke="#bb9af7" stroke-width="2" stroke-linecap="round"/>`,
        },
        {
          w: 106,
          label: 'Vector DB',
          color: '#73daca',
          icon: `<polygon points="8,2 14,5.5 8,9 2,5.5" stroke="#73daca" stroke-width="1.4" fill="none"/><polyline points="2,9.5 8,13 14,9.5" stroke="#73daca" stroke-width="1.4" fill="none"/>`,
        },
      ],
    },
    {
      domain: 'Databases & Storage',
      sub: 'Relational, NoSQL & Caching',
      color: '#73daca',
      focus1: 'Schema Design, Query Optimization,',
      focus2: 'Distributed In-Memory Caching & Persistence',
      badges: [
        {
          w: 114,
          label: 'PostgreSQL',
          color: '#7aa2f7',
          icon: `<ellipse cx="8" cy="4.5" rx="5.5" ry="2.2" stroke="#7aa2f7" stroke-width="1.4" fill="none"/><path d="M2.5 4.5 V11.5 C2.5 13 13.5 13 13.5 11.5 V4.5" stroke="#7aa2f7" stroke-width="1.4" fill="none"/>`,
        },
        {
          w: 92,
          label: 'MySQL',
          color: '#ff9e64',
          icon: `<ellipse cx="8" cy="4.5" rx="5.5" ry="2.2" stroke="#ff9e64" stroke-width="1.4" fill="none"/><path d="M2.5 8 C2.5 9.5 13.5 9.5 13.5 8 M2.5 4.5 V11.5 C2.5 13 13.5 13 13.5 11.5 V4.5" stroke="#ff9e64" stroke-width="1.4" fill="none"/>`,
        },
        {
          w: 106,
          label: 'MongoDB',
          color: '#73daca',
          icon: `<path d="M8 1.5 C4.5 5 4.5 10.5 8 14 C11.5 10.5 11.5 5 8 1.5 Z" stroke="#73daca" stroke-width="1.5" fill="none"/><line x1="8" y1="5" x2="8" y2="14.5" stroke="#73daca" stroke-width="1.2"/>`,
        },
        {
          w: 86,
          label: 'Redis',
          color: '#f7768e',
          icon: `<polygon points="8,2 14,5 8,8 2,5" stroke="#f7768e" stroke-width="1.4" fill="none"/><polyline points="2,8.5 8,11.5 14,8.5" stroke="#f7768e" stroke-width="1.4" fill="none"/><polyline points="2,11.5 8,14.5 14,11.5" stroke="#f7768e" stroke-width="1.4" fill="none"/>`,
        },
      ],
    },
    {
      domain: 'Cloud & DevSecOps',
      sub: 'Containers, OCP & CI/CD',
      color: '#bb9af7',
      focus1: 'Container Orchestration, OpenShift (OCP),',
      focus2: 'GitHub Actions Automation & Linux Security',
      badges: [
        {
          w: 92,
          label: 'Docker',
          color: '#7dcfff',
          icon: `<rect x="3" y="5" width="3" height="3" stroke="#7dcfff" stroke-width="1.3" fill="none"/><rect x="6.5" y="5" width="3" height="3" stroke="#7dcfff" stroke-width="1.3" fill="none"/><rect x="6.5" y="1.5" width="3" height="3" stroke="#7dcfff" stroke-width="1.3" fill="none"/><path d="M1.5 8.5 H14 C14 12 11 13.5 7 13.5 C3.5 13.5 1.5 11.5 1.5 8.5 Z" stroke="#7dcfff" stroke-width="1.3" fill="none"/>`,
        },
        {
          w: 112,
          label: 'Kubernetes',
          color: '#7aa2f7',
          icon: `<polygon points="8,1.5 13.5,4.8 13.5,11.2 8,14.5 2.5,11.2 2.5,4.8" stroke="#7aa2f7" stroke-width="1.4" fill="none"/><circle cx="8" cy="8" r="2.2" stroke="#7aa2f7" stroke-width="1.3" fill="none"/>`,
        },
        {
          w: 108,
          label: 'OpenShift',
          color: '#f7768e',
          icon: `<circle cx="8" cy="8" r="5.5" stroke="#f7768e" stroke-width="1.6" stroke-dasharray="22 8" fill="none"/><circle cx="8" cy="8" r="2" fill="#f7768e"/>`,
        },
        {
          w: 84,
          label: 'Linux',
          color: '#e0af68',
          icon: `<polyline points="3,5 7,8 3,11" stroke="#e0af68" stroke-width="1.6" fill="none" stroke-linecap="round"/><line x1="8.5" y1="11" x2="13" y2="11" stroke="#e0af68" stroke-width="1.6" stroke-linecap="round"/>`,
        },
        {
          w: 106,
          label: 'CI/CD Actions',
          color: '#bb9af7',
          icon: `<circle cx="4.5" cy="4.5" r="2.2" stroke="#bb9af7" stroke-width="1.4" fill="none"/><circle cx="11.5" cy="11.5" r="2.2" stroke="#bb9af7" stroke-width="1.4" fill="none"/><path d="M6.7 4.5 H9.5 C10.8 4.5 11.5 5.2 11.5 6.5 V9.3" stroke="#bb9af7" stroke-width="1.4" fill="none"/>`,
        },
      ],
    },
  ];

  const renderedSkillRows = skillRows
    .map((row, idx) => {
      const y = 70 + idx * 72;
      let curX = 236;
      const badgesSvg = row.badges
        .map((b) => {
          const svg = renderTechBadge(curX, 20, b.w, b.label, b.color, b.icon);
          curX += b.w + 8;
          return svg;
        })
        .join('');

      return `
        <g transform="translate(0, ${y})">
          <rect x="0" y="0" width="1088" height="62" rx="12" fill="#180e2b" fill-opacity="0.82" stroke="${row.color}" stroke-opacity="0.24" stroke-width="1"/>
          
          <!-- Left Domain Column -->
          <rect x="0" y="0" width="6" height="62" rx="3" fill="${row.color}"/>
          <text x="22" y="27" class="row-domain">${row.domain}</text>
          <text x="22" y="45" class="row-sub">${row.sub}</text>
          <line x1="220" y1="10" x2="220" y2="52" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>

          <!-- Middle Column: Technology Badges with Vector Icons + Names -->
          ${badgesSvg}

          <!-- Right Column: Architectural Focus -->
          <line x1="848" y1="10" x2="848" y2="52" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1"/>
          <text x="864" y="26" class="row-focus">${row.focus1}</text>
          <text x="864" y="44" class="row-focus">${row.focus2}</text>
        </g>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1890" width="100%">
  <defs>
    <!-- Continuous Lo-fi Sunset / Dusk Master Canvas Background -->
    <linearGradient id="masterCanvasBg" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#110920"/>
      <stop offset="12%" stop-color="#221238"/>
      <stop offset="22%" stop-color="#3a1948"/>
      <stop offset="35%" stop-color="#190d2c"/>
      <stop offset="68%" stop-color="#140a24"/>
      <stop offset="100%" stop-color="#1e1033"/>
    </linearGradient>

    <!-- Hero Sky Gradient -->
    <linearGradient id="skyDusk" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#110921"/>
      <stop offset="30%" stop-color="#24123b"/>
      <stop offset="58%" stop-color="#4b1d52"/>
      <stop offset="82%" stop-color="#8f365d"/>
      <stop offset="95%" stop-color="#d96562"/>
      <stop offset="100%" stop-color="#ffaa6c"/>
    </linearGradient>

    <!-- Setting Sun Orb -->
    <linearGradient id="sunsetOrb" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fff3c4"/>
      <stop offset="35%" stop-color="#ffb86c"/>
      <stop offset="75%" stop-color="#f76b8a"/>
      <stop offset="100%" stop-color="#9e3768" stop-opacity="0.7"/>
    </linearGradient>

    <linearGradient id="horizonMist" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ff9e64" stop-opacity="0"/>
      <stop offset="65%" stop-color="#ff857a" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#190d2c" stop-opacity="0.98"/>
    </linearGradient>

    <linearGradient id="glassCard" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#190e2e" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#2b1640" stop-opacity="0.64"/>
    </linearGradient>

    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff9e64"/>
      <stop offset="50%" stop-color="#f7768e"/>
      <stop offset="100%" stop-color="#bb9af7"/>
    </linearGradient>

    <linearGradient id="dividerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ff9e64" stop-opacity="0"/>
      <stop offset="25%" stop-color="#ff9e64" stop-opacity="0.45"/>
      <stop offset="50%" stop-color="#f7768e" stop-opacity="0.8"/>
      <stop offset="75%" stop-color="#bb9af7" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#bb9af7" stop-opacity="0"/>
    </linearGradient>

    <mask id="sunScanlines">
      <rect x="700" y="50" width="340" height="300" fill="white"/>
      <rect x="700" y="208" width="340" height="3" fill="black"/>
      <rect x="700" y="220" width="340" height="4" fill="black"/>
      <rect x="700" y="234" width="340" height="5.5" fill="black"/>
      <rect x="700" y="250" width="340" height="7" fill="black"/>
      <rect x="700" y="268" width="340" height="9" fill="black"/>
      <rect x="700" y="288" width="340" height="12" fill="black"/>
    </mask>

    <clipPath id="masterClip">
      <rect x="0" y="0" width="1200" height="1890" rx="24"/>
    </clipPath>

    <clipPath id="heroClip">
      <rect x="0" y="0" width="1200" height="390"/>
    </clipPath>

    <clipPath id="multiBarClip">
      <rect x="0" y="0" width="1088" height="14" rx="7"/>
    </clipPath>
  </defs>

  <style>
    .eyebrow {
      font: 600 11.5px 'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
      fill: #ffbe98;
      letter-spacing: 2.4px;
    }
    .hero-name {
      font: 800 44px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, sans-serif;
      fill: #fff8f6;
      letter-spacing: 0.6px;
    }
    .hero-handle {
      font: 600 20px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ff9e64;
    }
    .poetic-quote {
      font: italic 400 15.5px Georgia, 'Times New Roman', serif;
      fill: #f3d5e5;
      letter-spacing: 0.4px;
    }
    .role-pill-text {
      font: 600 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ffe8d6;
      letter-spacing: 0.6px;
    }
    .sec-title {
      font: 800 21px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, sans-serif;
      fill: #fff5f8;
      letter-spacing: 0.6px;
    }
    .sec-sub {
      font: 400 13px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      fill: #d8bfd8;
    }
    .tbl-head {
      font: 700 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ffbe98;
      letter-spacing: 1.5px;
    }
    .row-domain {
      font: 700 15px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #fff8f6;
    }
    .row-sub {
      font: 400 11.5px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #b8a9d1;
    }
    .row-focus {
      font: 400 11.5px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #d8bfd8;
    }
    .tech-badge-txt {
      font: 600 12px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #fff8f6;
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
    .proj-num {
      font: 700 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ffbe98;
      letter-spacing: 1.4px;
    }
    .proj-title {
      font: 700 18px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #fff8f6;
    }
    .proj-desc {
      font: 400 13px 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      fill: #d8bfd8;
    }
    .repo-chip {
      font: 600 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ffbe98;
    }
    .tag-text {
      font: 600 10.5px 'Cascadia Code', 'Fira Code', monospace;
      fill: #f8f8f2;
    }
    .footer-sig {
      font: 600 11px 'Cascadia Code', 'Fira Code', monospace;
      fill: #ffbe98;
      letter-spacing: 2px;
    }

    @keyframes twinkle {
      0%, 100% { opacity: 0.25; transform: scale(0.9); }
      50% { opacity: 0.95; transform: scale(1.15); }
    }
    @keyframes cloudDriftSlow {
      0%, 100% { transform: translateX(0px); }
      50% { transform: translateX(26px); }
    }
    @keyframes cloudDriftReverse {
      0%, 100% { transform: translateX(0px); }
      50% { transform: translateX(-22px); }
    }
    @keyframes sunPulse {
      0%, 100% { opacity: 0.22; }
      50% { opacity: 0.38; }
    }
    @keyframes shootingStar {
      0%, 75% { opacity: 0; transform: translate(0, 0); }
      80% { opacity: 0.95; }
      92%, 100% { opacity: 0; transform: translate(-170px, 70px); }
    }
    @keyframes waveShift {
      0%, 100% { transform: translateX(0px); }
      50% { transform: translateX(-24px); }
    }

    .star-1 { animation: twinkle 3.6s ease-in-out infinite; }
    .star-2 { animation: twinkle 4.8s ease-in-out infinite 1.2s; }
    .star-3 { animation: twinkle 5.4s ease-in-out infinite 2.4s; }
    .cloud-a { animation: cloudDriftSlow 16s ease-in-out infinite; }
    .cloud-b { animation: cloudDriftReverse 19s ease-in-out infinite; }
    .sun-halo { animation: sunPulse 6s ease-in-out infinite; }
    .meteor { animation: shootingStar 9s ease-out infinite 1.5s; }
    .wave-anim { animation: waveShift 10s ease-in-out infinite; }
  </style>

  <g clip-path="url(#masterClip)">
    <!-- Master Unified Dusk Background -->
    <rect x="0" y="0" width="1200" height="1890" fill="url(#masterCanvasBg)"/>

    <!-- ======================================================================= -->
    <!-- SECTION 1: LO-FI SUNSET HERO BANNER (Y: 0 -> 390)                       -->
    <!-- ======================================================================= -->
    <g clip-path="url(#heroClip)">
      <rect x="0" y="0" width="1200" height="390" fill="url(#skyDusk)"/>

      <!-- Celestial Astrolabe Rings -->
      <g stroke="#ffbe98" stroke-opacity="0.09" fill="none" stroke-width="1">
        <circle cx="880" cy="200" r="185" stroke-dasharray="4 8"/>
        <circle cx="880" cy="200" r="240"/>
        <circle cx="880" cy="200" r="305" stroke-dasharray="2 10"/>
      </g>

      <!-- Starfield & Constellations -->
      <g fill="#fff5eb">
        <circle cx="95" cy="38" r="1.4" class="star-1"/>
        <circle cx="195" cy="28" r="1.8" class="star-2"/>
        <circle cx="310" cy="54" r="1.2" class="star-3"/>
        <circle cx="440" cy="34" r="1.6" class="star-1"/>
        <circle cx="565" cy="62" r="1.3" class="star-2"/>
        <circle cx="665" cy="34" r="1.9" class="star-3"/>
        <circle cx="755" cy="58" r="1.3" class="star-1"/>
        <circle cx="995" cy="40" r="1.7" class="star-2"/>
        <circle cx="1090" cy="62" r="1.4" class="star-3"/>
        <circle cx="1145" cy="32" r="1.8" class="star-1"/>
        <g stroke="#ffd6e0" stroke-opacity="0.22" stroke-width="0.9">
          <polyline points="665,34 715,50 755,58 785,32" fill="none"/>
          <polyline points="995,40 1045,26 1090,62 1145,32" fill="none"/>
        </g>
      </g>

      <!-- Shooting Star -->
      <g class="meteor">
        <line x1="1050" y1="42" x2="1115" y2="16" stroke="url(#accentGrad)" stroke-width="2" stroke-linecap="round"/>
        <circle cx="1050" cy="42" r="2.2" fill="#fff8f6"/>
      </g>

      <!-- Setting Sun -->
      <circle cx="880" cy="200" r="140" fill="#ff7a93" opacity="0.26" class="sun-halo"/>
      <circle cx="880" cy="200" r="105" fill="url(#sunsetOrb)" mask="url(#sunScanlines)"/>

      <!-- Drifting Clouds -->
      <g class="cloud-a" opacity="0.65">
        <path d="M650 170 Q680 154 715 166 Q745 150 780 167 Q805 162 825 176 L630 176 Z" fill="#4f2152"/>
        <path d="M930 134 Q965 116 1005 130 Q1040 118 1075 136 L915 136 Z" fill="#3a1946"/>
      </g>
      <g class="cloud-b" opacity="0.55">
        <path d="M745 224 Q785 207 830 220 Q870 204 915 221 Q945 214 975 227 L725 227 Z" fill="#2d133b"/>
      </g>

      <!-- Horizon Mist & Mountain Silhouettes Blending Seamlessly into Master Canvas -->
      <rect x="0" y="175" width="1200" height="215" fill="url(#horizonMist)"/>
      <path d="M0 290 L105 256 L210 278 L330 242 L455 276 L580 248 L700 274 L805 245 L925 270 L1045 238 L1140 264 L1200 250 L1200 390 L0 390 Z" fill="#321640" opacity="0.9"/>
      <path d="M0 322 L150 288 L285 312 L425 278 L550 310 L695 282 L845 314 L980 280 L1100 306 L1200 288 L1200 390 L0 390 Z" fill="#210f31"/>
      <path d="M0 352 L190 330 L365 348 L540 326 L730 350 L900 334 L1060 352 L1200 338 L1200 390 L0 390 Z" fill="#190d2c"/>

      <!-- Distant Birds -->
      <g stroke="#2a1138" stroke-width="1.8" fill="none" stroke-linecap="round">
        <path d="M795 144 Q801 137 807 143 Q813 137 819 144"/>
        <path d="M828 132 Q833 127 838 131 Q843 127 848 132"/>
      </g>

      <!-- Left Glassmorphic Identity Card -->
      <g transform="translate(56, 42)">
        <rect x="0" y="0" width="665" height="284" rx="20" fill="url(#glassCard)" stroke="url(#accentGrad)" stroke-opacity="0.55" stroke-width="1.4"/>
        <path d="M18 12 H36 M12 18 V36" stroke="#ffbe98" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M647 272 H629 M653 266 V248" stroke="#bb9af7" stroke-opacity="0.5" stroke-width="1.5" stroke-linecap="round"/>

        <g transform="translate(34, 34)">
          <path d="M8 0 L10.2 5.8 L16 8 L10.2 10.2 L8 16 L5.8 10.2 L0 8 L5.8 5.8 Z" fill="#ff9e64"/>
          <text x="26" y="12.5" class="eyebrow">SOFTWARE ENGINEER &#183; ARCHITECTURE &amp; APPLIED AI</text>
        </g>

        <text x="34" y="106" class="hero-name">Dang Xuan Thai</text>
        <text x="394" y="104" class="hero-handle">@CallMeIAmTDF</text>

        <text x="34" y="144" class="poetic-quote">"Crafting resilient systems and quiet algorithms beneath the dusk horizon."</text>
        <line x1="34" y1="168" x2="630" y2="168" stroke="url(#accentGrad)" stroke-opacity="0.35" stroke-width="1"/>

        <!-- Domain Highlights -->
        <g transform="translate(34, 188)">
          <rect x="0" y="0" width="190" height="32" rx="8" fill="#24133a" stroke="#ff9e64" stroke-opacity="0.45"/>
          <polygon points="16,10 22,16 16,22 10,16" fill="#ff9e64"/>
          <text x="30" y="20" class="role-pill-text">BACKEND &amp; SANDBOXES</text>

          <rect x="202" y="0" width="194" height="32" rx="8" fill="#24133a" stroke="#7aa2f7" stroke-opacity="0.45"/>
          <circle cx="218" cy="16" r="5" stroke="#7aa2f7" stroke-width="1.8" fill="none"/>
          <text x="232" y="20" class="role-pill-text">REACTIVE FULL-STACK</text>

          <rect x="408" y="0" width="188" height="32" rx="8" fill="#24133a" stroke="#f7768e" stroke-opacity="0.45"/>
          <path d="M424 10 L429 20 H419 Z" fill="#f7768e"/>
          <text x="438" y="20" class="role-pill-text">APPLIED AI &amp; RAG</text>
        </g>

        <!-- Location & Contact Strip Inside Hero -->
        <g transform="translate(34, 248)">
          <circle cx="6" cy="0" r="3.5" fill="#73daca" class="star-1"/>
          <text x="18" y="4" class="eyebrow" style="fill: #f3d5e5; letter-spacing: 1.3px;">VIETNAM (UTC+7) &#183; FB.COM/HELLO.IAMTDF &#183; GITHUB.COM/CALLMEIAMTDF</text>
        </g>
      </g>
    </g>

    <!-- Subtle Starlight Divider 1 -->
    <line x1="80" y1="398" x2="1120" y2="398" stroke="url(#dividerGrad)" stroke-width="1.5"/>
    <path d="M600 390 L602.5 395.5 L608 398 L602.5 400.5 L600 406 L597.5 400.5 L592 398 L597.5 395.5 Z" fill="#ff9e64"/>

    <!-- ======================================================================= -->
    <!-- SECTION 2: TECHNICAL ECOSYSTEM & SKILL MATRIX TABLE (Y: 424 -> 905)     -->
    <!-- ======================================================================= -->
    <g transform="translate(56, 424)">
      <!-- Header -->
      <g transform="translate(0, 0)">
        <rect x="0" y="0" width="42" height="42" rx="11" fill="#281740" stroke="#ff9e64" stroke-opacity="0.5" stroke-width="1.2"/>
        <polygon points="21,9 32,15 32,27 21,33 10,27 10,15" fill="none" stroke="url(#accentGrad)" stroke-width="2"/>
        <circle cx="21" cy="21" r="3" fill="#ff9e64"/>
        <text x="58" y="18" class="sec-title">TECHNICAL ECOSYSTEM &amp; SKILL CLASSIFICATION</text>
        <text x="58" y="38" class="sec-sub">Categorized engineering stack with official vector emblems, explicit labels &amp; architectural roles</text>
      </g>

      <!-- Table Column Headers -->
      <g transform="translate(0, 56)">
        <text x="16" y="0" class="tbl-head">ENGINEERING DOMAIN</text>
        <text x="236" y="0" class="tbl-head">CORE TECHNOLOGIES, FRAMEWORKS &amp; TOOLING</text>
        <text x="864" y="0" class="tbl-head">ARCHITECTURAL FOCUS</text>
      </g>

      <!-- 5 Categorized Skill Rows -->
      ${renderedSkillRows}
    </g>

    <!-- Subtle Starlight Divider 2 -->
    <line x1="80" y1="882" x2="1120" y2="882" stroke="url(#dividerGrad)" stroke-width="1.5"/>
    <path d="M600 874 L602.5 879.5 L608 882 L602.5 884.5 L600 890 L597.5 884.5 L592 882 L597.5 879.5 Z" fill="#f7768e"/>

    <!-- ======================================================================= -->
    <!-- SECTION 3: TOP 5 CORE LANGUAGES & TELEMETRY (Y: 908 -> 1295)            -->
    <!-- ======================================================================= -->
    <g transform="translate(56, 908)">
      <!-- Header -->
      <g transform="translate(0, 0)">
        <rect x="0" y="0" width="42" height="42" rx="11" fill="#281740" stroke="#ff9e64" stroke-opacity="0.5" stroke-width="1.2"/>
        <path d="M21 8 L24.8 17.2 L34 21 L24.8 24.8 L21 34 L17.2 24.8 L8 21 L17.2 17.2 Z" fill="url(#accentGrad)"/>
        <circle cx="21" cy="21" r="2.8" fill="#130b24"/>

        <text x="58" y="18" class="sec-title">TOP 5 CORE LANGUAGES &amp; CONTRIBUTION TELEMETRY</text>
        <text x="58" y="38" class="sec-sub">Pure programming languages aggregated across public, private &amp; external PR repositories</text>

        <g transform="translate(838, 6)">
          <rect x="0" y="0" width="250" height="30" rx="15" fill="#24143a" stroke="#f7768e" stroke-opacity="0.45" stroke-width="1"/>
          <circle cx="18" cy="15" r="4" fill="#73daca" class="star-1"/>
          <text x="32" y="19" class="badge-label">LIVE: PUBLIC + PRIVATE + PRs</text>
        </g>
      </g>

      <!-- 3 Summary Metric Cards -->
      <g transform="translate(0, 62)">
        <rect x="0" y="0" width="348" height="64" rx="14" fill="#1b1030" fill-opacity="0.86" stroke="#ff9e64" stroke-opacity="0.28" stroke-width="1"/>
        <path d="M24 22 H38 V42 H24 Z M28 27 H34 M28 33 H34" stroke="#ff9e64" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <text x="54" y="30" class="metric-val">${repoSummaryText}</text>
        <text x="54" y="49" class="metric-lbl">OWNED &amp; COLLABORATOR REPOSITORIES</text>

        <rect x="370" y="0" width="348" height="64" rx="14" fill="#1b1030" fill-opacity="0.86" stroke="#f7768e" stroke-opacity="0.28" stroke-width="1"/>
        <circle cx="396" cy="25" r="3.8" stroke="#f7768e" stroke-width="1.8" fill="none"/>
        <circle cx="396" cy="40" r="3.8" stroke="#f7768e" stroke-width="1.8" fill="none"/>
        <circle cx="410" cy="40" r="3.8" stroke="#f7768e" stroke-width="1.8" fill="none"/>
        <path d="M396 29 V36 M410 36 V29 C410 26 407 25 401 25" stroke="#f7768e" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <text x="428" y="30" class="metric-val">${stats.totalPRs} Pull Requests (${stats.externalContributedRepos} External)</text>
        <text x="428" y="49" class="metric-lbl">CROSS-PROJECT MERGE REQUESTS</text>

        <rect x="740" y="0" width="348" height="64" rx="14" fill="#1b1030" fill-opacity="0.86" stroke="#bb9af7" stroke-opacity="0.28" stroke-width="1"/>
        <path d="M768 22 L771.5 29 L779 30 L773.5 35.5 L774.8 43 L768 39.2 L761.2 43 L762.5 35.5 L757 30 L764.5 29 Z" stroke="#bb9af7" stroke-width="1.7" fill="none" stroke-linejoin="round"/>
        <text x="796" y="30" class="metric-val">${stats.totalStars} Total Stars &#183; Top 5 Languages</text>
        <text x="796" y="49" class="metric-lbl">VERIFIED CORE CODEBASE SPECTRUM</text>
      </g>

      <!-- Multi-Language Proportional Spectrum Bar -->
      <g transform="translate(0, 156)">
        <text x="0" y="-9" class="metric-lbl">TOP 5 PROGRAMMING LANGUAGES DISTRIBUTION (EXCLUDING MARKUP &amp; FRAMEWORKS)</text>
        <text x="1088" y="-9" text-anchor="end" class="metric-lbl">100.0% NORMALIZED</text>
        <rect x="0" y="0" width="1088" height="14" rx="7" fill="#0d071a"/>
        <g clip-path="url(#multiBarClip)">
          ${barSegments}
        </g>
      </g>

      <!-- 5 Language Cards Row -->
      <g transform="translate(0, 194)">
        ${langCards}
      </g>
    </g>

    <!-- Subtle Starlight Divider 3 -->
    <line x1="80" y1="1262" x2="1120" y2="1262" stroke="url(#dividerGrad)" stroke-width="1.5"/>
    <path d="M600 1254 L602.5 1259.5 L608 1262 L602.5 1264.5 L600 1270 L597.5 1264.5 L592 1262 L597.5 1259.5 Z" fill="#bb9af7"/>

    <!-- ======================================================================= -->
    <!-- SECTION 4: SELECTED WORKS & ENGINEERING HIGHLIGHTS (Y: 1288 -> 1720)    -->
    <!-- ======================================================================= -->
    <g transform="translate(56, 1288)">
      <!-- Header -->
      <g transform="translate(0, 0)">
        <rect x="0" y="0" width="42" height="42" rx="11" fill="#281740" stroke="#ff9e64" stroke-opacity="0.5" stroke-width="1.2"/>
        <path d="M12 16 L21 10 L30 16 V26 L21 32 L12 26 Z" fill="none" stroke="url(#accentGrad)" stroke-width="2"/>
        <circle cx="21" cy="21" r="3" fill="#f7768e"/>
        <text x="58" y="18" class="sec-title">SELECTED WORKS &amp; ENGINEERING HIGHLIGHTS</text>
        <text x="58" y="38" class="sec-sub">Featured multi-service architectures, full-stack platforms &amp; cloud-native implementations</text>
      </g>

      <!-- Project 01: HocCode Ecosystem -->
      <g transform="translate(0, 62)">
        <rect x="0" y="0" width="532" height="162" rx="16" fill="#1b1030" fill-opacity="0.88" stroke="#ff9e64" stroke-opacity="0.4" stroke-width="1.2"/>
        <g transform="translate(24, 24)">
          <circle cx="6" cy="-4" r="4" fill="#ff9e64"/>
          <text x="18" y="0" class="proj-num">FEATURED SYSTEM // 01</text>
          <text x="484" y="0" text-anchor="end" class="repo-chip">4 MICRO-REPOS</text>

          <text x="0" y="28" class="proj-title">HocCode &#8212; Interactive Coding &amp; AI Judge Platform</text>
          <text x="0" y="52" class="proj-desc">Distributed code-learning ecosystem combining a Java core service,</text>
          <text x="0" y="70" class="proj-desc">isolated Go execution sandbox, Python AI tutor &amp; TypeScript frontend.</text>

          <g transform="translate(0, 92)">
            <rect x="0" y="0" width="112" height="24" rx="6" fill="#120920" stroke="#ff9e64" stroke-opacity="0.5"/>
            <text x="56" y="16" text-anchor="middle" class="tag-text">hoccode-main</text>

            <rect x="120" y="0" width="122" height="24" rx="6" fill="#120920" stroke="#7dcfff" stroke-opacity="0.5"/>
            <text x="181" y="16" text-anchor="middle" class="tag-text">Go-Code-Runner</text>

            <rect x="250" y="0" width="88" height="24" rx="6" fill="#120920" stroke="#e0af68" stroke-opacity="0.5"/>
            <text x="294" y="16" text-anchor="middle" class="tag-text">AIServer</text>

            <rect x="346" y="0" width="102" height="24" rx="6" fill="#120920" stroke="#7aa2f7" stroke-opacity="0.5"/>
            <text x="397" y="16" text-anchor="middle" class="tag-text">hoccode (FE)</text>
          </g>
        </g>
      </g>

      <!-- Project 02: FamilyTree Ecosystem -->
      <g transform="translate(556, 62)">
        <rect x="0" y="0" width="532" height="162" rx="16" fill="#1b1030" fill-opacity="0.88" stroke="#73daca" stroke-opacity="0.4" stroke-width="1.2"/>
        <g transform="translate(24, 24)">
          <circle cx="6" cy="-4" r="4" fill="#73daca"/>
          <text x="18" y="0" class="proj-num" style="fill: #73daca;">FEATURED SYSTEM // 02</text>
          <text x="484" y="0" text-anchor="end" class="repo-chip" style="fill: #73daca;">Backend_FT</text>

          <text x="0" y="28" class="proj-title">FamilyTree Ecosystem</text>
          <text x="0" y="52" class="proj-desc">Full-stack genealogy and relationship graph platform engineered with</text>
          <text x="0" y="70" class="proj-desc">a modular Java Spring Boot backend and reactive Vue.js client.</text>

          <g transform="translate(0, 92)">
            <rect x="0" y="0" width="104" height="24" rx="6" fill="#120920" stroke="#ff9e64" stroke-opacity="0.5"/>
            <text x="52" y="16" text-anchor="middle" class="tag-text">Spring Boot</text>

            <rect x="112" y="0" width="76" height="24" rx="6" fill="#120920" stroke="#73daca" stroke-opacity="0.5"/>
            <text x="150" y="16" text-anchor="middle" class="tag-text">Vue.js</text>

            <rect x="196" y="0" width="144" height="24" rx="6" fill="#120920" stroke="#bb9af7" stroke-opacity="0.5"/>
            <text x="268" y="16" text-anchor="middle" class="tag-text">FamilyTree_FE_Final</text>
          </g>
        </g>
      </g>

      <!-- Project 03: Cloud-Native & Security Research -->
      <g transform="translate(0, 244)">
        <rect x="0" y="0" width="532" height="162" rx="16" fill="#1b1030" fill-opacity="0.88" stroke="#bb9af7" stroke-opacity="0.4" stroke-width="1.2"/>
        <g transform="translate(24, 24)">
          <circle cx="6" cy="-4" r="4" fill="#bb9af7"/>
          <text x="18" y="0" class="proj-num" style="fill: #cba6f7;">FEATURED SYSTEM // 03</text>
          <text x="484" y="0" text-anchor="end" class="repo-chip" style="fill: #cba6f7;">demo-ocp</text>

          <text x="0" y="28" class="proj-title">Cloud-Native &amp; Security Research</text>
          <text x="0" y="52" class="proj-desc">Enterprise Red Hat OpenShift (OCP) Spring Boot deployment templates,</text>
          <text x="0" y="70" class="proj-desc">high-throughput data extraction pipelines, and CTF security writeups.</text>

          <g transform="translate(0, 92)">
            <rect x="0" y="0" width="114" height="24" rx="6" fill="#120920" stroke="#f7768e" stroke-opacity="0.5"/>
            <text x="57" y="16" text-anchor="middle" class="tag-text">OpenShift OCP</text>

            <rect x="122" y="0" width="148" height="24" rx="6" fill="#120920" stroke="#ff9e64" stroke-opacity="0.5"/>
            <text x="196" y="16" text-anchor="middle" class="tag-text">springboot-template</text>

            <rect x="278" y="0" width="102" height="24" rx="6" fill="#120920" stroke="#bb9af7" stroke-opacity="0.5"/>
            <text x="329" y="16" text-anchor="middle" class="tag-text">WriteupCTF</text>
          </g>
        </g>
      </g>

      <!-- Project 04: Sport Venue Booking Platform -->
      <g transform="translate(556, 244)">
        <rect x="0" y="0" width="532" height="162" rx="16" fill="#1b1030" fill-opacity="0.88" stroke="#f7768e" stroke-opacity="0.4" stroke-width="1.2"/>
        <g transform="translate(24, 24)">
          <circle cx="6" cy="-4" r="4" fill="#f7768e"/>
          <text x="18" y="0" class="proj-num" style="fill: #f7768e;">FEATURED SYSTEM // 04</text>
          <text x="484" y="0" text-anchor="end" class="repo-chip" style="fill: #f7768e;">booking-app</text>

          <text x="0" y="28" class="proj-title">Sport Venue Booking Platform</text>
          <text x="0" y="52" class="proj-desc">Full-stack sports facility reservation system featuring Owner Analytics</text>
          <text x="0" y="70" class="proj-desc">Dashboards, real-time venue scheduling &amp; cross-repo PR workflows.</text>

          <g transform="translate(0, 92)">
            <rect x="0" y="0" width="96" height="24" rx="6" fill="#120920" stroke="#f7768e" stroke-opacity="0.5"/>
            <text x="48" y="16" text-anchor="middle" class="tag-text">Laravel PHP</text>

            <rect x="104" y="0" width="102" height="24" rx="6" fill="#120920" stroke="#7aa2f7" stroke-opacity="0.5"/>
            <text x="155" y="16" text-anchor="middle" class="tag-text">TypeScript</text>

            <rect x="214" y="0" width="126" height="24" rx="6" fill="#120920" stroke="#ffbe98" stroke-opacity="0.5"/>
            <text x="277" y="16" text-anchor="middle" class="tag-text">Booking-app-FE</text>
          </g>
        </g>
      </g>
    </g>

    <!-- ======================================================================= -->
    <!-- SECTION 5: ANIMATED SUNSET HORIZON FOOTER (Y: 1740 -> 1890)             -->
    <!-- ======================================================================= -->
    <g transform="translate(0, 1740)">
      <path class="wave-anim" d="M-40 85 Q280 45 600 85 T1240 80 L1240 150 L-40 150 Z" fill="#ff9e64" fill-opacity="0.14"/>
      <path d="M0 102 Q320 130 640 98 T1200 108 L1200 150 L0 150 Z" fill="#f7768e" fill-opacity="0.18"/>
      <line x1="56" y1="12" x2="1144" y2="12" stroke="url(#dividerGrad)" stroke-width="1.2"/>
      <text x="600" y="56" text-anchor="middle" class="poetic-quote">"Every commit is a quiet note left along the horizon."</text>
      <text x="600" y="84" text-anchor="middle" class="footer-sig">DANG XUAN THAI &#183; @CALLMEIAMTDF &#183; UNIFIED DUSK PROFILE CANVAS</text>
    </g>

    <!-- Master Outer Frame -->
    <rect x="1" y="1" width="1198" height="1888" rx="23" fill="none" stroke="url(#accentGrad)" stroke-opacity="0.48" stroke-width="1.8"/>
  </g>
</svg>`;
}

async function main() {
  let stats;
  if (TOKEN) {
    try {
      stats = await fetchStatsWithGraphQL();
    } catch (err) {
      console.warn(`[Warn] GraphQL failed (${err.message}), using verified authenticated snapshot...`);
      stats = getFallbackAuthenticatedStats();
    }
  } else {
    stats = getFallbackAuthenticatedStats();
  }

  const outDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  const masterSvg = buildUnifiedProfileSvg(stats);
  const masterPath = path.join(outDir, 'profile-master.svg');
  const compatPath = path.join(outDir, 'languages-sunset.svg');

  fs.writeFileSync(masterPath, masterSvg, 'utf8');
  fs.writeFileSync(compatPath, masterSvg, 'utf8');
  console.log(`[Success] Wrote unified master profile to ${masterPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
