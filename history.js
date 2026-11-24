/* =========================================================
   DrivePulse - history.js  (Phase 2 + feedback and tuning report)

   Saved rides and the "Trip History & Summary" view.

     1. STORAGE        - saving, loading, changing and deleting rides
     2. SMALL HELPERS  - turning numbers and dates into readable text
     3. PERIOD FILTER  - All time / Today / Last 7 days / Last 30 days / dates
     4. PERIOD SUMMARY - totals and bests for the rides in the period
     5. RIDE LIST      - one row per ride; tap to open its full stats
                         and its moment timeline
     6. FEEDBACK       - tap-to-teach buttons on moments and whole rides
     7. CALIBRATION    - what the app has learned, reset, and the
                         "Copy Tuning Report for Claude" button
     8. DELETING       - one ride, or all rides, always with a confirmation
     9. BUTTONS        - wiring up taps

   WHERE RIDES LIVE: in the browser's "localStorage", a small notebook
   each website gets on your phone. It survives reloads and restarts.
   It is tied to this site's address and this browser, so rides do not
   follow you to another phone, and "Clear site data" in Chrome erases them.

   app.js uses this file through one object, DrivePulseHistory:
     DrivePulseHistory.saveRide(ride)   save a finished drive
     DrivePulseHistory.countRides()     how many are saved

   Your feedback is saved inside the ride it belongs to. The learning
   itself (changing thresholds) is done by sensors.js; this file only
   tells it what you tapped.

   Remove this file's <script> line in index.html and the app still
   drives and scores; it just stops saving rides.
   ========================================================= */
