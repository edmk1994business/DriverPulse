/* =========================================================
   DrivePulse - app.js  (Phase 1)

   The "brain" of the main screen:
     1. METRIC CATALOGUE - the list of everything the dashboard shows
     2. STATE            - what the app remembers right now
     3. STATUS LOG       - writing plain-language messages
     4. DASHBOARD        - building the tiles and refreshing the numbers
     5. MODE SELECTOR    - Passive (Console) or Vision (Windshield)
     6. START / STOP     - the drive button and the trip timer
     7. DEMO FEED        - PLACEHOLDER: invented numbers so the layout moves
     8. START-UP         - runs once when the page opens

   IMPORTANT: there is NO real GPS, motion or camera code in here.
   Section 7 makes up numbers. In Phase 2 a new file (sensors.js)
   will supply real readings and section 7 gets deleted. Nothing
   else in this file needs to change for that.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. METRIC CATALOGUE ----------
     Add, remove or reword a metric here and the dashboard rebuilds
     itself to match. No HTML editing needed.

     Each metric has:
       id    - short unique name
       group - which coloured group it sits in (see GROUPS)
       name  - the title on the tile
       kind  - how to show the number:
                 'score'   0-100 with a bar      'percent' 0-100% with a bar
                 'time'    minutes:seconds       'count'   a whole number
                 'gap'     seconds, one decimal
       hint  - one short line under the number
       why   - "Why it matters" in real driving
       needs - 'vision' if it only works with the camera (optional)
       demo  - numbers used ONLY by the demo feed in section 7 */

  const GROUPS = [
    { id: 'smooth', title: 'Smooth inputs',       tone: 'mint' },
    { id: 'flow',   title: 'Flow and rhythm',     tone: 'sky' },
    { id: 'poise',  title: 'Corners and composure', tone: 'purple' },
    { id: 'aware',  title: 'Reading the road',    tone: 'amber' },
    { id: 'watch',  title: 'Watch-outs',          tone: 'coral' }
  ];

  const METRICS = [
    /* --- Smooth inputs --- */
    {
      id: 'smoothness', group: 'smooth', name: 'Smoothness', kind: 'score',
      hint: 'gentle pedals and steering',
      why: 'Smooth inputs keep the tyres gripping, passengers comfortable and fuel use down. Every other score builds on this one.',
      demo: { start: 82, min: 55, max: 98, step: 1.5 }
    },
    {
      id: 'gentleStops', group: 'smooth', name: 'Gentle stop ratio', kind: 'percent',
      hint: 'stops that ended softly',
      why: 'A soft stop means you saw it coming early. It also gives the driver behind you more time to react.',
      demo: { start: 78, min: 40, max: 100, step: 1.2 }
    },
    {
      id: 'easyLaunches', group: 'smooth', name: 'Easy launch ratio', kind: 'percent',
      hint: 'calm pull-aways from a standstill',
      why: 'Pulling away gently saves fuel and tyres, and keeps you in control if the road is wet or someone steps out.',
      demo: { start: 85, min: 50, max: 100, step: 1.2 }
    },

    /* --- Flow and rhythm --- */
    {
      id: 'cruiseStreak', group: 'flow', name: 'Steady cruise streak', kind: 'time',
      hint: 'longest stretch at an even speed',
      why: 'An even speed makes you predictable to others and is where a car is most efficient. Long streaks show a relaxed, settled drive.',
      demo: { start: 222 }
    },
    {
      id: 'speedConsistency', group: 'flow', name: 'Speed consistency', kind: 'score',
      hint: 'how little your speed wobbles',
      why: 'Speeding up and slowing down for no reason tires you out and sends ripples back through the traffic behind you.',
      demo: { start: 76, min: 45, max: 97, step: 1.5 }
    },
    {
      id: 'tripFlow', group: 'flow', name: 'Trip flow', kind: 'percent',
      hint: 'time spent rolling, not stop-start',
      why: 'Rolling slowly beats stopping and sprinting. High flow usually means good gaps and looking far ahead.',
      demo: { start: 71, min: 35, max: 96, step: 1.2 }
    },

    /* --- Corners and composure --- */
    {
      id: 'corneringPoise', group: 'poise', name: 'Cornering poise', kind: 'score',
      hint: 'tidy, unhurried turns',
      why: 'Slowing before a bend and steering in one clean sweep keeps the car balanced and leaves grip in reserve for surprises.',
      demo: { start: 80, min: 50, max: 98, step: 1.5 }
    },
    {
      id: 'calmStreak', group: 'poise', name: 'Calm streak', kind: 'time',
      hint: 'time since the last sharp moment',
      why: 'A growing calm streak shows you are staying ahead of the traffic instead of reacting at the last second.',
      demo: { start: 370 }
    },

    /* --- Reading the road --- */
    {
      id: 'anticipation', group: 'aware', name: 'Anticipation', kind: 'percent',
      hint: 'slow-downs started by lifting off early',
      why: 'Easing off early for a red light or a queue is the clearest sign you are reading the road. It saves brakes and fuel too.',
      demo: { start: 64, min: 30, max: 95, step: 1.5 }
    },
    {
      id: 'followSpace', group: 'aware', name: 'Following space', kind: 'gap', needs: 'vision',
      hint: 'time gap to the car ahead',
      why: 'Space is time to react. Around three seconds in the dry, and more in rain, turns most surprises into non-events.',
      demo: { start: 2.8, min: 1.2, max: 4.5, step: 0.15 }
    },
    {
      id: 'laneSteadiness', group: 'aware', name: 'Lane steadiness', kind: 'score', needs: 'vision',
      hint: 'holding a clean line in your lane',
      why: 'Drifting inside the lane can be an early sign of tiredness or distraction. A steady line keeps you predictable.',
      demo: { start: 88, min: 55, max: 99, step: 1.2 }
    },

    /* --- Watch-outs --- */
    {
      id: 'sharpMoments', group: 'watch', name: 'Sharp moments', kind: 'count',
      hint: 'hard brakes, jabs and swerves (lower is better)',
      why: 'Each one is worth a second look: was I too close, too fast, or looking too near? No blame, just clues.',
      demo: { start: 2 }
    },
    {
      id: 'stopGoBursts', group: 'watch', name: 'Stop-and-go bursts', kind: 'count',
      hint: 'sprint-then-brake cycles (lower is better)',
      why: 'Sprinting to the next queue gains nothing and wears out the car and you. Spotting these helps you leave a rolling gap instead.',
      demo: { start: 3 }
    }
  ];

  const MAX_LOG_LINES = 40;         // older messages drop off the bottom
  const RING_LENGTH = 326.73;       // outline length of the score ring (matches styles.css)


  /* ---------- 2. STATE ----------
     One object holding everything the app needs to remember. */

  const state = {
    mode: 'passive',     // 'passive' or 'vision'
    driving: false,      // is a drive running?
    startedAt: 0,        // clock reading when Start was pressed
    tickId: null,        // handle for the once-a-second timer
    currentCruise: 0,    // seconds in the cruise streak happening right now
    values: {}           // metric id -> its current number
  };

  // Grab the page elements once, so we do not search for them every second.
  const els = {
    driveBtn: document.getElementById('drive-btn'),
    pillText: document.getElementById('drive-pill-text'),
    tripTime: document.getElementById('trip-time'),
    modeInputs: Array.from(document.querySelectorAll('input[name="mode"]')),
    log: document.getElementById('log'),
    logClear: document.getElementById('log-clear'),
    groups: document.getElementById('metric-groups'),
    highlights: document.getElementById('highlights'),
    scoreNum: document.getElementById('score-num'),
    scoreRing: document.getElementById('score-ring'),
    scoreWord: document.getElementById('score-word')
  };

  const tiles = {};      // metric id -> the pieces of its tile on the page


  /* ---------- Small helpers ---------- */

  function clamp(number, low, high) {
    return Math.min(high, Math.max(low, number));
  }

  // 95 seconds -> "1:35"
  function formatClock(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function modeLabel() {
    return state.mode === 'vision' ? 'Vision (Windshield)' : 'Passive (Console)';
  }


  /* ---------- 3. STATUS LOG ----------
     log('message', 'type') adds one line, newest on top.
     Types set the dot colour: info, good, warn, alert, fun. */

  function log(message, type) {
    const now = new Date();
    const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(function (n) { return (n < 10 ? '0' : '') + n; })
      .join(':');

    const line = make('li', 'log__item');
    line.dataset.type = type || 'info';
    line.append(make('time', '', stamp), make('span', '', message));
    els.log.prepend(line);

    while (els.log.children.length > MAX_LOG_LINES) {
      els.log.lastElementChild.remove();
    }
  }


  /* ---------- 4. DASHBOARD ---------- */

  // Runs once: creates a tile for every metric in the catalogue.
  function buildDashboard() {
    GROUPS.forEach(function (group) {
      const members = METRICS.filter(function (m) { return m.group === group.id; });
      if (members.length === 0) return;

      const section = make('div', 'group');
      section.dataset.tone = group.tone;
      const grid = make('div', 'group__grid');
      section.append(make('h3', 'group__title', group.title), grid);

      members.forEach(function (metric) {
        const tile = make('article', 'metric');
        const value = make('p', 'metric__value');
        const num = make('span', 'metric__num');
        const unit = make('span', 'metric__unit');
        const hint = make('p', 'metric__hint');
        value.append(num, unit);
        tile.append(make('h4', 'metric__name', metric.name), value, hint);

        // Only 0-100 style metrics get a progress bar.
        let fill = null;
        if (metric.kind === 'score' || metric.kind === 'percent') {
          const meter = make('div', 'meter');
          fill = make('div', 'meter__fill');
          meter.setAttribute('aria-hidden', 'true');
          meter.append(fill);
          tile.append(meter);
        }

        // <details> is a built-in "tap to open" box. No script needed.
        const why = make('details', 'metric__why');
        why.append(make('summary', '', 'Why it matters'), make('p', '', metric.why));
        tile.append(why);

        grid.append(tile);
        tiles[metric.id] = { root: tile, num: num, unit: unit, hint: hint, fill: fill };
      });

      els.groups.append(section);
    });
  }

  // Turns a raw number into what the tile should display.
  function formatMetric(metric, value) {
    if (metric.kind === 'score')   return { num: String(Math.round(value)), unit: '/100' };
    if (metric.kind === 'percent') return { num: String(Math.round(value)), unit: '%' };
    if (metric.kind === 'time')    return { num: formatClock(value), unit: 'min' };
    if (metric.kind === 'gap')     return { num: value.toFixed(1), unit: 'sec' };
    return { num: String(Math.round(value)), unit: '' };
  }

  // The Drive Score: a weighted blend of six scores, minus a little
  // for each sharp moment. The weights add up to 1.
  function driveScore() {
    const v = state.values;
    const blend =
      v.smoothness * 0.25 +
      v.anticipation * 0.20 +
      v.gentleStops * 0.15 +
      v.speedConsistency * 0.15 +
      v.corneringPoise * 0.15 +
      v.tripFlow * 0.10;
    const penalty = Math.min(v.sharpMoments * 2, 10);
    return clamp(Math.round(blend - penalty), 0, 100);
  }

  function scoreWord(score) {
    if (score >= 90) return 'Silky';
    if (score >= 80) return 'Smooth operator';
    if (score >= 70) return 'Settling in nicely';
    return 'Room to relax';
  }

  // Highlight moments. For now these are summaries of the numbers above.
  // Later (report phase) they become real, time-stamped moments from a trip.
  function paintHighlights() {
    const v = state.values;
    const items = [
      { emoji: '🏁', title: 'Longest steady cruise', text: formatClock(v.cruiseStreak) + ' at an even pace' },
      { emoji: '🪶', title: 'Soft landings', text: Math.round(v.gentleStops) + '% of stops ended gently' },
      { emoji: '🌀', title: 'Corner composure', text: 'Poise holding at ' + Math.round(v.corneringPoise) + ' out of 100' },
      { emoji: '🌿', title: 'Calm run', text: formatClock(v.calmStreak) + ' without a sharp moment' }
    ];

    els.highlights.replaceChildren();
    items.forEach(function (item) {
      const row = make('li', 'highlight');
      const emoji = make('span', 'highlight__emoji', item.emoji);
      emoji.setAttribute('aria-hidden', 'true');
      const words = make('div');
      words.append(make('p', 'highlight__title', item.title), make('p', 'highlight__text', item.text));
      row.append(emoji, words);
      els.highlights.append(row);
    });
  }

  // Refreshes every number on the dashboard from state.values.
  function paint() {
    METRICS.forEach(function (metric) {
      const tile = tiles[metric.id];
      const locked = metric.needs === 'vision' && state.mode !== 'vision';
      tile.root.classList.toggle('is-locked', locked);

      if (locked) {
        tile.num.textContent = '--';
        tile.unit.textContent = '';
        tile.hint.textContent = 'Needs Vision mode (camera)';
        if (tile.fill) tile.fill.style.width = '0%';
        return;
      }

      const shown = formatMetric(metric, state.values[metric.id]);
      tile.num.textContent = shown.num;
      tile.unit.textContent = shown.unit;
      tile.hint.textContent = metric.hint;
      if (tile.fill) tile.fill.style.width = clamp(state.values[metric.id], 0, 100) + '%';
    });

    const score = driveScore();
    els.scoreNum.textContent = score;
    els.scoreWord.textContent = scoreWord(score);
    els.scoreRing.style.strokeDashoffset = RING_LENGTH * (1 - score / 100);

    paintHighlights();
  }


  /* ---------- 5. MODE SELECTOR ---------- */

  function setMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;      // a sign styles.css can read
    paint();

    if (mode === 'vision') {
      log('Vision (Windshield) selected. Camera metrics show demo values for now; the real camera arrives in a later phase.', 'info');
    } else {
      log('Passive (Console) selected. Motion-based metrics only.', 'info');
    }
  }


  /* ---------- 6. START / STOP ---------- */

  function startDrive() {
    state.driving = true;
    state.startedAt = Date.now();
    state.currentCruise = 0;

    // A new trip starts its counters and streaks from zero.
    METRICS.forEach(function (metric) {
      const fresh = metric.kind === 'time' || metric.kind === 'count';
      state.values[metric.id] = fresh ? 0 : metric.demo.start;
    });

    document.body.dataset.driving = 'true';
    els.driveBtn.textContent = 'Stop Drive';
    els.driveBtn.setAttribute('aria-pressed', 'true');
    els.pillText.textContent = 'Driving';
    els.tripTime.textContent = '0:00';
    els.modeInputs.forEach(function (input) { input.disabled = true; });

    log('Drive started in ' + modeLabel() + ' mode. Mode is locked until you stop.', 'good');
    log('Demo feed running. These numbers are invented, not measured.', 'warn');

    paint();
    state.tickId = setInterval(tick, 1000);   // call tick() once every second
  }

  function stopDrive() {
    clearInterval(state.tickId);
    state.tickId = null;
    state.driving = false;

    document.body.dataset.driving = 'false';
    els.driveBtn.textContent = 'Start Drive';
    els.driveBtn.setAttribute('aria-pressed', 'false');
    els.pillText.textContent = 'Parked';
    els.modeInputs.forEach(function (input) { input.disabled = false; });

    const duration = formatClock((Date.now() - state.startedAt) / 1000);
    log('Drive stopped after ' + duration + '. Demo Drive Score: ' + driveScore() + '.', 'good');
    log('Parked? The Pit-Stop cards are just below the dashboard.', 'fun');
  }

  // Runs once a second while driving.
  function tick() {
    els.tripTime.textContent = formatClock((Date.now() - state.startedAt) / 1000);
    demoFeedStep();
    paint();
  }


  /* ---------- 7. DEMO FEED (PLACEHOLDER) ----------
     Invents believable numbers so we can watch the dashboard move.
     >>> Phase 2: delete this section. sensors.js will write real
         readings into state.values instead. <<< */

  function demoFeedStep() {
    const v = state.values;

    // Scores drift up and down a little each second.
    METRICS.forEach(function (metric) {
      if (metric.kind === 'score' || metric.kind === 'percent' || metric.kind === 'gap') {
        const nudge = (Math.random() - 0.5) * 2 * metric.demo.step;
        v[metric.id] = clamp(v[metric.id] + nudge, metric.demo.min, metric.demo.max);
      }
    });

    // The cruise streak grows, and now and then "traffic" breaks it.
    state.currentCruise += 1;
    if (Math.random() < 0.04) state.currentCruise = 0;
    if (state.currentCruise > v.cruiseStreak) v.cruiseStreak = state.currentCruise;
    if (state.currentCruise === 30) log('Demo: cruise streak passed 0:30. Nice and steady.', 'good');

    // The calm streak grows until a pretend sharp moment resets it.
    v.calmStreak += 1;
    if (Math.random() < 0.02) {
      v.sharpMoments += 1;
      v.calmStreak = 0;
      log('Demo: sharp moment noted. Calm streak restarts.', 'alert');
    }
    if (Math.random() < 0.015) {
      v.stopGoBursts += 1;
      log('Demo: stop-and-go burst spotted.', 'warn');
    }
  }


  /* ---------- 8. START-UP ---------- */

  // Fill the dashboard with sample values so the layout is easy to inspect.
  METRICS.forEach(function (metric) {
    state.values[metric.id] = metric.demo.start;
  });

  buildDashboard();
  paint();

  els.driveBtn.addEventListener('click', function () {
    if (state.driving) stopDrive(); else startDrive();
  });

  els.modeInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.checked) setMode(input.value);
    });
  });

  els.logClear.addEventListener('click', function () {
    els.log.replaceChildren();
    log('Log cleared.', 'info');
  });

  log('Phase 1 preview: the dashboard shows sample values so we can check the layout.', 'warn');
  log('DrivePulse is ready. Choose where the phone sits, then press Start Drive.', 'info');
})();
