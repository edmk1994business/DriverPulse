/* =========================================================
   DrivePulse - playful.js  (Phase 1)

   Everything about the Playful Pit-Stop lives in this one file:
     1. The card CONTENT (edit this list to add, change or remove cards)
     2. Building the cards and the quick-jump buttons
     3. Jumping to a card
     4. Shuffling the deck
     5. "Back to Dash" and "Go to Pit-Stop" scrolling

   This file never touches the dashboard, and app.js never touches
   the cards. Delete this file's <script> line in index.html and the
   dashboard keeps working (the Pit-Stop is simply empty).

   The (function () { ... })(); wrapper below is a privacy fence:
   names declared inside cannot clash with names in other files.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 1. CARD CONTENT ----------
     Each card needs:
       id     - a unique short name (used by the quick-jump buttons)
       emoji  - the picture shown on the card and its jump button
       chip   - the short label on the quick-jump button
       kind   - one of the KINDS below (sets the tag and colour)
       title, body - the text
       tryIt  - a small "try this next" line
     To add a card, copy one block, change the text, give it a new id. */

  const KINDS = {
    tip:       { label: 'Tip',        tone: 'sky' },
    challenge: { label: 'Challenge',  tone: 'amber' },
    fact:      { label: 'Road trivia', tone: 'purple' },
    myth:      { label: 'Myth check', tone: 'coral' },
    calm:      { label: 'Calm corner', tone: 'mint' }
  };

  const CARDS = [
    {
      id: 'bubble', emoji: '🫧', chip: '3-second bubble', kind: 'tip',
      title: 'The 3-second bubble',
      body: 'Pick a sign or a shadow up ahead. When the car in front passes it, count "one-thousand-one, one-thousand-two, one-thousand-three". If you reach it before you finish, you are too close.',
      tryIt: 'Double the count in rain or at night.'
    },
    {
      id: 'ghost-jam', emoji: '👻', chip: 'Phantom jams', kind: 'fact',
      title: 'Phantom traffic jams',
      body: 'Plenty of jams have no crash and no roadworks behind them. One sharp tap on the brakes ripples backwards through the cars behind like a wave, growing as it goes. A driver holding a steady pace and a decent gap can soak the wave up.',
      tryIt: 'In heavy traffic, aim to roll slowly instead of stop, sprint, stop.'
    },
    {
      id: 'full-cup', emoji: '☕', chip: 'Full-cup challenge', kind: 'challenge',
      title: 'The full-cup challenge',
      body: 'Imagine a cup filled to the brim sitting on your dashboard. Every press of a pedal and every turn of the wheel should be gentle enough not to spill a drop.',
      tryIt: 'Next trip, go for zero imaginary spills. Your Smoothness score is the judge.'
    },
    {
      id: 'chauffeur-stop', emoji: '🪶', chip: 'Chauffeur stop', kind: 'tip',
      title: 'The chauffeur stop',
      body: 'Just before the car comes to rest, ease a little pressure off the brake. The nose settles softly instead of bobbing, and passengers barely notice the stop.',
      tryIt: 'This is the quickest way to lift your Gentle stop ratio.'
    },
    {
      id: 'eyes-up', emoji: '👀', chip: 'Eyes up', kind: 'tip',
      title: 'Look where you want to go',
      body: 'Your hands follow your eyes. Look far through a bend to where you want to end up, not at the kerb just past the bonnet. The steering turns into one smooth sweep.',
      tryIt: 'On your next bend, find the exit with your eyes before you turn the wheel.'
    },
    {
      id: 'slow-in', emoji: '🌀', chip: 'Slow in, smooth out', kind: 'tip',
      title: 'Slow in, smooth out',
      body: 'Do your slowing down before the corner, while the wheels still point straight. Then steer through and gently add power as the road opens up.',
      tryIt: 'Braking finished before you turn? That is what Cornering poise rewards.'
    },
    {
      id: 'nine-three', emoji: '🕘', chip: '10 and 2?', kind: 'myth',
      title: 'Hands at 10 and 2?',
      body: 'That was the old lesson. With an airbag inside the steering wheel, safety agencies such as the US NHTSA now suggest 9 and 3. Your arms stay clear of the airbag and you get steadier control.',
      tryIt: 'Check your grip at the next red light. Relaxed hands, 9 and 3.'
    },
    {
      id: 'four-palms', emoji: '🖐️', chip: 'Four palms', kind: 'fact',
      title: 'Four palm-sized patches',
      body: 'Going, stopping and turning all happen through four patches of rubber, each roughly the size of your hand. Smooth inputs share that grip out. Sudden ones spend it all at once.',
      tryIt: 'Think "squeeze", never "stamp", on both pedals.'
    },
    {
      id: 'lift-early', emoji: '🍃', chip: 'Lift, don\'t brake', kind: 'challenge',
      title: 'Lift, don\'t brake',
      body: 'Spot a red light or a queue far ahead? Come off the accelerator early and let the car slow itself. You may arrive just as things start moving and never stop at all.',
      tryIt: 'Count how many red lights you can roll up to without a full stop. It feeds Anticipation and Trip flow.'
    },
    {
      id: 'cruise-captain', emoji: '🎯', chip: 'Cruise captain', kind: 'challenge',
      title: 'Cruise captain',
      body: 'On a clear, steady road, hold your speed within a few km/h for two full minutes, inside the limit. It is harder than it sounds.',
      tryIt: 'Beat your own Steady cruise streak from the last trip.'
    },
    {
      id: 'mirror-beat', emoji: '🪞', chip: 'Mirror beat', kind: 'tip',
      title: 'The mirror beat',
      body: 'Glance at a mirror every five to eight seconds. It is a quick flick of the eyes, not a stare. You will know what is around you before you ever need to brake or change lanes.',
      tryIt: 'Pick a rhythm: road, mirror, road, speed, road.'
    },
    {
      id: 'red-light-reset', emoji: '🌿', chip: 'Red-light reset', kind: 'calm',
      title: 'Red-light reset',
      body: 'Stopped at a light? Drop your shoulders, loosen your grip and let one slow breath out. A relaxed driver makes smoother moves.',
      tryIt: 'Make every red light a five-second reset.'
    }
  ];


  /* ---------- Finding the page elements this file works with ---------- */
  const cardsBox = document.getElementById('pit-cards');
  const chipsBox = document.getElementById('pit-chips');
  const shuffleBtn = document.getElementById('pit-shuffle');
  const announcer = document.getElementById('pit-announce');
  const dash = document.getElementById('dash');
  const pitstop = document.getElementById('pitstop');

  // If the Pit-Stop section is ever removed from index.html, stop quietly.
  if (!cardsBox || !chipsBox) return;

  // People who switch off animations in their phone settings get instant jumps.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollStyle = reduceMotion ? 'auto' : 'smooth';

  // Small helper: make an element with a class and (optionally) some text.
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }


  /* ---------- 2. BUILDING THE CARDS AND QUICK-JUMP BUTTONS ---------- */

  function buildCard(card) {
    const kind = KINDS[card.kind] || KINDS.tip;

    const box = make('article', 'card');
    box.id = 'card-' + card.id;
    box.dataset.tone = kind.tone;        // styles.css turns this into a colour
    box.tabIndex = -1;                   // lets a jump move keyboard focus here

    const top = make('div', 'card__top');
    const emoji = make('span', 'card__emoji', card.emoji);
    emoji.setAttribute('aria-hidden', 'true');
    top.append(emoji, make('span', 'card__kind', kind.label));

    const tryIt = make('p', 'card__try');
    tryIt.append(make('strong', '', 'Try it: '), card.tryIt);

    const backRow = make('div', 'card__back');
    const backBtn = make('button', 'ghost-btn', '↑ Back to Dash');
    backBtn.type = 'button';
    backBtn.dataset.action = 'back-to-dash';   // handled in section 5
    backRow.append(backBtn);

    box.append(top, make('h3', 'card__title', card.title), make('p', 'card__body', card.body), tryIt, backRow);
    return box;
  }

  function buildChip(card) {
    const kind = KINDS[card.kind] || KINDS.tip;
    const chip = make('button', 'chip', card.emoji + ' ' + card.chip);
    chip.type = 'button';
    chip.dataset.tone = kind.tone;
    chip.dataset.jump = card.id;               // remembers which card to jump to
    return chip;
  }

  CARDS.forEach(function (card) {
    cardsBox.append(buildCard(card));
    chipsBox.append(buildChip(card));
  });


  /* ---------- 3. JUMPING TO A CARD ---------- */

  function jumpToCard(cardId) {
    const target = document.getElementById('card-' + cardId);
    if (!target) return;
    target.scrollIntoView({ behavior: scrollStyle, block: 'start' });
    target.focus({ preventScroll: true });

    // Restart the glow animation so you can spot the card you landed on.
    target.classList.remove('is-flash');
    void target.offsetWidth;                   // tells the browser "start over"
    target.classList.add('is-flash');
  }

  // One listener on the whole chip row is enough: we check what was tapped.
  chipsBox.addEventListener('click', function (event) {
    const chip = event.target.closest('[data-jump]');
    if (chip) jumpToCard(chip.dataset.jump);
  });


  /* ---------- 4. SHUFFLING THE DECK ----------
     The quick-jump buttons stay in the same order on purpose, so you can
     always find a favourite card again. Only the cards move. */

  function shuffleCards() {
    const cards = Array.from(cardsBox.children);
    if (cards.length < 2) return;
    const oldFirst = cards[0];

    // Fisher-Yates shuffle: walk backwards, swapping each card with a random earlier one.
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const swap = cards[i];
      cards[i] = cards[j];
      cards[j] = swap;
    }
    // Make sure a shuffle always shows a different card on top.
    if (cards[0] === oldFirst) {
      cards.push(cards.shift());
    }

    cards.forEach(function (card) { cardsBox.append(card); });   // re-places them in the new order

    const firstTitle = cards[0].querySelector('.card__title').textContent;
    if (announcer) announcer.textContent = 'Shuffled. First up: ' + firstTitle;
    jumpToCard(cards[0].id.replace('card-', ''));
  }

  if (shuffleBtn) shuffleBtn.addEventListener('click', shuffleCards);


  /* ---------- 5. BACK TO DASH / GO TO PIT-STOP ----------
     Any button in index.html (or built above) with
       data-action="back-to-dash"   or   data-action="go-pitstop"
     works automatically. Add as many as you like, no new code needed. */

  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    if (button.dataset.action === 'back-to-dash') {
      window.scrollTo({ top: 0, behavior: scrollStyle });
      if (dash) dash.focus({ preventScroll: true });
    }
    if (button.dataset.action === 'go-pitstop' && pitstop) {
      pitstop.scrollIntoView({ behavior: scrollStyle, block: 'start' });
      pitstop.focus({ preventScroll: true });
    }
  });
})();