(function () {
  'use strict';

  const STORAGE_KEY = 'drivepulse.rides.v1';   // the page of the notebook we write on

  const els = {
    section: document.getElementById('history'),
    periods: document.getElementById('history-periods'),
    range: document.getElementById('history-range'),
    from: document.getElementById('history-from'),
    to: document.getElementById('history-to'),
    periodLabel: document.getElementById('history-period-label'),
    summary: document.getElementById('history-summary'),
    periodHighlights: document.getElementById('history-period-highlights'),
    list: document.getElementById('history-list'),
    clearRow: document.getElementById('history-clear-row'),
    tuningPanel: document.getElementById('history-tuning-panel'),
    tuningIntro: document.getElementById('history-tuning-intro'),
    tuning: document.getElementById('history-tuning'),
    tuningActions: document.getElementById('history-tuning-actions'),
    reportStatus: document.getElementById('history-report-status'),
    report: document.getElementById('history-report'),
    dash: document.getElementById('dash')
  };

  // If the history section was removed from index.html, stop quietly.
  if (!els.section || !els.list) return;

  const view = { period: 'all' };              // which period button is selected


  /* ---------- 1. STORAGE ----------
     Rides are kept as one list. localStorage only stores text, so the
     list is turned into text (JSON) on the way in and back on the way out. */

  function loadRides() {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      const rides = text ? JSON.parse(text) : [];
      return Array.isArray(rides) ? rides : [];
    } catch (error) {
      return [];                               // storage blocked or unreadable
    }
  }

  function storeRides(rides) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: 'the browser refused to store it (storage may be full or blocked)' };
    }
  }

  function saveRide(ride) {
    const rides = loadRides();
    rides.push(ride);
    const result = storeRides(rides);
    if (result.ok) {
      result.count = rides.length;
      askBrowserToKeepData();
      render();
    }
    return result;
  }

  // Loads one ride, lets "change" edit it, and saves the list again.
  function updateRide(id, change) {
    const rides = loadRides();
    const ride = rides.filter(function (r) { return r.id === id; })[0];
    if (!ride) return { ok: false };
    change(ride);
    return storeRides(rides);
  }

  function deleteRide(id) {
    storeRides(loadRides().filter(function (ride) { return ride.id !== id; }));
    render();
  }

  function clearAllRides() {
    storeRides([]);
    render();
  }

  // Politely asks the browser not to tidy our saved rides away when the
  // phone runs low on space. The browser may say no; nothing breaks if so.
  function askBrowserToKeepData() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }
  }


  /* ---------- 2. SMALL HELPERS ---------- */

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // 95 seconds -> "1:35"
  function clock(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const secs = seconds % 60;
    return Math.floor(seconds / 60) + ':' + (secs < 10 ? '0' : '') + secs;
  }

  // 4380 seconds -> "1 h 13 min"
  function duration(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    if (seconds < 60) return seconds + ' sec';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return mins + ' min';
    return Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
  }

  function km(value) {
    if (typeof value !== 'number') return '--';
    return (value < 10 ? value.toFixed(2) : value.toFixed(1)) + ' km';
  }

  function dayText(ms) {
    return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function timeText(ms) {
    return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // A plain date-and-time stamp for the report: 2026-11-24 16:05
  function stamp(ms) {
    const d = new Date(ms);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes());
  }

  function modeText(mode) {
    return mode === 'vision' ? 'Vision' : 'Passive';
  }

  // Looks up one saved metric (for example 'smoothness') inside a ride.
  function metricValue(ride, id) {
    const found = (ride.metrics || []).filter(function (m) { return m.id === id; })[0];
    return found && typeof found.value === 'number' ? found.value : null;
  }

  function numbersOnly(list) {
    return list.filter(function (n) { return typeof n === 'number'; });
  }

  function average(list) {
    const nums = numbersOnly(list);
    if (nums.length === 0) return null;
    return nums.reduce(function (sum, n) { return sum + n; }, 0) / nums.length;
  }

  function highest(list) {
    const nums = numbersOnly(list);
    return nums.length ? Math.max.apply(null, nums) : null;
  }


  /* ---------- 3. PERIOD FILTER ---------- */

  // Returns the earliest and latest moment the chosen period covers.
  function periodBounds() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();

    if (view.period === 'today') return { from: new Date(y, m, d).getTime(), to: Infinity };
    if (view.period === 'week')  return { from: new Date(y, m, d - 6).getTime(), to: Infinity };
    if (view.period === 'month') return { from: new Date(y, m, d - 29).getTime(), to: Infinity };
    if (view.period === 'custom') {
      return {
        from: els.from.value ? new Date(els.from.value + 'T00:00:00').getTime() : -Infinity,
        to: els.to.value ? new Date(els.to.value + 'T23:59:59.999').getTime() : Infinity
      };
    }
    return { from: -Infinity, to: Infinity };   // all time
  }

  function periodName() {
    if (view.period === 'today') return 'today';
    if (view.period === 'week') return 'in the last 7 days';
    if (view.period === 'month') return 'in the last 30 days';
    if (view.period === 'custom') {
      if (els.from.value && els.to.value) return 'from ' + els.from.value + ' to ' + els.to.value;
      if (els.from.value) return 'since ' + els.from.value;
      if (els.to.value) return 'up to ' + els.to.value;
      return 'in all dates (pick a From or To date to narrow it)';
    }
    return 'in total';
  }

  function ridesInPeriod() {
    const bounds = periodBounds();
    return loadRides()
      .filter(function (ride) { return ride.startedAt >= bounds.from && ride.startedAt <= bounds.to; })
      .sort(function (a, b) { return b.startedAt - a.startedAt; });   // newest first
  }


  /* ---------- 4. PERIOD SUMMARY ---------- */

  function renderSummary(rides) {
    els.periodLabel.textContent = rides.length + (rides.length === 1 ? ' ride ' : ' rides ') + periodName();

    const totalTime = rides.reduce(function (sum, r) { return sum + (r.durationSec || 0); }, 0);
    const totalKm = rides.reduce(function (sum, r) { return sum + (r.distanceKm || 0); }, 0);
    const avgScore = average(rides.map(function (r) { return r.driveScore; }));
    const smoothness = rides.map(function (r) { return metricValue(r, 'smoothness'); });
    const bestSmooth = highest(smoothness);
    const avgSmooth = average(smoothness);

    const tiles = [
      { label: 'Rides', value: String(rides.length), tone: 'sky' },
      { label: 'Time driven', value: rides.length ? duration(totalTime) : '--', tone: 'sky' },
      { label: 'Distance', value: rides.length ? km(totalKm) : '--', tone: 'sky' },
      { label: 'Average Drive Score', value: avgScore === null ? '--' : Math.round(avgScore) + '/100', tone: 'amber' },
      { label: 'Best smoothness', value: bestSmooth === null ? '--' : Math.round(bestSmooth) + '/100', tone: 'mint' },
      { label: 'Average smoothness', value: avgSmooth === null ? '--' : Math.round(avgSmooth) + '/100', tone: 'mint' }
    ];

    els.summary.replaceChildren();
    tiles.forEach(function (tile) {
      const box = make('div', 'summary__tile');
      box.dataset.tone = tile.tone;
      box.append(make('span', 'summary__value', tile.value), make('span', 'summary__label', tile.label));
      els.summary.append(box);
    });

    renderPeriodHighlights(rides);
  }

  // The stand-out moments across every ride in the period.
  function renderPeriodHighlights(rides) {
    const items = [];

    const scored = rides.filter(function (r) { return typeof r.driveScore === 'number'; });
    if (scored.length) {
      const top = scored.reduce(function (best, r) { return r.driveScore > best.driveScore ? r : best; });
      items.push({ emoji: '🏆', title: 'Top ride', text: 'Drive Score ' + top.driveScore + ' on ' + dayText(top.startedAt) });
    }

    const cruise = bestOf(rides, 'cruiseStreak');
    if (cruise && cruise.value >= 20) {
      items.push({ emoji: '🏁', title: 'Longest steady cruise', text: clock(cruise.value) + ' on ' + dayText(cruise.ride.startedAt) });
    }

    const calm = bestOf(rides, 'calmStreak');
    if (calm && calm.value >= 60) {
      items.push({ emoji: '🌿', title: 'Longest calm run', text: clock(calm.value) + ' on ' + dayText(calm.ride.startedAt) });
    }

    const avgGentle = average(rides.map(function (r) { return metricValue(r, 'gentleStops'); }));
    if (avgGentle !== null) {
      items.push({ emoji: '🪶', title: 'Gentle stops', text: Math.round(avgGentle) + '% on average' });
    }

    const measured = rides.filter(function (r) { return metricValue(r, 'sharpMoments') !== null; });
    if (measured.length) {
      const sharp = measured.reduce(function (sum, r) { return sum + metricValue(r, 'sharpMoments'); }, 0);
      items.push({ emoji: '👀', title: 'Sharp moments', text: sharp + ' across ' + measured.length + (measured.length === 1 ? ' measured ride' : ' measured rides') });
    }

    els.periodHighlights.replaceChildren();
    items.forEach(function (item) { els.periodHighlights.append(highlightRow(item)); });
  }

  // Finds the ride with the highest value for one metric.
  function bestOf(rides, metricId) {
    let best = null;
    rides.forEach(function (ride) {
      const value = metricValue(ride, metricId);
      if (value !== null && (best === null || value > best.value)) best = { ride: ride, value: value };
    });
    return best;
  }

  function highlightRow(item) {
    const row = make('li', 'highlight');
    const emoji = make('span', 'highlight__emoji', item.emoji);
    emoji.setAttribute('aria-hidden', 'true');
    const words = make('div');
    words.append(make('p', 'highlight__title', item.title), make('p', 'highlight__text', item.text));
    row.append(emoji, words);
    return row;
  }


  /* ---------- 5. RIDE LIST ----------
     Each ride is a <details> box: the row is always visible, and tapping
     it opens the full stats underneath. */

  function renderList(rides) {
    els.list.replaceChildren();

    if (rides.length === 0) {
      const none = loadRides().length === 0
        ? 'No rides saved yet. Finish a drive and it appears here.'
        : 'No rides in this period. Try a wider one.';
      els.list.append(make('p', 'empty', none));
      return;
    }

    rides.forEach(function (ride) {
      const box = make('details', 'ride');
      box.dataset.id = ride.id;

      const row = make('summary', 'ride__row');
      const when = make('span', 'ride__when', dayText(ride.startedAt) + ', ' + timeText(ride.startedAt));
      const meta = make('span', 'ride__meta', km(ride.distanceKm) + ', ' + duration(ride.durationSec) + ', ' + modeText(ride.mode));
      const words = make('span', 'ride__words');
      words.append(when, meta);
      const score = make('span', 'ride__score', typeof ride.driveScore === 'number' ? String(ride.driveScore) : '--');
      score.title = 'Drive Score';
      row.append(words, score);

      const body = make('div', 'ride__body');
      box.append(row, body);

      // Build the details only when the ride is first opened.
      box.addEventListener('toggle', function () {
        if (box.open && !body.hasChildNodes()) fillRideBody(body, ride);
      });

      els.list.append(box);
    });
  }

  function fillRideBody(body, ride) {
    // Trip facts
    const facts = make('dl', 'facts');
    [
      ['Drive Score', typeof ride.driveScore === 'number' ? ride.driveScore + '/100' : 'not measured'],
      ['Started', dayText(ride.startedAt) + ', ' + timeText(ride.startedAt)],
      ['Duration', duration(ride.durationSec)],
      ['Distance', typeof ride.distanceKm === 'number' ? km(ride.distanceKm) : 'not measured'],
      ['Time moving', ride.movingSec ? duration(ride.movingSec) : 'not measured'],
      ['Average speed', typeof ride.avgSpeedKmh === 'number' ? Math.round(ride.avgSpeedKmh) + ' km/h' : 'not measured'],
      ['Top speed', typeof ride.topSpeedKmh === 'number' ? Math.round(ride.topSpeedKmh) + ' km/h' : 'not measured'],
      ['Mode', modeText(ride.mode)]
    ].forEach(function (pair) { facts.append(make('dt', '', pair[0]), make('dd', '', pair[1])); });
    body.append(facts);

    // Every metric, grouped the same way as the dashboard
    let currentGroup = null;
    let groupList = null;
    (ride.metrics || []).forEach(function (metric) {
      if (metric.group !== currentGroup) {
        currentGroup = metric.group;
        const heading = make('h4', 'ride__group', metric.group);
        heading.dataset.tone = metric.tone;
        groupList = make('dl', 'facts');
        body.append(heading, groupList);
      }
      groupList.append(make('dt', '', metric.name), make('dd', '', metric.text));
    });

    // Highlight moments
    body.append(make('h4', 'ride__group', 'Highlight moments'));
    if (ride.highlights && ride.highlights.length) {
      const list = make('ul', 'highlights');
      ride.highlights.forEach(function (item) { list.append(highlightRow(item)); });
      body.append(list);
    } else {
      body.append(make('p', 'empty', 'None: this ride had too little measured movement.'));
    }

    // Moment timeline: what happened, why it was flagged, and feedback buttons
    body.append(make('h4', 'ride__group', 'Moment timeline'));
    if (ride.moments && ride.moments.length) {
      body.append(make('p', 'ride__notes', 'Rate any moment. "Rough road / bump" and "Too harsh" teach the app to be less sensitive to that kind of moment.'));
      const timeline = make('ul', 'timeline');
      ride.moments.forEach(function (moment) { timeline.append(momentCard(ride, moment)); });
      body.append(timeline);
    } else {
      body.append(make('p', 'empty', 'No individual moments were logged on this ride.'));
    }

    // Feedback on the ride as a whole
    body.append(make('h4', 'ride__group', 'Rate this ride overall'));
    body.append(make('p', 'ride__notes', 'Were the scores fair? Use "Missed a real move" if something happened that the timeline does not show.'));
    body.append(feedbackBlock(ride.id, null, 'ride', ride.feedback));

    // How well the measuring itself went
    const s = ride.sensors || {};
    const notes = [];
    notes.push(s.gps ? 'GPS was working.' : 'GPS gave no readings, so nothing could be scored.');
    notes.push(s.motion ? 'Motion sensor was working.' : 'No motion sensor readings; scores used GPS alone.');
    if (s.interruptions) notes.push('Screen was locked or the app hidden ' + s.interruptions + (s.interruptions === 1 ? ' time' : ' times') + ' (' + clock(s.hiddenSec || 0) + ' not measured).');
    if (s.gpsGaps) notes.push('GPS paused ' + s.gpsGaps + (s.gpsGaps === 1 ? ' time.' : ' times.'));
    body.append(make('h4', 'ride__group', 'Measurement notes'), make('p', 'ride__notes', notes.join(' ')));
    body.append(make('p', 'ride__id', 'Ride ID: ' + ride.id));

    // Delete button (asks first, see section 6)
    const confirmRow = make('div', 'confirm confirm--end');
    confirmRow.dataset.rideId = ride.id;
    showDeleteButton(confirmRow);
    body.append(confirmRow);
  }


  /* ---------- 6. FEEDBACK ----------
     Four possible answers. Not every answer fits every moment, so each
     kind of moment shows only the ones that make sense for it. */

  const VERDICTS = {
    'spot-on':   'Spot on',
    'bump':      'Rough road / bump (false alarm)',
    'too-harsh': 'Too harsh',
    'missed':    'Missed a real move'
  };

  function verdictsFor(level) {
    if (level === 'ride') return ['spot-on', 'bump', 'too-harsh', 'missed'];
    if (level === 'good') return ['spot-on'];                    // praise: nothing to soften
    if (level === 'road') return ['spot-on', 'too-harsh'];       // it already is a bump
    return ['spot-on', 'bump', 'too-harsh'];                     // sharp and firm moments
  }

  // One entry of the timeline.
  function momentCard(ride, moment) {
    const card = make('li', 'moment');
    card.dataset.level = moment.level || 'sharp';

    const head = make('div', 'moment__head');
    const when = timeText(moment.at) + (moment.durationSec ? ', lasted ' + clock(moment.durationSec) : '');
    head.append(make('span', 'moment__label', moment.label), make('span', 'moment__time', when));
    card.append(head);

    // Rides saved before the timeline existed only have a label and a speed.
    card.append(make('p', 'moment__what', moment.what || ('From about ' + moment.speedKmh + ' km/h.')));
    if (moment.why) {
      const why = make('p', 'moment__why');
      why.append(make('strong', '', 'Why it was flagged: '), moment.why);
      card.append(why);
    }
    if (moment.tip) {
      const tip = make('p', 'moment__tip');
      tip.append(make('strong', '', 'Tip: '), moment.tip);
      card.append(tip);
    }

    if (moment.id) card.append(feedbackBlock(ride.id, moment.id, moment.level || 'sharp', moment.feedback));
    return card;
  }

  // The row of answer buttons, the optional note, and a line for the result.
  function feedbackBlock(rideId, momentId, level, feedback) {
    const box = make('div', 'feedback');
    box.dataset.rideId = rideId;
    if (momentId) box.dataset.momentId = momentId;

    const buttons = make('div', 'feedback__buttons');
    verdictsFor(level).forEach(function (verdict) {
      const button = actionButton('feedback__btn', VERDICTS[verdict], 'feedback');
      button.dataset.verdict = verdict;
      button.setAttribute('aria-pressed', feedback && feedback.verdict === verdict ? 'true' : 'false');
      buttons.append(button);
    });

    const note = make('input', 'feedback__note');
    note.type = 'text';
    note.maxLength = 140;
    note.placeholder = 'Optional short note';
    note.setAttribute('aria-label', 'Optional short note');
    note.value = feedback && feedback.note ? feedback.note : '';

    box.append(buttons, note, make('p', 'feedback__result'));
    return box;
  }

  function findTarget(ride, momentId) {
    if (!momentId) return ride;
    return (ride.moments || []).filter(function (m) { return m.id === momentId; })[0] || null;
  }

  // Runs when an answer button is tapped. Tapping the selected answer again clears it.
  function giveFeedback(box, verdict) {
    const rideId = box.dataset.rideId;
    const momentId = box.dataset.momentId || null;
    const Sensors = window.DrivePulseSensors || null;
    let chosen = null;
    let outcome = null;

    const saved = updateRide(rideId, function (ride) {
      const target = findTarget(ride, momentId);
      if (!target) return;
      const old = target.feedback || { verdict: null, note: '', at: 0 };
      chosen = old.verdict === verdict ? null : verdict;

      // Tell sensors.js, which undoes the old answer's nudge and applies the new one.
      if (Sensors) {
        outcome = Sensors.learn({
          kind: momentId ? (target.kind || target.type) : 'ride',
          verdict: chosen,
          previousVerdict: old.verdict,
          previousAt: old.at,
          rideId: rideId,
          momentId: momentId,
          measured: target.measured,
          limit: target.limit,
          note: old.note
        });
      }
      target.feedback = { verdict: chosen, note: old.note || '', at: Date.now() };
    });

    // Show which answer is now selected, and what (if anything) was learned.
    Array.from(box.querySelectorAll('[data-verdict]')).forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.verdict === chosen ? 'true' : 'false');
    });
    box.querySelector('.feedback__result').textContent = feedbackMessage(saved.ok, chosen, outcome);
    renderTuning();
  }

  function feedbackMessage(ok, chosen, outcome) {
    if (!ok) return 'Could not save this (browser storage is full or blocked).';
    const learned = outcome && outcome.changes.length
      ? outcome.changes.map(function (c) { return c.label + ' ' + c.from + ' to ' + c.to; }).join('; ')
      : '';

    if (chosen === null) return learned ? 'Answer cleared. Put back: ' + learned + '.' : 'Answer cleared.';
    if (chosen === 'missed') return 'Saved for the Tuning Report. This answer does not change calibration by itself; add a note saying what was missed.';
    if (learned) return 'Saved. Learned: ' + learned + '. Used from your next drive.';
    if (chosen === 'spot-on') return 'Saved. The app got this one right, so nothing changes.';
    if (!outcome) return 'Saved. sensors.js is not loaded, so calibration was not changed.';
    return 'Saved. No calibration change (this level has reached its limit).';
  }

  // Runs when a note box loses focus after being edited.
  function saveNote(box, text) {
    const result = updateRide(box.dataset.rideId, function (ride) {
      const target = findTarget(ride, box.dataset.momentId || null);
      if (!target) return;
      const old = target.feedback || { verdict: null, note: '', at: Date.now() };
      target.feedback = { verdict: old.verdict, note: text, at: old.at };
    });
    box.querySelector('.feedback__result').textContent = result.ok ? 'Note saved.' : 'Could not save the note.';
  }


  /* ---------- 7. CALIBRATION ----------
     Shows the thresholds sensors.js is using now next to the factory
     values, with a reset button and the report button. */

  function renderTuning() {
    const Sensors = window.DrivePulseSensors || null;
    if (!els.tuningPanel) return;
    if (!Sensors) { els.tuningPanel.hidden = true; return; }

    const T = Sensors.tuning();
    els.tuningIntro.textContent = T.changed === 0
      ? 'Nothing learned yet: every threshold is at its factory value. Rate moments in a saved ride to start teaching the app.'
      : T.changed + (T.changed === 1 ? ' threshold has' : ' thresholds have') + ' been raised from your feedback. sensors.js uses these numbers from your next drive.';

    els.tuning.replaceChildren();
    T.rows.forEach(function (row) {
      const value = make('dd', row.steps > 0 ? 'is-learned' : '', row.steps > 0 ? row.factory + ' to ' + row.current : String(row.factory));
      els.tuning.append(make('dt', '', row.label), value);
    });

    showTuningButtons();
  }

  function showTuningButtons() {
    els.tuningActions.replaceChildren(
      actionButton('action-btn action-btn--sky', 'Copy Tuning Report for Claude', 'copy-report'),
      actionButton('danger-btn', 'Reset to default TUNE', 'ask-reset-tune')
    );
  }

  function showResetQuestion() {
    els.tuningActions.replaceChildren(
      make('p', 'confirm__text', 'Put every threshold back to its factory value? Your saved feedback and notes are kept.'),
      actionButton('danger-btn danger-btn--solid', 'Yes, reset', 'confirm-reset-tune'),
      actionButton('ghost-btn', 'Keep', 'cancel-reset-tune')
    );
  }

  // Builds the text you paste back to Claude. It contains your feedback,
  // notes and threshold numbers. It contains no GPS positions: the app
  // never stores where you drove.
  function buildReport() {
    const Sensors = window.DrivePulseSensors || null;
    const T = Sensors ? Sensors.tuning() : null;
    const rides = loadRides().sort(function (a, b) { return b.startedAt - a.startedAt; });
    const lines = [];

    // Gather every moment, remembering which ride it came from.
    const moments = [];
    rides.forEach(function (ride) {
      (ride.moments || []).forEach(function (m) { moments.push({ ride: ride, m: m }); });
    });
    const rated = moments.filter(function (x) { return x.m.feedback && x.m.feedback.verdict; });
    const ratedRides = rides.filter(function (r) { return r.feedback && (r.feedback.verdict || r.feedback.note); });

    lines.push('DRIVEPULSE TUNING REPORT');
    lines.push('Generated: ' + stamp(Date.now()));
    lines.push('Rides saved: ' + rides.length + ' | Moments logged: ' + moments.length + ' | Moments rated: ' + rated.length + ' | Rides rated: ' + ratedRides.length);
    lines.push('');

    lines.push('LEARNED TUNE VALUES (factory -> learned, * = changed)');
    if (T) {
      T.rows.forEach(function (row) {
        lines.push((row.steps > 0 ? '* ' : '  ') + row.key + ': ' + row.factory + ' -> ' + row.current + '  (' + row.steps + ' steps of ' + T.stepPercent + '%)  // ' + row.label);
      });
      lines.push('');
      lines.push('PASTE-READY LINES FOR DEFAULT_TUNE IN sensors.js (changed values only)');
      const changed = T.rows.filter(function (row) { return row.steps > 0; });
      if (changed.length === 0) lines.push('  (nothing changed yet)');
      changed.forEach(function (row) { lines.push('  ' + row.key + ': ' + row.current + ','); });
    } else {
      lines.push('  sensors.js was not loaded, so no threshold values are available.');
    }
    lines.push('');

    lines.push('FEEDBACK TALLY BY KIND OF MOMENT');
    const kinds = {};
    moments.forEach(function (x) {
      const kind = x.m.kind || x.m.type || 'unknown';
      if (!kinds[kind]) kinds[kind] = { logged: 0, 'spot-on': 0, bump: 0, 'too-harsh': 0, readings: [], flaggedFalse: [] };
      const k = kinds[kind];
      k.logged += 1;
      if (typeof x.m.measured === 'number') k.readings.push(x.m.measured);
      const verdict = x.m.feedback && x.m.feedback.verdict;
      if (verdict && k[verdict] !== undefined) k[verdict] += 1;
      if ((verdict === 'bump' || verdict === 'too-harsh') && typeof x.m.measured === 'number') k.flaggedFalse.push(x.m.measured.toFixed(2));
    });
    if (Object.keys(kinds).length === 0) lines.push('  (no moments logged yet)');
    Object.keys(kinds).forEach(function (kind) {
      const k = kinds[kind];
      let line = '  ' + kind + ': ' + k.logged + ' logged | spot-on ' + k['spot-on'] + ', bump ' + k.bump + ', too-harsh ' + k['too-harsh'];
      if (k.readings.length) line += ' | readings ' + Math.min.apply(null, k.readings).toFixed(2) + ' to ' + Math.max.apply(null, k.readings).toFixed(2);
      if (k.flaggedFalse.length) line += ' | readings rated bump or too-harsh: ' + k.flaggedFalse.join(', ');
      lines.push(line);
    });
    lines.push('');

    lines.push('RIDE-LEVEL FEEDBACK (newest first)');
    if (ratedRides.length === 0) lines.push('  (none yet)');
    ratedRides.forEach(function (ride) {
      lines.push('  ' + stamp(ride.startedAt) + ' | ' + km(ride.distanceKm) + ' | ' + duration(ride.durationSec) +
        ' | score ' + (typeof ride.driveScore === 'number' ? ride.driveScore : '--') +
        ' | smoothness ' + (metricValue(ride, 'smoothness') === null ? '--' : Math.round(metricValue(ride, 'smoothness'))) +
        ' | motion sensor ' + (ride.sensors && ride.sensors.motion ? 'yes' : 'no') +
        ' | answer: ' + (ride.feedback.verdict || 'note only') +
        (ride.feedback.note ? ' | note: "' + ride.feedback.note + '"' : ''));
    });
    lines.push('');

    lines.push('MOMENT FEEDBACK (newest first, up to 60)');
    if (rated.length === 0) lines.push('  (none yet)');
    rated.sort(function (a, b) { return b.m.at - a.m.at; }).slice(0, 60).forEach(function (x) {
      const m = x.m;
      lines.push('  ' + stamp(m.at) + ' | ' + (m.kind || m.type) +
        (typeof m.measured === 'number' ? ' | measured ' + m.measured.toFixed(2) + ' vs level ' + m.limit : '') +
        ' | answer: ' + m.feedback.verdict +
        (m.feedback.note ? ' | note: "' + m.feedback.note + '"' : ''));
    });
    lines.push('');

    if (T) {
      lines.push('CALIBRATION CHANGE LOG (newest first, up to 40)');
      if (T.log.length === 0) lines.push('  (empty)');
      T.log.slice(-40).reverse().forEach(function (entry) {
        lines.push('  ' + stamp(entry.at) + ' | ' + entry.kind + ' | ' + entry.verdict);
      });
      lines.push('');
    }

    lines.push('END OF REPORT');
    return lines.join('\n');
  }

  // Shows the report in a text box and tries to copy it for you.
  function copyReport() {
    const text = buildReport();
    els.report.value = text;
    els.report.hidden = false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { els.reportStatus.textContent = 'Report copied. Paste it into a message to Claude.'; })
        .catch(showManualCopy);
    } else {
      showManualCopy();
    }
  }

  function showManualCopy() {
    els.report.focus();
    els.report.select();
    els.reportStatus.textContent = 'Could not copy automatically. The report is selected below: press and hold it, then choose Copy.';
  }


  /* ---------- 8. DELETING ----------
     Nothing is deleted on the first tap. The button turns into a
     question with "Yes, delete" and "Keep" so a slip of the thumb is safe. */

  function actionButton(className, text, action) {
    const button = make('button', className, text);
    button.type = 'button';
    button.dataset.historyAction = action;
    return button;
  }

  function showDeleteButton(row) {
    row.replaceChildren(actionButton('danger-btn', 'Delete this ride', 'ask-delete'));
  }

  function showDeleteQuestion(row) {
    row.replaceChildren(
      make('p', 'confirm__text', 'Delete this ride for good? This cannot be undone.'),
      actionButton('danger-btn danger-btn--solid', 'Yes, delete', 'confirm-delete'),
      actionButton('ghost-btn', 'Keep', 'cancel-delete')
    );
  }

  function showClearButton() {
    els.clearRow.replaceChildren();
    if (loadRides().length > 0) {
      els.clearRow.append(actionButton('danger-btn', 'Clear all saved rides', 'ask-clear'));
    }
  }

  function showClearQuestion() {
    const count = loadRides().length;
    els.clearRow.replaceChildren(
      make('p', 'confirm__text', 'Delete all ' + count + (count === 1 ? ' saved ride' : ' saved rides') + ' for good? This cannot be undone.'),
      actionButton('danger-btn danger-btn--solid', 'Yes, delete all', 'confirm-clear'),
      actionButton('ghost-btn', 'Keep', 'cancel-clear')
    );
  }


  /* ---------- Drawing the whole view ---------- */

  function render() {
    const rides = ridesInPeriod();
    renderSummary(rides);
    renderList(rides);
    showClearButton();
    renderTuning();
  }


  /* ---------- 9. BUTTONS ---------- */

  // Period buttons
  els.periods.addEventListener('click', function (event) {
    const button = event.target.closest('[data-period]');
    if (!button) return;
    view.period = button.dataset.period;
    Array.from(els.periods.querySelectorAll('[data-period]')).forEach(function (b) {
      b.setAttribute('aria-pressed', b === button ? 'true' : 'false');
    });
    els.range.hidden = view.period !== 'custom';
    render();
  });

  els.from.addEventListener('change', render);
  els.to.addEventListener('change', render);

  // Every other history button carries a data-history-action label.
  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-history-action]');
    if (!button) return;
    const action = button.dataset.historyAction;
    const smooth = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

    if (action === 'open') {
      els.section.scrollIntoView({ behavior: smooth, block: 'start' });
      els.section.focus({ preventScroll: true });
    }
    if (action === 'to-dash') {
      window.scrollTo({ top: 0, behavior: smooth });
      if (els.dash) els.dash.focus({ preventScroll: true });
    }

    const row = button.closest('.confirm');
    if (action === 'ask-delete') showDeleteQuestion(row);
    if (action === 'cancel-delete') showDeleteButton(row);
    if (action === 'confirm-delete') deleteRide(row.dataset.rideId);

    if (action === 'feedback') giveFeedback(button.closest('.feedback'), button.dataset.verdict);

    if (action === 'copy-report') copyReport();
    if (action === 'ask-reset-tune') showResetQuestion();
    if (action === 'cancel-reset-tune') showTuningButtons();
    if (action === 'confirm-reset-tune') {
      window.DrivePulseSensors.resetTuning();
      renderTuning();
      els.reportStatus.textContent = 'Back to the factory thresholds. Your saved feedback is kept for the report.';
    }

    if (action === 'ask-clear') showClearQuestion();
    if (action === 'cancel-clear') showClearButton();
    if (action === 'confirm-clear') clearAllRides();
  });

  // Notes are saved when you finish typing and tap elsewhere.
  els.list.addEventListener('change', function (event) {
    if (event.target.classList.contains('feedback__note')) {
      saveNote(event.target.closest('.feedback'), event.target.value.trim());
    }
  });

  render();

  // The one name this file shares with the rest of the app.
  window.DrivePulseHistory = {
    saveRide: saveRide,
    countRides: function () { return loadRides().length; }
  };
})();
