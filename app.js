/* =========================================================
   DrivePulse - app.js  (Phase 2 + moment timeline)

   The "brain" of the main screen. It shows things and reacts to taps;
   it does no measuring itself.

     1. METRIC CATALOGUE - the list of everything the dashboard shows
     2. STATE            - what the app remembers right now
     3. STATUS LOG       - writing plain-language messages
     4. DASHBOARD        - building the tiles, refreshing the numbers,
                           and listing the moment timeline
     5. LIVE STRIP       - speed / distance / average, and the sensor chips
     6. MODE SELECTOR    - Passive (Console) or Vision (Windshield)
     7. START / STOP     - the drive button, trip timer and saving the ride
     8. START-UP         - runs once when the page opens

   Phase 2 change: the invented "demo feed" is gone. Every number now
   comes from sensors.js (real GPS and motion). When there is no real
   reading, a tile shows "--" instead of a made-up value.

   This file talks to two helpers, if they are loaded:
     DrivePulseSensors (sensors.js)  - the real readings
     DrivePulseHistory (history.js)  - saving finished rides
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. METRIC CATALOGUE ----------
     Add, remove or reword a metric here and the dashboard rebuilds
     itself to match. No HTML editing needed.

     Each metric has:
       id    - short unique name. It must match the name sensors.js
               uses for the same reading (see "RESULTS" in sensors.js).
       group - which coloured group it sits in (see GROUPS)
       name  - the title on the tile
       kind  - how to show the number:
                 'score'   0-100 with a bar      'percent' 0-100% with a bar
                 'time'    minutes:seconds       'count'   a whole number
                 'gap'     seconds, one decimal
       hint  - one short line under the number
       why   - "Why it matters" in real driving
       needs - 'vision' marks a camera metric. Those are PLACEHOLDERS
               until the camera phase is built. */

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
      why: 'Smooth inputs keep the tyres gripping, passengers comfortable and fuel use down. Every other score builds on this one.'
    },
    {
      id: 'gentleStops', group: 'smooth', name: 'Gentle stop ratio', kind: 'percent',
      hint: 'stops that ended softly',
      why: 'A soft stop means you saw it coming early. It also gives the driver behind you more time to react.'
    },
    {
      id: 'easyLaunches', group: 'smooth', name: 'Easy launch ratio', kind: 'percent',
      hint: 'calm pull-aways from a standstill',
      why: 'Pulling away gently saves fuel and tyres, and keeps you in control if the road is wet or someone steps out.'
    },

    /* --- Flow and rhythm --- */
    {
      id: 'cruiseStreak', group: 'flow', name: 'Steady cruise streak', kind: 'time',
      hint: 'longest stretch at an even speed',
      why: 'An even speed makes you predictable to others and is where a car is most efficient. Long streaks show a relaxed, settled drive.'
    },
    {
      id: 'speedConsistency', group: 'flow', name: 'Speed consistency', kind: 'score',
      hint: 'how little your speed wobbles',
      why: 'Speeding up and slowing down for no reason tires you out and sends ripples back through the traffic behind you.'
    },
    {
      id: 'tripFlow', group: 'flow', name: 'Trip flow', kind: 'percent',
      hint: 'time spent rolling, not standing',
      why: 'Rolling slowly beats stopping and sprinting. High flow usually means good gaps and looking far ahead.'
    },

    /* --- Corners and composure --- */
    {
      id: 'corneringPoise', group: 'poise', name: 'Cornering poise', kind: 'score',
      hint: 'tidy, unhurried turns',
      why: 'Slowing before a bend and steering in one clean sweep keeps the car balanced and leaves grip in reserve for surprises.'
    },
    {
      id: 'calmStreak', group: 'poise', name: 'Calm streak', kind: 'time',
      hint: 'longest run with no sharp moment',
      why: 'A long calm streak shows you are staying ahead of the traffic instead of reacting at the last second.'
    },

    /* --- Reading the road --- */
    {
      id: 'anticipation', group: 'aware', name: 'Anticipation', kind: 'percent',
      hint: 'slow-downs done gradually, by easing off early',
      why: 'Easing off early for a red light or a queue is the clearest sign you are reading the road. It saves brakes and fuel too.'
    },
    {
      id: 'followSpace', group: 'aware', name: 'Following space', kind: 'gap', needs: 'vision',
      hint: 'time gap to the car ahead',
      why: 'Space is time to react. Around three seconds in the dry, and more in rain, turns most surprises into non-events.'
    },
    {
      id: 'laneSteadiness', group: 'aware', name: 'Lane steadiness', kind: 'score', needs: 'vision',
      hint: 'holding a clean line in your lane',
      why: 'Drifting inside the lane can be an early sign of tiredness or distraction. A steady line keeps you predictable.'
    },

    /* --- Watch-outs --- */
    {
      id: 'sharpMoments', group: 'watch', name: 'Sharp moments', kind: 'count',
      hint: 'hard brakes, jabs and sharp turns (lower is better)',
      why: 'Each one is worth a second look: was I too close, too fast, or looking too near? No blame, just clues.'
    },
    {
      id: 'stopGoBursts', group: 'watch', name: 'Stop-and-go bursts', kind: 'count',
      hint: 'pull away, then stop again within seconds (lower is better)',
      why: 'Sprinting to the next queue gains nothing and wears out the car and you. Spotting these helps you leave a rolling gap instead.'
    }
  ];

  // The Drive Score blends these six scores. The weights add up to 1.
  // If a score has no data yet, the rest share its weight.
  const SCORE_PARTS = [
    { id: 'smoothness',       weight: 0.25 },
    { id: 'anticipation',     weight: 0.20 },
    { id: 'gentleStops',      weight: 0.15 },
    { id: 'speedConsistency', weight: 0.15 },
    { id: 'corneringPoise',   weight: 0.15 },
    { id: 'tripFlow',         weight: 0.10 }
  ];

  const MAX_LOG_LINES = 60;         // older messages drop off the bottom
  const RING_LENGTH = 326.73;       // outline length of the score ring (matches styles.css)

  // The two helper files. Either can be missing; the app copes.
  const Sensors = window.DrivePulseSensors || null;
  const History = window.DrivePulseHistory || null;


  /* ---------- 2. STATE ----------
     One object holding everything the app needs to remember. */

  const state = {
    mode: 'passive',     // 'passive' or 'vision'
    driving: false,      // is a drive running?
    readings: 'none',    // 'none' (no drive yet), 'live', or 'final' (last drive)
    startedAt: 0,        // clock reading when Start was pressed
    tickId: null,        // handle for the once-a-second timer
    values: {},          // metric id -> number, or null when not measured
    highlights: [],      // highlight moments from sensors.js
    moments: []          // the moment timeline from sensors.js
  };

  // Grab the page elements once, so we do not search for them every second.
  const els = {
    driveBtn: document.getElementById('drive-btn'),
    pillText: document.getElementById('drive-pill-text'),
    tripTime: document.getElementById('trip-time'),
    modeInputs: Array.from(document.querySelectorAll('input[name="mode"]')),
    modeLocked: document.getElementById('mode-locked'),
    liveSpeed: document.getElementById('live-speed'),
    liveDistance: document.getElementById('live-distance'),
    liveAvg: document.getElementById('live-avg'),
    sensorChips: document.getElementById('sensor-chips'),
    log: document.getElementById('log'),
    logClear: document.getElementById('log-clear'),
    readingsTag: document.getElementById('readings-tag'),
    groups: document.getElementById('metric-groups'),
    highlights: document.getElementById('highlights'),
    moments: document.getElementById('moments'),
    scoreNum: document.getElementById('score-num'),
    scoreRing: document.getElementById('score-ring'),
    scoreWord: document.getElementById('score-word')
  };

  const tiles = {};      // metric id -> the pieces of its tile on the page


  /* ---------- Small helpers ---------- */

  function clamp(number, low, high) {
    return Math.min(high, Math.max(low, number));
  }

  function isNumber(value) {
    return typeof value === 'number' && isFinite(value);
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

        // Camera metrics carry a visible "Placeholder" badge so they are
        // never mistaken for a live reading.
        if (metric.needs === 'vision') {
          tile.classList.add('is-placeholder');
          tile.append(make('p', 'metric__badge', 'Placeholder'));
        }

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
  // A missing reading becomes "--".
  function formatMetric(metric, value) {
    if (!isNumber(value)) return { num: '--', unit: '' };
    if (metric.kind === 'score')   return { num: String(Math.round(value)), unit: '/100' };
    if (metric.kind === 'percent') return { num: String(Math.round(value)), unit: '%' };
    if (metric.kind === 'time')    return { num: formatClock(value), unit: 'min' };
    if (metric.kind === 'gap')     return { num: value.toFixed(1), unit: 'sec' };
    return { num: String(Math.round(value)), unit: '' };
  }

  // The same thing as one piece of text, for saving with a ride.
  function metricText(metric, value) {
    if (metric.needs === 'vision') return 'not built yet';
    if (!isNumber(value)) return 'not measured';
    const shown = formatMetric(metric, value);
    if (metric.kind === 'time') return shown.num;
    if (metric.kind === 'gap') return shown.num + ' sec';
    return shown.num + shown.unit;
  }

  // The Drive Score: a weighted blend of up to six scores, minus a little
  // for each sharp moment. No real movement = no score.
  function driveScore(values) {
    if (!isNumber(values.smoothness)) return null;
    let total = 0;
    let weight = 0;
    SCORE_PARTS.forEach(function (part) {
      if (isNumber(values[part.id])) {
        total += values[part.id] * part.weight;
        weight += part.weight;
      }
    });
    const penalty = Math.min((values.sharpMoments || 0) * 2, 10);
    return clamp(Math.round(total / weight - penalty), 0, 100);
  }

  function scoreWord(score) {
    if (score === null) {
      return state.driving ? 'Waiting for movement' : (state.readings === 'final' ? 'No score for that drive' : 'Ready when you are');
    }
    if (score >= 90) return 'Silky';
    if (score >= 80) return 'Smooth operator';
    if (score >= 70) return 'Settling in nicely';
    return 'Room to relax';
  }

  function paintHighlights() {
    els.highlights.replaceChildren();

    if (state.highlights.length === 0) {
      const empty = state.driving
        ? 'Highlights appear once the car has been moving for a little while.'
        : 'Highlights from a drive appear here.';
      els.highlights.append(make('li', 'empty', empty));
      return;
    }

    state.highlights.forEach(function (item) {
      const row = make('li', 'highlight');
      const emoji = make('span', 'highlight__emoji', item.emoji);
      emoji.setAttribute('aria-hidden', 'true');
      const words = make('div');
      words.append(make('p', 'highlight__title', item.title), make('p', 'highlight__text', item.text));
      row.append(emoji, words);
      els.highlights.append(row);
    });
  }

  // The moment timeline: each thing the sensors noticed, newest on top,
  // with what happened, why it was flagged, and a tip.
  // (Feedback buttons for these live in Trip History, on the saved ride.)
  function paintMoments() {
    if (!els.moments) return;
    els.moments.replaceChildren();

    if (state.moments.length === 0) {
      const empty = state.driving
        ? 'Moments appear here as they happen: hard brakes, quick launches, brisk corners, rough bumps and long steady stretches.'
        : (state.readings === 'final' ? 'No individual moments were logged on that drive.' : 'Moments from a drive appear here, each with what happened and why it was flagged.');
      els.moments.append(make('li', 'empty', empty));
      return;
    }

    state.moments.slice().reverse().forEach(function (moment) {
      const card = make('li', 'moment');
      card.dataset.level = moment.level;      // styles.css colours it: sharp, firm, road, good

      const d = new Date(moment.at);
      const when = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() +
        (moment.durationSec ? ', lasted ' + formatClock(moment.durationSec) : '');
      const head = make('div', 'moment__head');
      head.append(make('span', 'moment__label', moment.label), make('span', 'moment__time', when));

      const why = make('p', 'moment__why');
      why.append(make('strong', '', 'Why it was flagged: '), moment.why);
      const tip = make('p', 'moment__tip');
      tip.append(make('strong', '', 'Tip: '), moment.tip);

      card.append(head, make('p', 'moment__what', moment.what), why, tip);
      els.moments.append(card);
    });

    if (!state.driving) {
      els.moments.append(make('li', 'empty', 'To rate these moments, open this ride in Trip History below.'));
    }
  }

  // Refreshes the whole dashboard from state.values.
  function paint() {
    // The label in the corner says what kind of numbers these are.
    document.body.dataset.readings = state.readings;
    els.readingsTag.textContent =
      state.readings === 'live' ? 'Live sensor readings' :
      state.readings === 'final' ? 'Last drive, final numbers' : 'No drive yet';

    METRICS.forEach(function (metric) {
      const tile = tiles[metric.id];

      if (metric.needs === 'vision') {
        tile.num.textContent = '--';
        tile.unit.textContent = '';
        tile.hint.textContent = state.mode === 'vision'
          ? 'Camera feature, not built yet'
          : 'Needs Vision mode (camera, not built yet)';
        if (tile.fill) tile.fill.style.width = '0%';
        return;
      }

      const value = state.values[metric.id];
      const shown = formatMetric(metric, value);
      tile.root.classList.toggle('is-empty', !isNumber(value));
      tile.num.textContent = shown.num;
      tile.unit.textContent = shown.unit;
      tile.hint.textContent = metric.hint;
      if (tile.fill) tile.fill.style.width = (isNumber(value) ? clamp(value, 0, 100) : 0) + '%';
    });

    const score = driveScore(state.values);
    els.scoreNum.textContent = score === null ? '--' : score;
    els.scoreWord.textContent = scoreWord(score);
    els.scoreRing.style.strokeDashoffset = RING_LENGTH * (1 - (score === null ? 0 : score) / 100);

    paintHighlights();
    paintMoments();
  }


  /* ---------- 5. LIVE STRIP ---------- */

  // The three big numbers under the Start button.
  function paintLive(snapshot) {
    const speed = snapshot ? snapshot.speedKmh : null;
    const distance = snapshot ? snapshot.distanceKm : null;
    const avg = snapshot ? snapshot.avgSpeedKmh : null;

    els.liveSpeed.textContent = isNumber(speed) ? Math.round(speed) : '--';
    els.liveDistance.textContent = isNumber(distance) ? (distance < 10 ? distance.toFixed(2) : distance.toFixed(1)) : '--';
    els.liveAvg.textContent = isNumber(avg) ? Math.round(avg) : '--';
  }

  // sensors.js calls this whenever a sensor changes state.
  // state is one of: idle, waiting, live, weak, off (styles.css colours them).
  function paintSensor(name, sensorState, text) {
    const chip = els.sensorChips.querySelector('[data-sensor="' + name + '"]');
    if (!chip) return;
    chip.dataset.state = sensorState;
    chip.querySelector('.sensor__text').textContent = text;
  }


  /* ---------- 6. MODE SELECTOR ---------- */

  function setMode(mode) {
    state.mode = mode;
    document.body.dataset.mode = mode;      // a sign styles.css can read
    paint();

    if (mode === 'vision') {
      log('Vision (Windshield) selected. The camera is not built yet, so a drive in this mode is measured with GPS and motion only.', 'info');
    } else {
      log('Passive (Console) selected. GPS and motion do the measuring.', 'info');
    }
  }


  /* ---------- 7. START / STOP ---------- */

  function startDrive() {
    state.driving = true;
    state.readings = 'live';
    state.startedAt = Date.now();
    state.values = {};
    state.highlights = [];
    state.moments = [];

    document.body.dataset.driving = 'true';
    els.driveBtn.textContent = 'Stop Drive';
    els.driveBtn.setAttribute('aria-pressed', 'true');
    els.pillText.textContent = 'Driving';
    els.tripTime.textContent = '0:00';
    els.modeLocked.textContent = modeLabel() + ' mode, locked until you stop.';
    els.modeInputs.forEach(function (input) { input.disabled = true; });

    log('Drive started in ' + modeLabel() + ' mode.', 'good');
    if (state.mode === 'vision') {
      log('Vision mode: camera features are not built yet. This drive uses GPS and motion only.', 'warn');
    }

    // Must happen right here, inside the button tap, so the browser
    // allows the permission questions.
    if (Sensors) {
      Sensors.start({ onLog: log, onStatus: paintSensor });
    } else {
      log('sensors.js is not loaded, so only the trip timer runs. Nothing is being measured.', 'alert');
    }

    paintLive(null);
    paint();
    state.tickId = setInterval(tick, 1000);   // call tick() once every second
  }

  // Runs once a second while driving: asks sensors.js for the latest numbers.
  function tick() {
    els.tripTime.textContent = formatClock((Date.now() - state.startedAt) / 1000);
    if (!Sensors) return;
    const snapshot = Sensors.read();
    state.values = snapshot.metrics;
    state.highlights = snapshot.highlights;
    state.moments = snapshot.moments;
    paintLive(snapshot);
    paint();
  }

  function stopDrive() {
    clearInterval(state.tickId);
    state.tickId = null;
    const endedAt = Date.now();
    const durationSec = Math.round((endedAt - state.startedAt) / 1000);

    // Collect the final numbers before anything is reset.
    const final = Sensors ? Sensors.stop() : null;
    if (final) {
      state.values = final.metrics;
      state.highlights = final.highlights;
      state.moments = final.moments;
    }

    state.driving = false;
    state.readings = 'final';
    document.body.dataset.driving = 'false';
    els.driveBtn.textContent = 'Start Drive';
    els.driveBtn.setAttribute('aria-pressed', 'false');
    els.pillText.textContent = 'Parked';
    els.tripTime.textContent = formatClock(durationSec);
    els.modeInputs.forEach(function (input) { input.disabled = false; });

    paintLive(final);
    paint();

    const score = driveScore(state.values);
    if (score !== null) {
      log('Drive stopped after ' + formatClock(durationSec) + '. ' + final.distanceKm.toFixed(2) + ' km, Drive Score ' + score + '.', 'good');
    } else {
      log('Drive stopped after ' + formatClock(durationSec) + '. No real movement was measured, so there are no scores.', 'warn');
    }

    saveRide(final, endedAt, durationSec, score);
  }

  // Packs the finished drive into one record and hands it to history.js.
  function saveRide(final, endedAt, durationSec, score) {
    if (!History) {
      log('history.js is not loaded, so this ride was not saved.', 'warn');
      return;
    }

    const groupOf = {};
    GROUPS.forEach(function (group) { groupOf[group.id] = group; });

    const ride = {
      // A unique ID: the start time plus a few random letters.
      id: 'ride-' + state.startedAt.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      version: 2,
      startedAt: state.startedAt,
      endedAt: endedAt,
      durationSec: durationSec,
      mode: state.mode,
      distanceKm: final ? final.distanceKm : null,
      movingSec: final ? Math.round(final.movingSec) : 0,
      avgSpeedKmh: final ? final.avgSpeedKmh : null,
      topSpeedKmh: final ? final.topSpeedKmh : null,
      driveScore: score,
      // Names and text are saved WITH the ride, so an old ride still reads
      // correctly even if the catalogue above changes later.
      metrics: METRICS.map(function (metric) {
        const value = isNumber(state.values[metric.id]) ? state.values[metric.id] : null;
        return {
          id: metric.id,
          name: metric.name,
          group: groupOf[metric.group].title,
          tone: groupOf[metric.group].tone,
          value: metric.needs === 'vision' ? null : value,
          text: metricText(metric, value)
        };
      }),
      highlights: state.highlights,
      // The moment timeline. history.js later adds your feedback to each one.
      moments: final ? final.moments : [],
      // The thresholds this drive was judged with (factory or learned).
      tune: final ? final.tune : null,
      sensors: {
        gps: final ? final.hadGps : false,
        motion: final ? final.hadMotion : false,
        gpsGaps: final ? final.gpsGaps : 0,
        interruptions: final ? final.interruptions : 0,
        hiddenSec: final ? Math.round(final.hiddenSec) : 0
      }
    };

    const result = History.saveRide(ride);
    if (result.ok) {
      log('Ride saved to Trip History (' + result.count + (result.count === 1 ? ' ride' : ' rides') + ' saved). It stays until you delete it.', 'fun');
    } else {
      log('Could not save this ride: ' + result.error + '.', 'alert');
    }
  }


  /* ---------- 8. START-UP ---------- */

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

  if (History) {
    const saved = History.countRides();
    if (saved > 0) log(saved + (saved === 1 ? ' saved ride' : ' saved rides') + ' loaded from this phone. See Trip History below.', 'fun');
  }
  log('DrivePulse is ready. Choose where the phone sits, then press Start Drive.', 'info');
})();
