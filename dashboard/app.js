// Breakout Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, the breakout ticker, filters, a
// per-protocol detail drawer with the model's own factors and the protocol's
// farm plan, and the already-trading strip. No network: every byte it shows
// is in data.js. Deep links: ?band=BREAKOUT filters, ?slug=<slug> opens a
// protocol's detail, ?q=<text> searches.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var board = document.getElementById('board');
  if (!DATA) {
    if (board) board.textContent = 'No radar data found: data.js did not load.';
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    band: params.get('band') || 'ALL',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    sort: params.get('sort') || 'implied',
    dir: -1,
    watchlistOnly: params.get('watchlist') === '1',
    selected: params.get('slug') || null,
  };
  // Watchlist membership is the snapshot's own list, flagged per row by the model.
  var onWatchlist = {};
  DATA.rows.forEach(function (r) { onWatchlist[r.slug] = !!r.on_watchlist; });

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clampGrowth(g) {
    if (g === null || g === undefined || !isFinite(g)) return null;
    return Math.min(200, Math.max(-60, g));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- header stats -------------------------------------------------------
  var stats = document.getElementById('stats');
  var statDefs = [
    [String(DATA.board_size), 'rows ranked'],
    [String(DATA.watchlist_size), 'watchlist covered'],
    [String(DATA.band_counts.BREAKOUT || 0), 'in breakout'],
    [DATA.as_of, 'snapshot date'],
  ];
  statDefs.forEach(function (s) {
    stats.appendChild(el('div', { class: 'stat' }, el('b', { text: s[0] }), el('span', { text: s[1] })));
  });

  // ---- breakout ticker ----------------------------------------------------
  var ticker = document.getElementById('ticker');
  ticker.appendChild(el('span', { class: 'label', text: 'Hottest breakouts' }));
  DATA.rows
    .filter(function (r) { return r.momentum_band === 'BREAKOUT'; })
    .slice(0, 8)
    .forEach(function (r) {
      ticker.appendChild(el('button', {
        class: 'chip',
        onclick: function () { openDetail(r.slug); },
      }, el('b', { text: '#' + r.rank }), document.createTextNode(' ' + r.name + ' '), el('span', { class: 'pct', text: fmtPct(r.change_7d) })));
    });

  // ---- controls -----------------------------------------------------------
  var controls = document.getElementById('controls');
  var search = el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, 'aria-label': 'Search protocols' });
  search.addEventListener('input', function () { state.q = search.value; syncUrl(); renderTable(); });
  controls.appendChild(search);

  var bands = ['ALL', 'BREAKOUT', 'RISING', 'STEADY', 'COOLING', 'UNKNOWN'];
  bands.forEach(function (b) {
    var label = b === 'ALL' ? 'All bands' : b.charAt(0) + b.slice(1).toLowerCase();
    var btn = el('button', {
      class: 'bandbtn',
      'aria-pressed': state.band === b ? 'true' : 'false',
      text: label + (b !== 'ALL' ? ' (' + (DATA.band_counts[b] || 0) + ')' : ''),
      onclick: function () { state.band = b; syncUrl(); renderControls(); renderTable(); },
    });
    btn.dataset.band = b;
    controls.appendChild(btn);
  });

  var categories = ['all'];
  DATA.rows.forEach(function (r) { if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category); });
  categories.sort();
  var catSel = el('select', { 'aria-label': 'Filter by category' });
  categories.forEach(function (c) {
    catSel.appendChild(el('option', { value: c, text: c === 'all' ? 'All categories' : c, selected: state.category === c ? 'selected' : null }));
  });
  catSel.addEventListener('change', function () { state.category = catSel.value; syncUrl(); renderTable(); });
  controls.appendChild(catSel);

  var chainCounts = {};
  DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
  var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 12);
  var chainSel = el('select', { 'aria-label': 'Filter by chain' });
  chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
  chains.forEach(function (c) {
    chainSel.appendChild(el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: state.chain === c ? 'selected' : null }));
  });
  chainSel.addEventListener('change', function () { state.chain = chainSel.value; syncUrl(); renderTable(); });
  controls.appendChild(chainSel);

  var sortSel = el('select', { 'aria-label': 'Sort the board' });
  [['implied', 'Sort: implied value'], ['momentum', 'Sort: 7-day momentum'], ['tvl', 'Sort: TVL'], ['age', 'Sort: age'], ['name', 'Sort: name']].forEach(function (o) {
    sortSel.appendChild(el('option', { value: o[0], text: o[1], selected: state.sort === o[0] ? 'selected' : null }));
  });
  sortSel.addEventListener('change', function () { state.sort = sortSel.value; syncUrl(); renderTable(); });
  controls.appendChild(sortSel);

  var watchBox = el('label', { class: 'check' },
    el('input', { type: 'checkbox', checked: state.watchlistOnly ? 'checked' : null }),
    document.createTextNode(' Watchlist only'));
  watchBox.querySelector('input').addEventListener('change', function (e) {
    state.watchlistOnly = e.target.checked; syncUrl(); renderTable();
  });
  controls.appendChild(watchBox);

  function renderControls() {
    controls.querySelectorAll('.bandbtn').forEach(function (b) {
      b.setAttribute('aria-pressed', state.band === b.dataset.band ? 'true' : 'false');
    });
  }

  function syncUrl() {
    var q = new URLSearchParams();
    if (state.q) q.set('q', state.q);
    if (state.band !== 'ALL') q.set('band', state.band);
    if (state.category !== 'all') q.set('category', state.category);
    if (state.chain !== 'all') q.set('chain', state.chain);
    if (state.sort !== 'implied') q.set('sort', state.sort);
    if (state.watchlistOnly) q.set('watchlist', '1');
    if (state.selected) q.set('slug', state.selected);
    var s = q.toString();
    history.replaceState(null, '', s ? '?' + s : window.location.pathname);
  }

  // ---- board table --------------------------------------------------------
  var thead = document.getElementById('thead');
  var tbody = document.getElementById('tbody');
  var countEl = document.getElementById('count');
  var COLS = [
    ['rank', '#', 'num'],
    ['name', 'Protocol', ''],
    ['band', 'Momentum', ''],
    ['tvl', 'TVL', 'num'],
    ['change', '7d', 'num'],
    ['age', 'Age', 'num hide-sm'],
    ['implied', 'Implied value', 'num'],
  ];
  var sortKey = { implied: 'implied_value_usd', momentum: 'change_7d', tvl: 'tvl_usd', age: 'age_days', name: 'name' };

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.band !== 'ALL' && r.momentum_band !== state.band) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) === -1) return false;
      if (state.watchlistOnly && !onWatchlist[r.slug]) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = sortKey[state.sort] || 'implied_value_usd';
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      // dir -1 means best first: highest number, A first for names.
      if (typeof av === 'string') return -state.dir * av.localeCompare(bv);
      return state.dir * (av - bv);
    });
    return rows;
  }

  function gaugeWidth(row) {
    var g = clampGrowth(row.change_7d);
    if (g === null) return 8;
    return Math.round(((g + 60) / 260) * 100);
  }

  function renderTable() {
    thead.innerHTML = '';
    var hr = el('tr');
    COLS.forEach(function (c) {
      var th = el('th', { class: c[2] || null, text: c[1] + (state.sort === c[0] ? (state.dir === -1 ? ' ▼' : ' ▲') : '') });
      th.addEventListener('click', function () {
        if (state.sort === c[0]) state.dir = -state.dir;
        else { state.sort = c[0]; state.dir = -1; }
        syncUrl(); renderTable();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr);

    var rows = filteredRows();
    tbody.innerHTML = '';
    if (rows.length === 0) {
      tbody.appendChild(el('tr', {}, el('td', { colspan: '7', class: 'empty', text: 'No protocol matches these filters. Loosen the band or clear the search.' })));
    }
    rows.forEach(function (r) {
      var g = clampGrowth(r.change_7d);
      var pctCls = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
      var tr = el('tr', { class: state.selected === r.slug ? 'sel' : null, onclick: function () { openDetail(r.slug); } },
        el('td', { class: 'num' }, el('span', { class: 'rank', text: '#' + r.rank })),
        el('td', {}, el('span', { class: 'name', text: r.name }), el('div', { class: 'meta', text: (r.category || 'Uncategorised') + ' · ' + (r.chains || []).slice(0, 3).join(', ') })),
        el('td', {}, el('span', { class: 'band ' + r.momentum_band, text: r.momentum_band }), el('span', { class: 'gauge' }, el('i', { class: r.momentum_band, style: 'width:' + gaugeWidth(r) + '%' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + pctCls, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num hide-sm', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
      );
      tbody.appendChild(tr);
    });
    countEl.textContent = 'Showing ' + rows.length + ' of ' + DATA.board_size + ' ranked rows · ' + DATA.watchlist_size + ' watchlist protocols covered · implied values are this radar\u2019s own claim, never a promise.';
    board.setAttribute('aria-busy', 'false');
  }

  // ---- detail drawer ------------------------------------------------------
  var detail = document.getElementById('detail');
  function kv(k, v) {
    return el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: v }));
  }
  function factor(label, rightText, widthPct) {
    return el('div', { class: 'factor' },
      el('div', { class: 'flabel' }, el('span', { text: label }), el('b', { text: rightText })),
      el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(4, Math.min(100, widthPct)) + '%' })));
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    syncUrl();
    detail.hidden = false;
    detail.innerHTML = '';
    detail.appendChild(el('button', { class: 'close', 'aria-label': 'Close detail', text: '×', onclick: closeDetail }));
    detail.appendChild(el('h2', { text: '#' + row.rank + ' ' + row.name }));
    detail.appendChild(el('p', { class: 'meta', text: (row.category || 'Uncategorised') + ' · ' + (row.chains || []).join(', ') + ' · ' + (onWatchlist[row.slug] ? 'on the watchlist' : 'early find below the floor') }));
    detail.appendChild(el('p', {}, el('span', { class: 'band ' + row.momentum_band, text: row.momentum_band }), document.createTextNode('  ' + fmtPct(row.change_7d) + ' over 7 days')));
    detail.appendChild(kv('Implied value', fmtUsd(row.implied_value_usd)));
    detail.appendChild(kv('TVL', fmtUsd(row.tvl_usd)));
    detail.appendChild(kv('7-day TVL change', fmtPct(row.change_7d)));
    detail.appendChild(kv('Age since first tracked', fmtAge(row.age_days)));
    detail.appendChild(kv('Token recorded', 'No — none recorded'));
    detail.appendChild(el('h3', { text: 'Why this value — the four factors' }));
    var factors = el('div', { class: 'factors' });
    var g = clampGrowth(row.change_7d);
    factors.appendChild(factor('Momentum (7d change ' + fmtPct(row.change_7d) + ')', '×' + row.momentum_multiplier.toFixed(2) + ' · convex', g === null ? 8 : Math.round(((g + 60) / 260) * 100)));
    var ripeNote = row.age_days === null || row.age_days === undefined ? 'age unknown' : row.age_days < 90 ? 'young, discounted' : row.age_days < 365 ? 'finding its feet' : row.age_days <= 1095 ? 'prime 1–3y' : 'late window';
    factors.appendChild(factor('Ripeness (age ' + fmtAge(row.age_days) + ')', '×' + row.ripeness_multiplier.toFixed(2) + ' · ' + ripeNote, Math.round(row.ripeness_multiplier * 100)));
    factors.appendChild(factor('Breadth (' + (row.chains || []).length + ' chains)', '×' + row.breadth_multiplier.toFixed(2) + ' · multi-chain', Math.round(((row.breadth_multiplier - 1) / 0.24) * 100)));
    var sizeW = Math.round((Math.log10(Math.max(row.tvl_usd, 1)) - 6.7) / (10 - 6.7) * 100);
    factors.appendChild(factor('Size (TVL ' + fmtUsd(row.tvl_usd) + ', dampened ^0.65)', 'factor ' + row.size_factor.toLocaleString('en-US'), Math.max(4, Math.min(100, sizeW))));
    detail.appendChild(factors);
    detail.appendChild(el('h3', { text: 'Farm plan — five steps' }));
    var ol = el('ol', { class: 'steps' });
    (row.farm_steps || []).forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    detail.appendChild(ol);
    detail.appendChild(el('p', { class: 'note', text: '“No token recorded” is what the snapshot says — it is not proof the protocol has no token. The implied value is this radar\u2019s own claim from the snapshot\u2019s figures, never a promise of an airdrop.' }));
    renderTable();
    detail.scrollTop = 0;
  }
  function closeDetail() {
    state.selected = null;
    detail.hidden = true;
    detail.innerHTML = '';
    syncUrl();
    renderTable();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

  // ---- already trading ----------------------------------------------------
  var live = document.getElementById('live');
  live.appendChild(el('h2', { text: 'Already trading — not ranked' }));
  live.appendChild(el('p', { class: 'lede', text: 'These protocols already have a token that trades. The board shows the market\u2019s own value for them, never a model\u2019s implied value, and never mixes them into the ranking.' }));
  var grid = el('div', { class: 'livegrid' });
  DATA.live.forEach(function (p) {
    grid.appendChild(el('div', { class: 'livecard' },
      el('b', { text: p.name }),
      el('div', { class: 'meta', text: (p.category || 'Uncategorised') + ' · TVL ' + fmtUsd(p.tvl_usd) + ' · 7d ' + fmtPct(p.change_7d) }),
      el('div', { class: 'mcap', text: 'Mcap ' + fmtUsd(p.mcap_usd) })));
  });
  live.appendChild(grid);

  // ---- model explainer ----------------------------------------------------
  var model = document.getElementById('model');
  model.appendChild(el('h2', { text: 'How the model works — breakout-7' }));
  model.appendChild(el('p', { class: 'lede', text: 'A launch follows attention, and attention shows up first as TVL momentum. The model lets the 7-day change bend the value hard, damps raw size so giants do not win on bulk alone, and seasons the result by age and chain breadth. No protocol name is ever special-cased.' }));
  model.appendChild(el('div', { class: 'formula', text: 'implied = round( TVL^0.65 × 0.35 × (1 + clamp(7d, -60, 200)/100)^2.0 × ripeness(age) × (1 + 0.04 × min(chains, 6)) )' }));
  var ul = el('ul');
  [
    ['Momentum is convex.', 'A +50% week multiplies value by about 2.25×; a −30% week cuts it to about 0.49×. Breakouts compound, slides punish.'],
    ['Size is dampened.', 'TVL enters as TVL^0.65, so a protocol 100× bigger is about 20× more valuable on size alone — momentum decides the rest.'],
    ['Ripeness peaks at 1–3 years.', 'Too young (under 90 days) is discounted as unproven; over four years with no token recorded tempers the claim.'],
    ['Breadth pays.', 'Each extra chain adds 4% (up to six chains): a breakout on several chains at once is wider than on one.'],
    ['Bands set the farm clock.', 'BREAKOUT holds 21 days, RISING 30, STEADY 45, COOLING 60 — hot protocols snapshot sooner.'],
  ].forEach(function (item) {
    ul.appendChild(el('li', {}, el('b', { text: item[0] + ' ' }), document.createTextNode(item[1])));
  });
  model.appendChild(ul);
  model.appendChild(el('p', { class: 'lede', text: 'Snapshot: DefiLlama protocols at or above $5,000,000 TVL, fetched ' + DATA.as_of + '. Watchlist floor $50,000,000. “No token recorded” means the snapshot records no market cap, CoinGecko id or symbol — never that the protocol has none.' }));

  renderControls();
  renderTable();
  if (state.selected) openDetail(state.selected);
})();
