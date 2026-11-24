/* =========================================================
   DrivePulse - sensors.js  (Phase 2 + moment timeline + learning)

   The only file that talks to the phone's real sensors.

     1. TUNING         - every threshold in one place (the factory settings)
     2. LEARNING       - your feedback nudges some thresholds; saved on the phone
     3. SHARED BITS    - small helpers and the status reporter
     4. GPS            - speed and distance from navigator.geolocation
     5. MOTION         - acceleration, turning and bumps from DeviceMotionEvent
     6. SCREEN AWAKE   - Screen Wake Lock, plus noticing when the app
                         goes to the background
     7. TRIP MATHS     - turns the readings into metrics AND into the
                         moment timeline (what happened, why it was flagged)
     8. RESULTS        - the numbers, highlights and moments handed to app.js
     9. START / STOP   - the functions other files are allowed to call

   GOLDEN RULE: nothing here is ever invented. If a sensor is not
   sending readings, the matching numbers stay empty (app.js shows "--")
   and a note goes to the status log.

   Other files use this one through a single object, DrivePulseSensors:
     .start({ onLog, onStatus })   begin a drive
     .read()                       latest numbers
     .stop()                       end the drive, final numbers
     .tuning()                     factory + learned thresholds (for history.js)
     .learn(vote)                  apply one piece of feedback
     .resetTuning()                back to the factory thresholds
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. TUNING ----------
     Speeds are in metres per second (m/s). 1 m/s = 3.6 km/h.
     Forces are in m/s2 (how quickly speed changes). For scale: 1 m/s2 is
     a gentle push, 2 is firm, 3 or more is a hard brake.

     DEFAULT_TUNE is the factory setting and never changes while the app
     runs. TUNE (just below it) is the working copy: it starts as a copy
     of the defaults, then section 2 adjusts a few values from your feedback.

     To bake learned numbers in for good: paste a Tuning Report to Claude,
     and the numbers in DEFAULT_TUNE get edited here on GitHub. */

  const DEFAULT_TUNE = {
    // GPS quality
    gpsMaxAccuracyM: 35,   // ignore position fixes less accurate than this
    gpsStaleSec: 6,        // no fix for this long = "signal lost"
    gpsGapSec: 10,         // a pause this long between fixes is a "gap"

    // Stopped or moving?
    stoppedBelow: 1.0,     // slower than this = standing still (3.6 km/h)
    movingAbove: 2.0,      // faster than this = pulled away (7 km/h)
    realTripSpeed: 3.0,    // a stop or launch only counts if you reached this (11 km/h)

    // Stops and launches
    stopWindowSec: 6,      // look this far back when judging a stop
    gentleStopMax: 2.0,    // peak braking under this = a gentle stop
    launchWindowSec: 5,    // judge a pull-away over its first seconds
    easyLaunchMax: 2.0,    // peak acceleration under this = an easy launch
    burstWithinSec: 25,    // pulled away and stopped again this fast = stop-and-go burst

    // Steady cruising
    cruiseMinSpeed: 5.5,   // cruising starts at 20 km/h
    cruiseBand: 1.4,       // stay within about 5 km/h of your settled pace
    steadyStretchSec: 60,  // a streak this long earns a "Long steady stretch" moment

    // Scores: "full" earns 100, "zero" earns 0, in between slides evenly
    smoothFull: 1.0,  smoothZero: 3.5,    // overall push felt in the cabin
    wobbleFull: 0.15, wobbleZero: 1.0,    // speed change per second while cruising
    cornerFull: 1.5,  cornerZero: 4.0,    // sideways push in a turn

    // Turning
    turnYawDeg: 6,         // turning faster than this (degrees per second) = in a corner
    cornerMinAngle: 30,    // a corner must turn at least this many degrees to be counted
    composedCornerMax: 2.5,// sideways push above this = a "brisk corner"

    // Speeding-up and slowing-down episodes
    slowdownStart: 0.4,    // a change stronger than this starts an episode
    slowdownMinDrop: 3.0,  // a slow-down counts if you shed at least this much speed (11 km/h)
    gradualMax: 1.5,       // peak braking under this = you eased off early

    // Sharp moments
    hardBrake: 3.0,
    hardAccel: 3.0,
    hardCorner: 4.0,

    // Road surface
    bumpJolt: 6.0,         // an up-and-down jolt above this = a rough bump
    bumpGapSec: 5,         // bumps closer together than this count as one

    // A car cannot do this. If we see it, the PHONE was moved by hand.
    impossible: 9.0,

    maxMoments: 150        // timeline entries kept per ride
  };

  const TUNE = Object.assign({}, DEFAULT_TUNE);


  /* ---------- 2. LEARNING ----------
     When you rate a moment "Rough road / bump" or "Too harsh" in Trip
     History, the threshold that flagged it is raised a little, so the
     same thing is less likely to be flagged next time.

     How much: each "Too harsh" is 1 step, each "Rough road / bump
     (false alarm)" is 2 steps. One step = 4% of the factory value.
     A threshold can never go more than 10 steps (40%) above factory,
     so the app cannot be taught to ignore everything.

     Only the step counts are saved (in the phone's localStorage). The
     working numbers are always re-made from DEFAULT_TUNE + steps. */

  const PROFILE_KEY = 'drivepulse.tune.v1';
  const LEARN_STEP = 0.04;
  const MAX_STEPS = 10;
  const STEPS_FOR_VERDICT = { 'bump': 2, 'too-harsh': 1 };

  // The thresholds feedback is allowed to change, with plain names.
  const LEARNABLE = {
    hardBrake:         'Hard brake flag level',
    gentleStopMax:     'Gentle stop limit',
    hardAccel:         'Hard acceleration flag level',
    easyLaunchMax:     'Easy launch limit',
    hardCorner:        'Sharp turn flag level',
    composedCornerMax: 'Brisk corner flag level',
    bumpJolt:          'Rough bump flag level',
    smoothFull:        'Smoothness: push that still scores 100',
    smoothZero:        'Smoothness: push that scores 0',
    wobbleZero:        'Speed consistency: wobble that scores 0',
    cornerZero:        'Cornering poise: push that scores 0'
  };

  // Which threshold(s) each kind of moment is tied to.
  // The two "ride:" lines are for feedback on a whole ride.
  const KEYS_FOR = {
    'hard-brake':     ['hardBrake'],
    'firm-stop':      ['gentleStopMax'],
    'hard-accel':     ['hardAccel'],
    'quick-launch':   ['easyLaunchMax'],
    'sharp-turn':     ['hardCorner'],
    'brisk-corner':   ['composedCornerMax'],
    'rough-bump':     ['bumpJolt'],
    'ride:bump':      ['smoothFull', 'smoothZero'],
    'ride:too-harsh': ['smoothZero', 'wobbleZero', 'cornerZero']
  };

  let profile = loadProfile();
  applyProfile();

  function emptyProfile() {
    return { version: 1, steps: {}, log: [], resetAt: 0, updatedAt: 0 };
  }

  function loadProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY));
      if (saved && typeof saved.steps === 'object' && Array.isArray(saved.log)) return saved;
    } catch (error) { /* storage blocked or empty: fall through */ }
    return emptyProfile();
  }

  function saveProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      return true;
    } catch (error) {
      return false;
    }
  }

  // Re-makes the working numbers: factory value x (1 + 4% per step).
  function applyProfile() {
    Object.keys(LEARNABLE).forEach(function (key) {
      const steps = clamp(profile.steps[key] || 0, 0, MAX_STEPS);
      TUNE[key] = Math.round(DEFAULT_TUNE[key] * (1 + LEARN_STEP * steps) * 100) / 100;
    });
  }

  function keysFor(kind, verdict) {
    return KEYS_FOR[kind === 'ride' ? 'ride:' + verdict : kind] || [];
  }

  function addSteps(kind, verdict, direction) {
    const size = STEPS_FOR_VERDICT[verdict] || 0;
    if (!size) return;
    keysFor(kind, verdict).forEach(function (key) {
      profile.steps[key] = clamp((profile.steps[key] || 0) + direction * size, 0, MAX_STEPS);
    });
  }

  /* Applies one piece of feedback. history.js calls this with:
       kind            the moment's kind ('hard-brake'...) or 'ride'
       verdict         'spot-on', 'bump', 'too-harsh', 'missed', or null to clear
       previousVerdict what this same moment was rated before (if anything)
       previousAt      when that earlier rating was given
     If you change your mind, the earlier nudge is undone first.
     Returns the list of thresholds that changed, for showing on screen. */
  function learn(vote) {
    const before = {};
    Object.keys(LEARNABLE).forEach(function (key) { before[key] = TUNE[key]; });

    if (vote.previousVerdict && (vote.previousAt || 0) > profile.resetAt) {
      addSteps(vote.kind, vote.previousVerdict, -1);
    }
    if (vote.verdict) addSteps(vote.kind, vote.verdict, +1);

    profile.log.push({
      at: Date.now(),
      rideId: vote.rideId || null,
      momentId: vote.momentId || null,
      kind: vote.kind,
      verdict: vote.verdict || 'cleared',
      measured: typeof vote.measured === 'number' ? vote.measured : null,
      limit: typeof vote.limit === 'number' ? vote.limit : null,
      note: vote.note || ''
    });
    if (profile.log.length > 300) profile.log = profile.log.slice(-300);
    profile.updatedAt = Date.now();

    applyProfile();
    const saved = saveProfile();

    const changes = [];
    Object.keys(LEARNABLE).forEach(function (key) {
      if (TUNE[key] !== before[key]) changes.push({ key: key, label: LEARNABLE[key], from: before[key], to: TUNE[key] });
    });
    return { changes: changes, saved: saved };
  }

  function resetTuning() {
    profile.steps = {};
    profile.resetAt = Date.now();
    profile.updatedAt = Date.now();
    profile.log.push({ at: Date.now(), kind: 'reset', verdict: 'reset' });
    applyProfile();
    saveProfile();
  }

  // Everything history.js needs to show the calibration and build the report.
  function tuning() {
    const rows = Object.keys(LEARNABLE).map(function (key) {
      return {
        key: key,
        label: LEARNABLE[key],
        factory: DEFAULT_TUNE[key],
        current: TUNE[key],
        steps: clamp(profile.steps[key] || 0, 0, MAX_STEPS)
      };
    });
    return {
      rows: rows,
      changed: rows.filter(function (row) { return row.steps > 0; }).length,
      stepPercent: LEARN_STEP * 100,
      maxPercent: LEARN_STEP * MAX_STEPS * 100,
      log: profile.log.slice(),
      resetAt: profile.resetAt,
      updatedAt: profile.updatedAt
    };
  }

  function learnedValues() {
    const values = {};
    Object.keys(LEARNABLE).forEach(function (key) { values[key] = TUNE[key]; });
    return values;
  }


  /* ---------- 3. SHARED BITS ---------- */

  let active = false;                       // is a drive being measured right now?
  let callbacks = { onLog: function () {}, onStatus: function () {} };
  let flags = {};                           // "already said this once" notes
  let trip = newTrip();                     // everything measured this drive

  // What each sensor is doing, shown as the three status chips on the dash.
  // state is one of: idle, waiting, live, weak, off
  const status = {
    gps:    { state: 'idle', text: 'off' },
    motion: { state: 'idle', text: 'off' },
    wake:   { state: 'idle', text: 'normal' }
  };

  function say(message, type) {
    callbacks.onLog(message, type || 'info');
  }

  function setStatus(name, state, text) {
    status[name] = { state: state, text: text };
    callbacks.onStatus(name, state, text);
  }

  function clamp(number, low, high) {
    return Math.min(high, Math.max(low, number));
  }

  // Turns a measurement into a 0-100 grade. At or below "full" = 100,
  // at or above "zero" = 0, and it slides evenly in between.
  function grade(value, full, zero) {
    return clamp((zero - value) / (zero - full), 0, 1) * 100;
  }

  // 95 seconds -> "1:35"
  function clock(totalSeconds) {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const secs = seconds % 60;
    return Math.floor(seconds / 60) + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function kmh(metresPerSecond) {
    return Math.round(metresPerSecond * 3.6);
  }

  // 3.456 -> "3.5"
  function one(number) {
    return number.toFixed(1);
  }

  function timeOfDay(ms) {
    const d = new Date(ms);
    return d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  // Distance in metres between two GPS points (the "haversine" formula).
  function distanceBetween(a, b) {
    const R = 6371000;                       // Earth's radius in metres
    const toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad;
    const dLon = (b.lon - a.lon) * toRad;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Smallest difference between two compass headings, in degrees (0-180).
  function headingChange(a, b) {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }


  /* ---------- 4. GPS ----------
     watchPosition asks the phone to call onPosition every time it has a
     new position (about once a second while driving). */

  let watchId = null;
  let lastFixWallTime = 0;          // when the last fix arrived, by the phone's clock
  const lastGpsErrorAt = {};        // stops the same error flooding the log

  function startGps() {
    if (!('geolocation' in navigator)) {
      setStatus('gps', 'off', 'not available');
      say('This browser has no GPS support, so speed, distance and scores cannot be measured.', 'alert');
      return;
    }
    setStatus('gps', 'waiting', 'searching');
    say('Asking for GPS. Tap "Allow" if Chrome asks for your location.', 'info');
    watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, {
      enableHighAccuracy: true,     // use real GPS, not just Wi-Fi guesses
      maximumAge: 0,                // never reuse an old position
      timeout: 30000
    });
  }

  function stopGps() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  function onPosition(position) {
    if (!active) return;
    const c = position.coords;
    lastFixWallTime = Date.now();

    // A vague fix would give jumpy speeds, so wait for a sharper one.
    if (typeof c.accuracy === 'number' && c.accuracy > TUNE.gpsMaxAccuracyM) {
      setStatus('gps', 'weak', 'weak signal');
      if (!flags.weakGpsLogged) {
        flags.weakGpsLogged = true;
        say('GPS signal is weak (only accurate to about ' + Math.round(c.accuracy) + ' m). Waiting for a sharper fix before measuring.', 'warn');
      }
      return;
    }

    if (status.gps.state !== 'live') {
      say(flags.gpsEverLive ? 'GPS signal is back.' : 'GPS locked on, accurate to about ' + Math.round(c.accuracy) + ' m.', 'good');
      flags.gpsEverLive = true;
      setStatus('gps', 'live', 'live');
    }

    feedTrip({
      t: isFinite(position.timestamp) ? position.timestamp : Date.now(),
      lat: c.latitude,
      lon: c.longitude,
      // Some devices do not report speed or heading. null means "not given".
      speed: (typeof c.speed === 'number' && isFinite(c.speed) && c.speed >= 0) ? c.speed : null,
      heading: (typeof c.heading === 'number' && isFinite(c.heading)) ? c.heading : null
    });
  }

  function onGpsError(error) {
    if (!active) return;
    const now = Date.now();
    if (lastGpsErrorAt[error.code] && now - lastGpsErrorAt[error.code] < 30000) return;
    lastGpsErrorAt[error.code] = now;

    if (error.code === 1) {            // permission denied
      stopGps();
      setStatus('gps', 'off', 'blocked');
      say('Location permission was denied, so no speed, distance or scores can be measured. To fix it: tap the icon at the left of Chrome\'s address bar, open Permissions, allow Location, then start a new drive.', 'alert');
    } else if (error.code === 2) {     // position unavailable
      if (status.gps.state !== 'live') setStatus('gps', 'waiting', 'no position');
      say('GPS cannot find a position right now. Is Location switched on in the phone\'s settings? Still trying.', 'warn');
    } else {                           // timed out
      if (status.gps.state !== 'live') setStatus('gps', 'waiting', 'searching');
      say('Still waiting for a first GPS fix. Open sky helps; indoors it may never arrive.', 'warn');
    }
  }

  // Called once a second (through read) to notice a signal that went quiet.
  function checkGpsHeartbeat() {
    if (!active || status.gps.state !== 'live') return;
    if (Date.now() - lastFixWallTime > TUNE.gpsStaleSec * 1000) {
      setStatus('gps', 'waiting', 'signal lost');
      trip.speed = null;
      say('GPS signal lost (tunnel, or tall buildings?). Measuring pauses until it returns.', 'warn');
    }
  }


  /* ---------- 5. MOTION ----------
     The phone's motion sensor fires many times a second. We boil that
     down to three things, in a way that works however the phone is lying:
       - the sideways-and-forwards push (how the driving felt)
       - how fast the car is turning (rotation around the up-down line)
       - the up-and-down jolt (the road surface: bumps and potholes) */

  let motionListening = false;
  let motionCheckTimer = null;
  let gravity = null;                       // which way is "down" for the phone
  let pushSmooth = { x: 0, y: 0, z: 0 };    // smoothed horizontal push
  let joltSmooth = 0;                       // lightly smoothed up-down jolt
  let lastMotionAt = 0;
  let bucket = newBucket();                 // readings collected since the last GPS fix

  function newBucket() {
    return { count: 0, pushSum: 0, pushPeak: 0, joltPeak: 0, yawCount: 0, yawSum: 0, yawPeak: 0 };
  }

  function startMotion() {
    if (typeof DeviceMotionEvent === 'undefined') {
      setStatus('motion', 'off', 'not available');
      say('This device has no motion sensor support. Scores will rely on GPS alone, and bumps cannot be detected.', 'warn');
      return;
    }
    setStatus('motion', 'waiting', 'checking');

    // iPhones make us ask permission, and only directly inside a button tap.
    // Android Chrome has no such step, so we check that it exists first.
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(function (answer) {
          if (!active) return;
          if (answer === 'granted') {
            listenToMotion();
          } else {
            setStatus('motion', 'off', 'blocked');
            say('Motion permission was denied. Scores will rely on GPS alone.', 'warn');
          }
        })
        .catch(function () {
          if (!active) return;
          setStatus('motion', 'off', 'blocked');
          say('Motion permission could not be requested. Scores will rely on GPS alone.', 'warn');
        });
    } else {
      listenToMotion();
    }
  }

  function listenToMotion() {
    window.addEventListener('devicemotion', onMotion);
    motionListening = true;
    // Laptops and desktops usually stay silent. Say so instead of waiting forever.
    motionCheckTimer = setTimeout(function () {
      if (active && !flags.motionEverLive) {
        setStatus('motion', 'off', 'no readings');
        say('No motion sensor readings (normal on laptops and desktops). Scores will rely on GPS alone, and bumps cannot be detected.', 'warn');
      }
    }, 3000);
  }

  function stopMotion() {
    if (motionListening) window.removeEventListener('devicemotion', onMotion);
    motionListening = false;
    clearTimeout(motionCheckTimer);
  }

  function hasXYZ(v) {
    return v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
  }

  function onMotion(event) {
    if (!active) return;
    const lin = event.acceleration;                     // push without gravity (may be missing)
    const withG = event.accelerationIncludingGravity;   // push with gravity
    const haveLin = hasXYZ(lin);
    const haveG = hasXYZ(withG);
    if (!haveLin && !haveG) return;                     // an empty event: ignore it

    if (!flags.motionEverLive) {
      flags.motionEverLive = true;
      setStatus('motion', 'live', 'live');
      say('Motion sensor is sending readings.', 'good');
    }

    const now = Date.now();
    const dt = clamp((now - lastMotionAt) / 1000, 0.005, 0.2);
    lastMotionAt = now;

    // Step 1: work out the push without gravity, and which way is "down".
    let push;
    if (haveLin && haveG) {
      gravity = { x: withG.x - lin.x, y: withG.y - lin.y, z: withG.z - lin.z };
      push = lin;
    } else if (haveG) {
      // No gravity-free reading: estimate gravity as the slow-moving average.
      if (!gravity) gravity = { x: withG.x, y: withG.y, z: withG.z };
      gravity.x += 0.02 * (withG.x - gravity.x);
      gravity.y += 0.02 * (withG.y - gravity.y);
      gravity.z += 0.02 * (withG.z - gravity.z);
      push = { x: withG.x - gravity.x, y: withG.y - gravity.y, z: withG.z - gravity.z };
    } else {
      push = lin;
    }

    // Step 2: split the push into its up-down part (road bumps) and the
    // horizontal part (driving).
    let down = null;
    if (gravity) {
      const size = Math.sqrt(gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z);
      if (size > 5) down = { x: gravity.x / size, y: gravity.y / size, z: gravity.z / size };
    }
    let flat = push;
    if (down) {
      const upDown = push.x * down.x + push.y * down.y + push.z * down.z;
      flat = { x: push.x - upDown * down.x, y: push.y - upDown * down.y, z: push.z - upDown * down.z };

      // The jolt is smoothed over a few hundredths of a second, so one
      // glitchy reading is ignored but a real pothole thump is kept.
      joltSmooth += (1 - Math.exp(-dt / 0.04)) * (upDown - joltSmooth);
      if (Math.abs(joltSmooth) > bucket.joltPeak) bucket.joltPeak = Math.abs(joltSmooth);
    }

    // Step 3: smooth the driving push over about half a second so rattles
    // do not count as driving.
    const blend = 1 - Math.exp(-dt / 0.5);
    pushSmooth.x += blend * (flat.x - pushSmooth.x);
    pushSmooth.y += blend * (flat.y - pushSmooth.y);
    pushSmooth.z += blend * (flat.z - pushSmooth.z);
    const pushSize = Math.sqrt(pushSmooth.x * pushSmooth.x + pushSmooth.y * pushSmooth.y + pushSmooth.z * pushSmooth.z);

    bucket.count += 1;
    bucket.pushSum += pushSize;
    if (pushSize > bucket.pushPeak) bucket.pushPeak = pushSize;

    // Step 4: turning speed around the up-down line, in degrees per second.
    // rotationRate.beta is around the phone's x side, gamma around y, alpha around z.
    const spin = event.rotationRate;
    if (down && spin && typeof spin.alpha === 'number' && typeof spin.beta === 'number' && typeof spin.gamma === 'number') {
      const yaw = spin.beta * down.x + spin.gamma * down.y + spin.alpha * down.z;
      bucket.yawCount += 1;
      bucket.yawSum += yaw;
      if (Math.abs(yaw) > bucket.yawPeak) bucket.yawPeak = Math.abs(yaw);
    }
  }

  // Hands over what the motion sensor saw since the last GPS fix, then starts fresh.
  function emptyBucket() {
    const b = bucket;
    bucket = newBucket();
    return {
      live: b.count > 0,
      push: b.count > 0 ? b.pushSum / b.count : 0,
      jolt: b.joltPeak,
      hasYaw: b.yawCount > 0,
      yawDeg: b.yawCount > 0 ? Math.abs(b.yawSum / b.yawCount) : 0
    };
  }


  /* ---------- 6. SCREEN AWAKE ----------
     A wake lock asks Android not to dim or lock the screen. Android
     takes the lock away whenever the page is hidden, so we ask again
     each time the page comes back. */

  let wakeLock = null;
  let hiddenAt = 0;

  function requestWakeLock() {
    if (wakeLock) return;                     // already holding one
    if (!('wakeLock' in navigator)) {
      setStatus('wake', 'off', 'may sleep');
      if (!flags.noWakeLockLogged) {
        flags.noWakeLockLogged = true;
        say('This browser cannot keep the screen awake. Set a long screen timeout in the phone\'s settings, or tap the screen now and then.', 'warn');
      }
      return;
    }
    navigator.wakeLock.request('screen')
      .then(function (lock) {
        if (!active) { lock.release(); return; }
        wakeLock = lock;
        setStatus('wake', 'live', 'stays on');
        say('Screen will stay awake during this drive.', 'good');
        lock.addEventListener('release', function () {
          if (wakeLock !== lock) return;      // we let go of it ourselves (drive stopped)
          wakeLock = null;
          if (active) {
            setStatus('wake', 'off', 'may sleep');
            // If the page is hidden, onVisibilityChange already explained why.
            if (document.visibilityState === 'visible') {
              say('The screen wake lock was released by the phone. The screen may dim.', 'warn');
            }
          }
        });
      })
      .catch(function () {
        if (!active) return;
        setStatus('wake', 'off', 'may sleep');
        say('Could not keep the screen awake (battery saver can block this). The screen may time out mid-drive.', 'warn');
      });
  }

  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;                          // forget it first, so the 'release' note stays quiet
    if (lock) lock.release().catch(function () {});
  }

  function onVisibilityChange() {
    if (!active) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      trip.interruptions += 1;
      say('Screen locked or app in the background. Android pauses GPS and motion here, so this stretch is NOT being measured.', 'alert');
    } else {
      if (hiddenAt) {
        const away = (Date.now() - hiddenAt) / 1000;
        trip.hiddenSec += away;
        hiddenAt = 0;
        say('Back on screen after ' + clock(away) + '. That stretch was not measured. Asking to keep the screen awake again.', 'warn');
      }
      requestWakeLock();
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange);


  /* ---------- 7. TRIP MATHS ----------
     feedTrip runs once per GPS fix (about once a second). Each fix tells
     us the speed; comparing it with the fix before tells us how hard the
     car sped up or slowed down. The motion bucket adds how the cabin felt.

     Besides the running totals, this section writes the MOMENT TIMELINE:
     one entry each time something noteworthy finishes, saying what
     happened, why the sensors flagged it, and a short tip. */

  function newTrip() {
    return {
      lastFix: null,        // the previous GPS fix
      anchor: null,         // last point that counted towards distance
      speed: null,          // current speed in m/s (null = unknown)
      accel: 0,             // current speeding-up (+) or slowing-down (-)
      recent: [],           // the last few seconds, for judging stops

      distanceM: 0, trackedSec: 0, movingSec: 0, topSpeed: 0,

      smoothSum: 0, smoothSec: 0,          // Smoothness
      wobbleSum: 0, wobbleSec: 0,          // Speed consistency

      isStopped: null,                     // null = not known yet
      topSinceLaunch: 0,
      launchedAt: null, launchOpen: false, launchPeak: 0,
      stops: 0, gentleStops: 0,            // Gentle stop ratio
      launches: 0, easyLaunches: 0,        // Easy launch ratio
      bursts: 0,                           // Stop-and-go bursts

      cruiseSec: 0, cruisePace: 0, cruiseStartT: 0,   // the streak happening now
      cruiseBest: 0, cruiseBestPace: 0,               // Steady cruise streak

      cornerSum: 0, cornerSec: 0,          // Cornering poise
      turning: false, turnStartT: 0, turnSec: 0, turnAngle: 0,
      turnPeak: 0, turnYawPeak: 0, turnSpeedSum: 0,
      corners: 0, composedCorners: 0,

      calmSec: 0, calmBest: 0,             // Calm streak

      slowing: null,                       // a slow-down episode in progress
      surging: null,                       // a speed-up episode in progress
      slowdowns: 0, gradualSlowdowns: 0,   // Anticipation

      moments: [],                         // the moment timeline
      bumps: 0, lastBumpAt: 0,

      gpsGaps: 0, interruptions: 0, hiddenSec: 0
    };
  }

  /* One timeline entry. Every moment carries:
       kind   - what sort of moment ('hard-brake', 'brisk-corner'...)
       level  - 'sharp' (counts as a sharp moment), 'firm' (explains a
                lower ratio), 'road' (the surface, not you), 'good' (praise)
       label  - short title          at - when it started
       what   - what happened        why - what the sensors measured
       tip    - one driving tip
       tuneKey, measured, limit - which threshold flagged it, the reading,
                and the threshold at the time (used by the learning) */
  function addMoment(T, moment) {
    if (T.moments.length >= TUNE.maxMoments) return;
    moment.id = 'm' + (T.moments.length + 1);
    T.moments.push(moment);
    if (moment.level === 'sharp') T.calmSec = 0;       // calm streak restarts

    const logType = { sharp: 'alert', firm: 'warn', road: 'info', good: 'good' }[moment.level] || 'info';
    say(moment.label + ': ' + moment.what + ' ' + moment.why, logType);
  }

  // After a pause in the readings we must not compare "before" with "after".
  function forgetShortMemory(T) {
    endTurn(T);
    endCruise(T);
    T.accel = 0;
    T.recent = [];
    T.slowing = null;
    T.surging = null;
    T.launchOpen = false;
    T.isStopped = null;
  }

  function feedTrip(fix) {
    const T = trip;
    const prev = T.lastFix;

    // The very first fix: nothing to compare with yet.
    if (!prev) {
      T.lastFix = fix; T.anchor = fix; T.speed = fix.speed;
      emptyBucket();
      return;
    }

    const dt = (fix.t - prev.t) / 1000;      // seconds since the previous fix
    if (dt < 0.2) return;                    // a duplicate
    const hop = distanceBetween(prev, fix);

    // A long pause (weak signal, or the screen was off): bridge it honestly.
    if (dt > TUNE.gpsGapSec) {
      T.gpsGaps += 1;
      if (hop > 30) T.distanceM += hop;
      say('GPS readings paused for ' + clock(dt) + '. Distance across that pause is a straight-line estimate, and no scores were taken.', 'warn');
      forgetShortMemory(T);
      T.lastFix = fix; T.anchor = fix; T.speed = fix.speed;
      emptyBucket();
      return;
    }

    // If the phone did not report a speed, work it out from distance and time.
    if (fix.speed === null) fix.speed = hop / dt;
    const speed = fix.speed;

    // How hard are we speeding up or slowing down? Lightly smoothed.
    const rawAccel = prev.speed === null ? 0 : (speed - prev.speed) / dt;
    T.accel = 0.6 * rawAccel + 0.4 * T.accel;
    const accel = T.accel;
    const cabin = emptyBucket();             // what the motion sensor felt

    T.speed = speed;
    T.lastFix = fix;
    T.trackedSec += dt;
    T.recent.push({ t: fix.t, accel: accel, speed: speed });
    while (T.recent.length && fix.t - T.recent[0].t > 8000) T.recent.shift();

    // Distance only grows while moving, so GPS jitter at a red light adds nothing.
    const moving = speed >= TUNE.stoppedBelow;
    if (moving) {
      T.movingSec += dt;
      T.distanceM += distanceBetween(T.anchor, fix);
      T.anchor = fix;
      if (speed > T.topSpeed) T.topSpeed = speed;
    }

    // Did someone pick the phone up? Then the motion readings mean nothing.
    const phoneMoved = cabin.live && cabin.push > TUNE.impossible;
    if (phoneMoved && !flags.phoneMovedLogged) {
      flags.phoneMovedLogged = true;
      say('The phone seems to have been moved by hand. Those moments are left out of the scores.', 'warn');
    }

    // A rough bump: a strong up-and-down jolt while really driving.
    const bumped = cabin.live && !phoneMoved && speed >= TUNE.realTripSpeed && cabin.jolt >= TUNE.bumpJolt;
    if (bumped) noteBump(T, fix, speed, cabin.jolt);

    trackSmoothness(T, speed, accel, cabin, phoneMoved || bumped, moving, dt);
    trackStopsAndLaunches(T, fix, speed, accel);
    trackCruise(T, fix, speed, dt);
    trackCorners(T, prev, fix, speed, cabin, phoneMoved, dt);
    trackSlowdowns(T, prev, fix, speed, accel, dt);
    trackSpeedUps(T, prev, fix, speed, accel, dt);

    // Calm streak: time rolling along without a sharp moment.
    if (T.movingSec > 0) {
      T.calmSec += dt;
      if (T.calmSec > T.calmBest) T.calmBest = T.calmSec;
    }
  }

  // Rough bump moment (the road, not the driver)
  function noteBump(T, fix, speed, jolt) {
    if (fix.t - T.lastBumpAt < TUNE.bumpGapSec * 1000) return;   // same bump, already noted
    T.lastBumpAt = fix.t;
    T.bumps += 1;
    addMoment(T, {
      kind: 'rough-bump', level: 'road', label: 'Rough bump', at: fix.t, durationSec: null,
      what: 'A sharp up-and-down jolt at about ' + kmh(speed) + ' km/h.',
      why: 'The up-down jolt peaked at ' + one(jolt) + ' m/s2 (bump flag level: ' + one(TUNE.bumpJolt) + '). That second is left out of your Smoothness score.',
      tip: 'This is the road, not your driving. For a speed bump or pothole you can see coming, slow to a crawl before it and roll over without braking on it.',
      tuneKey: 'bumpJolt', measured: jolt, limit: TUNE.bumpJolt
    });
  }

  // Smoothness + Speed consistency
  function trackSmoothness(T, speed, accel, cabin, skipThisSecond, moving, dt) {
    if (moving && !skipThisSecond) {
      // Prefer what the cabin felt (motion sensor). Fall back to GPS speed changes.
      const pushFelt = cabin.live ? cabin.push : Math.abs(accel);
      T.smoothSum += grade(pushFelt, TUNE.smoothFull, TUNE.smoothZero) * dt;
      T.smoothSec += dt;
    }
    if (speed >= TUNE.cruiseMinSpeed) {
      T.wobbleSum += grade(Math.abs(accel), TUNE.wobbleFull, TUNE.wobbleZero) * dt;
      T.wobbleSec += dt;
    }
  }

  // Gentle stop ratio + Easy launch ratio + Stop-and-go bursts
  function trackStopsAndLaunches(T, fix, speed, accel) {
    if (T.isStopped === null) {                       // first time: just note the state
      T.isStopped = speed < TUNE.movingAbove;
      T.topSinceLaunch = speed;
      T.launchedAt = null;
      return;
    }

    if (T.isStopped) {
      if (speed > TUNE.movingAbove) {                 // pulled away
        T.isStopped = false;
        T.launchedAt = fix.t;
        T.launchOpen = true;
        T.topSinceLaunch = speed;
        T.launchPeak = 0;
        T.recent.forEach(function (r) {               // include the first push off the line
          if (fix.t - r.t <= 3000 && r.accel > T.launchPeak) T.launchPeak = r.accel;
        });
      }
      return;
    }

    // Rolling along
    if (speed > T.topSinceLaunch) T.topSinceLaunch = speed;
    if (T.launchOpen) {
      if (accel > T.launchPeak) T.launchPeak = accel;
      if ((fix.t - T.launchedAt) / 1000 >= TUNE.launchWindowSec) closeLaunch(T);
    }

    if (speed < TUNE.stoppedBelow) {                  // came to a stop
      closeLaunch(T);
      if (T.topSinceLaunch >= TUNE.realTripSpeed) {   // ignore creeping in a queue
        let peakBraking = 0;
        let fromSpeed = speed;
        T.recent.forEach(function (r) {
          if (fix.t - r.t <= TUNE.stopWindowSec * 1000) {
            if (-r.accel > peakBraking) peakBraking = -r.accel;
            if (r.speed > fromSpeed) fromSpeed = r.speed;
          }
        });
        T.stops += 1;
        if (peakBraking <= TUNE.gentleStopMax) {
          T.gentleStops += 1;
        } else if (peakBraking < TUNE.hardBrake) {    // a hard brake gets its own moment instead
          addMoment(T, {
            kind: 'firm-stop', level: 'firm', label: 'Firm stop', at: fix.t, durationSec: null,
            what: 'Came to a stop from about ' + kmh(fromSpeed) + ' km/h with firm braking near the end.',
            why: 'Braking peaked at ' + one(peakBraking) + ' m/s2 in the last ' + TUNE.stopWindowSec + ' seconds (a gentle stop stays under ' + one(TUNE.gentleStopMax) + ').',
            tip: 'Start slowing a little earlier, then ease some pressure off the pedal just before the car comes to rest.',
            tuneKey: 'gentleStopMax', measured: peakBraking, limit: TUNE.gentleStopMax
          });
        }
        if (T.launchedAt !== null && (fix.t - T.launchedAt) / 1000 <= TUNE.burstWithinSec) T.bursts += 1;
      }
      T.isStopped = true;
    }
  }

  function closeLaunch(T) {
    if (!T.launchOpen) return;
    T.launchOpen = false;
    if (T.topSinceLaunch < TUNE.realTripSpeed) return;   // never really got going
    T.launches += 1;
    if (T.launchPeak <= TUNE.easyLaunchMax) {
      T.easyLaunches += 1;
    } else if (T.launchPeak < TUNE.hardAccel) {          // a hard acceleration gets its own moment
      addMoment(T, {
        kind: 'quick-launch', level: 'firm', label: 'Quick launch', at: T.launchedAt, durationSec: TUNE.launchWindowSec,
        what: 'Pulled away briskly, reaching about ' + kmh(T.topSinceLaunch) + ' km/h in the first seconds.',
        why: 'Acceleration peaked at ' + one(T.launchPeak) + ' m/s2 (an easy launch stays under ' + one(TUNE.easyLaunchMax) + ').',
        tip: 'Squeeze the pedal on gradually. You reach the same speed a second later with less fuel and more grip in hand.',
        tuneKey: 'easyLaunchMax', measured: T.launchPeak, limit: TUNE.easyLaunchMax
      });
    }
  }

  // Steady cruise streak (+ the "Long steady stretch" moment)
  function trackCruise(T, fix, speed, dt) {
    const fastEnough = speed >= TUNE.cruiseMinSpeed;
    const onPace = T.cruiseSec === 0 || Math.abs(speed - T.cruisePace) <= TUNE.cruiseBand;

    if (fastEnough && onPace) {
      if (T.cruiseSec === 0) T.cruiseStartT = fix.t;
      // cruisePace is the average speed of this streak so far
      T.cruisePace = T.cruiseSec === 0 ? speed : (T.cruisePace * T.cruiseSec + speed * dt) / (T.cruiseSec + dt);
      T.cruiseSec += dt;
      if (T.cruiseSec > T.cruiseBest) { T.cruiseBest = T.cruiseSec; T.cruiseBestPace = T.cruisePace; }
    } else {
      endCruise(T);                 // the streak is over: maybe note it
      if (fastEnough) {             // pace changed: a new streak starts here
        T.cruisePace = speed;
        T.cruiseSec = dt;
        T.cruiseStartT = fix.t;
      }
    }
  }

  function endCruise(T) {
    if (T.cruiseSec >= TUNE.steadyStretchSec) {
      addMoment(T, {
        kind: 'steady-stretch', level: 'good', label: 'Long steady stretch', at: T.cruiseStartT, durationSec: Math.round(T.cruiseSec),
        what: 'Held about ' + kmh(T.cruisePace) + ' km/h for ' + clock(T.cruiseSec) + '.',
        why: 'Speed stayed within about ' + kmh(TUNE.cruiseBand) + ' km/h of that pace the whole time.',
        tip: 'This is the car at its most efficient and you at your most predictable. Keep looking far ahead to protect it.',
        tuneKey: null, measured: T.cruiseSec, limit: TUNE.steadyStretchSec
      });
    }
    T.cruiseSec = 0;
  }

  // Cornering poise (+ brisk corner and sharp turn moments)
  function trackCorners(T, prev, fix, speed, cabin, phoneMoved, dt) {
    // How fast is the car turning? Best source: the motion sensor's gyroscope.
    // Fallback: how much the GPS compass heading changed.
    let yawDeg = null;
    if (cabin.hasYaw && !phoneMoved) {
      yawDeg = cabin.yawDeg;
    } else if (!cabin.hasYaw && prev.heading !== null && fix.heading !== null && prev.speed !== null && prev.speed >= TUNE.realTripSpeed) {
      yawDeg = headingChange(fix.heading, prev.heading) / dt;
    }

    const inTurn = yawDeg !== null && speed >= TUNE.realTripSpeed && yawDeg >= TUNE.turnYawDeg;
    if (!inTurn) { endTurn(T); return; }

    // Sideways push = speed x turning rate (turning rate in radians per second).
    const sideways = speed * yawDeg * Math.PI / 180;
    if (sideways > TUNE.impossible) { endTurn(T); return; }   // not a car: phone was handled

    T.cornerSum += grade(sideways, TUNE.cornerFull, TUNE.cornerZero) * dt;
    T.cornerSec += dt;

    if (!T.turning) { T.turning = true; T.turnStartT = prev.t; }
    T.turnSec += dt;
    T.turnAngle += yawDeg * dt;
    T.turnSpeedSum += speed * dt;
    if (sideways > T.turnPeak) T.turnPeak = sideways;
    if (yawDeg > T.turnYawPeak) T.turnYawPeak = yawDeg;
  }

  function endTurn(T) {
    if (T.turning) {
      const isCorner = T.turnAngle >= TUNE.cornerMinAngle;
      if (isCorner) {
        T.corners += 1;
        if (T.turnPeak <= TUNE.composedCornerMax) T.composedCorners += 1;
      }

      const sharp = T.turnPeak >= TUNE.hardCorner;
      const brisk = !sharp && isCorner && T.turnPeak > TUNE.composedCornerMax;
      if (sharp || brisk) {
        addMoment(T, {
          kind: sharp ? 'sharp-turn' : 'brisk-corner',
          level: sharp ? 'sharp' : 'firm',
          label: sharp ? 'Sharp turn' : 'Brisk corner',
          at: T.turnStartT, durationSec: Math.round(T.turnSec),
          what: 'Turned about ' + Math.round(T.turnAngle) + ' degrees in ' + Math.round(T.turnSec) + ' s at around ' + kmh(T.turnSpeedSum / T.turnSec) + ' km/h.',
          why: 'Sideways push peaked at ' + one(T.turnPeak) + ' m/s2, turning at up to ' + Math.round(T.turnYawPeak) + ' degrees per second (' +
               (sharp ? 'sharp-turn flag level: ' + one(TUNE.hardCorner) : 'a composed corner stays under ' + one(TUNE.composedCornerMax)) + ').',
          tip: 'Finish slowing down before the bend while the wheels are straight, then steer through in one smooth sweep.',
          tuneKey: sharp ? 'hardCorner' : 'composedCornerMax', measured: T.turnPeak, limit: sharp ? TUNE.hardCorner : TUNE.composedCornerMax
        });
      }
    }
    T.turning = false; T.turnSec = 0; T.turnAngle = 0;
    T.turnPeak = 0; T.turnYawPeak = 0; T.turnSpeedSum = 0;
  }

  // Slow-down episodes: Anticipation (+ the hard brake moment)
  function trackSlowdowns(T, prev, fix, speed, accel, dt) {
    if (!T.slowing) {
      if (accel <= -TUNE.slowdownStart && prev.speed !== null) {
        T.slowing = { startT: prev.t, fromSpeed: prev.speed, peak: -accel, quietSec: 0, endT: fix.t, endSpeed: speed };
      }
      return;
    }
    const s = T.slowing;
    if (-accel > s.peak) s.peak = -accel;
    if (accel > -0.15) {
      s.quietSec += dt;                        // braking has eased off
    } else {
      s.quietSec = 0; s.endT = fix.t; s.endSpeed = speed;
    }
    const stopped = speed < TUNE.stoppedBelow;
    if (stopped) { s.endT = fix.t; s.endSpeed = speed; }
    if (s.quietSec >= 2 || stopped) finishSlowdown(T);
  }

  function finishSlowdown(T) {
    const s = T.slowing;
    if (!s) return;
    T.slowing = null;

    if (s.fromSpeed - s.endSpeed >= TUNE.slowdownMinDrop) {
      T.slowdowns += 1;
      if (s.peak <= TUNE.gradualMax) T.gradualSlowdowns += 1;
    }
    if (s.peak >= TUNE.hardBrake) {
      const secs = Math.max(1, Math.round((s.endT - s.startT) / 1000));
      addMoment(T, {
        kind: 'hard-brake', level: 'sharp', label: 'Hard brake', at: s.startT, durationSec: secs,
        what: 'Speed fell from ' + kmh(s.fromSpeed) + ' to ' + kmh(s.endSpeed) + ' km/h in about ' + secs + ' s.',
        why: 'Braking force peaked at ' + one(s.peak) + ' m/s2 (hard-brake flag level: ' + one(TUNE.hardBrake) + '). This is measured from GPS speed, so a bumpy road cannot cause it.',
        tip: 'A hard brake usually means the hazard was seen late. Look further ahead and keep a 3-second gap so you can ease off earlier.',
        tuneKey: 'hardBrake', measured: s.peak, limit: TUNE.hardBrake
      });
    }
  }

  // Speed-up episodes (the hard acceleration moment)
  function trackSpeedUps(T, prev, fix, speed, accel, dt) {
    if (!T.surging) {
      if (accel >= TUNE.slowdownStart && prev.speed !== null) {
        T.surging = { startT: prev.t, fromSpeed: prev.speed, peak: accel, quietSec: 0, endT: fix.t, endSpeed: speed };
      }
      return;
    }
    const s = T.surging;
    if (accel > s.peak) s.peak = accel;
    if (accel < 0.15) {
      s.quietSec += dt;                        // the push has eased off
    } else {
      s.quietSec = 0; s.endT = fix.t; s.endSpeed = speed;
    }
    if (s.quietSec >= 2) finishSpeedUp(T);
  }

  function finishSpeedUp(T) {
    const s = T.surging;
    if (!s) return;
    T.surging = null;

    if (s.peak >= TUNE.hardAccel) {
      const secs = Math.max(1, Math.round((s.endT - s.startT) / 1000));
      addMoment(T, {
        kind: 'hard-accel', level: 'sharp', label: 'Hard acceleration', at: s.startT, durationSec: secs,
        what: 'Speed rose from ' + kmh(s.fromSpeed) + ' to ' + kmh(s.endSpeed) + ' km/h in about ' + secs + ' s.',
        why: 'Acceleration peaked at ' + one(s.peak) + ' m/s2 (hard-acceleration flag level: ' + one(TUNE.hardAccel) + '). This is measured from GPS speed, so a bumpy road cannot cause it.',
        tip: 'Squeeze the pedal rather than stamp on it. A calm build-up of speed keeps grip in reserve and saves fuel.',
        tuneKey: 'hardAccel', measured: s.peak, limit: TUNE.hardAccel
      });
    }
  }

  function countLevel(T, level) {
    return T.moments.filter(function (m) { return m.level === level; }).length;
  }


  /* ---------- 8. RESULTS ----------
     The names on the left (smoothness, gentleStops...) must match the
     metric ids in app.js. null means "not enough real data yet". */

  function metricValues() {
    const T = trip;
    const moved = T.movingSec > 0;
    return {
      smoothness:       T.smoothSec >= 10 ? T.smoothSum / T.smoothSec : null,
      gentleStops:      T.stops > 0 ? 100 * T.gentleStops / T.stops : null,
      easyLaunches:     T.launches > 0 ? 100 * T.easyLaunches / T.launches : null,
      cruiseStreak:     moved ? T.cruiseBest : null,
      speedConsistency: T.wobbleSec >= 20 ? T.wobbleSum / T.wobbleSec : null,
      tripFlow:         T.movingSec >= 10 ? 100 * T.movingSec / T.trackedSec : null,
      corneringPoise:   T.cornerSec >= 3 ? T.cornerSum / T.cornerSec : null,
      calmStreak:       moved ? T.calmBest : null,
      anticipation:     T.slowdowns > 0 ? 100 * T.gradualSlowdowns / T.slowdowns : null,
      sharpMoments:     moved ? countLevel(T, 'sharp') : null,
      stopGoBursts:     moved ? T.bursts : null
    };
  }

  // Highlight moments, built only from things that really happened.
  function buildHighlights() {
    const T = trip;
    const list = [];
    if (T.movingSec < 10) return list;
    const sharp = T.moments.filter(function (m) { return m.level === 'sharp'; });

    if (T.cruiseBest >= 20) {
      list.push({ emoji: '🏁', title: 'Longest steady cruise', text: clock(T.cruiseBest) + ' holding about ' + kmh(T.cruiseBestPace) + ' km/h' });
    }
    if (T.stops > 0) {
      list.push({ emoji: '🪶', title: 'Soft landings', text: T.gentleStops + ' of ' + T.stops + (T.stops === 1 ? ' stop' : ' stops') + ' ended gently' });
    }
    if (T.launches > 0) {
      list.push({ emoji: '🚦', title: 'Easy launches', text: T.easyLaunches + ' of ' + T.launches + (T.launches === 1 ? ' pull-away was' : ' pull-aways were') + ' calm' });
    }
    if (T.corners > 0) {
      list.push({ emoji: '🌀', title: 'Corner composure', text: T.composedCorners + ' of ' + T.corners + (T.corners === 1 ? ' corner' : ' corners') + ' taken smoothly' });
    }
    if (T.slowdowns > 0) {
      list.push({ emoji: '🍃', title: 'Early lift-offs', text: T.gradualSlowdowns + ' of ' + T.slowdowns + (T.slowdowns === 1 ? ' slow-down was' : ' slow-downs were') + ' gradual' });
    }
    if (sharp.length === 0 && T.distanceM >= 500) {
      list.push({ emoji: '🌿', title: 'Clean sheet', text: 'No sharp moments on this drive' });
    } else if (T.calmBest >= 60) {
      list.push({ emoji: '🌿', title: 'Calm run', text: clock(T.calmBest) + ' without a sharp moment' });
    }
    if (T.bumps > 0) {
      list.push({ emoji: '🛞', title: 'Rough road noted', text: T.bumps + (T.bumps === 1 ? ' bump' : ' bumps') + ' left out of your Smoothness score' });
    }
    if (sharp.length > 0) {
      const last = sharp[sharp.length - 1];
      list.push({ emoji: '👀', title: 'Worth a second look', text: sharp.length + (sharp.length === 1 ? ' sharp moment' : ' sharp moments') + ', latest: ' + last.label.toLowerCase() + ' at ' + timeOfDay(last.at) });
    }
    return list;
  }

  function read() {
    checkGpsHeartbeat();
    const T = trip;
    const hadGps = T.lastFix !== null;
    return {
      active: active,
      status: { gps: status.gps, motion: status.motion, wake: status.wake },
      hadGps: hadGps,
      hadMotion: !!flags.motionEverLive,
      speedKmh: active && T.speed !== null ? T.speed * 3.6 : null,
      distanceKm: hadGps ? T.distanceM / 1000 : null,
      avgSpeedKmh: T.movingSec >= 5 ? (T.distanceM / T.movingSec) * 3.6 : null,
      topSpeedKmh: T.movingSec > 0 ? T.topSpeed * 3.6 : null,
      movingSec: T.movingSec,
      metrics: metricValues(),
      highlights: buildHighlights(),
      moments: T.moments.slice(),
      tune: learnedValues(),            // the thresholds this drive was judged with
      gpsGaps: T.gpsGaps,
      interruptions: T.interruptions,
      hiddenSec: T.hiddenSec
    };
  }


  /* ---------- 9. START / STOP ---------- */

  function start(handlers) {
    if (active) return;
    callbacks = {
      onLog: (handlers && handlers.onLog) || function () {},
      onStatus: (handlers && handlers.onStatus) || function () {}
    };
    active = true;
    flags = {};
    trip = newTrip();
    bucket = newBucket();
    gravity = null;
    pushSmooth = { x: 0, y: 0, z: 0 };
    joltSmooth = 0;
    hiddenAt = 0;

    // Pick up the latest learned calibration before measuring anything.
    profile = loadProfile();
    applyProfile();
    const learned = tuning().changed;
    if (learned > 0) {
      say('Using your learned calibration: ' + learned + (learned === 1 ? ' threshold' : ' thresholds') + ' adjusted from your feedback.', 'fun');
    }

    // Browsers only hand out GPS, motion and wake lock on secure (https) pages.
    if (window.isSecureContext === false) {
      say('This page is not on a secure (https) address, so the browser blocks GPS, motion and the wake lock. Open the https GitHub Pages link instead.', 'alert');
    }

    startMotion();        // first, because iPhones need this inside the button tap
    startGps();
    requestWakeLock();
  }

  function stop() {
    if (!active) return read();
    stopGps();
    stopMotion();
    releaseWakeLock();

    // Finish anything still in progress so it reaches the timeline.
    finishSlowdown(trip);
    finishSpeedUp(trip);
    endTurn(trip);
    closeLaunch(trip);
    endCruise(trip);

    active = false;
    setStatus('gps', 'idle', 'off');
    setStatus('motion', 'idle', 'off');
    setStatus('wake', 'idle', 'normal');
    return read();
  }

  // The one name this file shares with the rest of the app.
  window.DrivePulseSensors = {
    start: start, stop: stop, read: read,
    tuning: tuning, learn: learn, resetTuning: resetTuning
  };
})();
