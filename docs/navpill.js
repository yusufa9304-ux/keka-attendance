/* The sliding pill behind the active tab.
 *
 * The buttons stay put and only their .active class changes, so the pill can
 * travel between them instead of blinking on and off. A MutationObserver picks
 * the class change up whichever piece of code made it, which is what lets this
 * same file serve every screen without any of them knowing about it
 * knowing about it.
 *
 * The travel uses the same spring curve as the rest of the app, and collapses
 * to an instant jump for anyone who asked for reduced motion.
 */
(function () {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const containers = () => document.querySelectorAll('.nav .links');

  function pillFor(links) {
    let pill = Array.prototype.find.call(links.children, (c) => c.classList && c.classList.contains('nav-pill'));
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'nav-pill';
      pill.setAttribute('aria-hidden', 'true');
      links.insertBefore(pill, links.firstChild);
    }
    return pill;
  }

  function place(links, animate) {
    if (!links) return;
    const pill = pillFor(links);
    const active = links.querySelector('button.active');
    if (!active) { pill.style.opacity = '0'; return; }

    const apply = () => {
      pill.style.width = active.offsetWidth + 'px';
      pill.style.height = active.offsetHeight + 'px';
      pill.style.transform = 'translateY(-50%) translateX(' + active.offsetLeft + 'px)';
      pill.style.opacity = '1';
    };

    // A button inside a hidden container measures 0. Try again next frame a few
    // times rather than baking a zero-width pill into place.
    if (!active.offsetWidth && (links._pillRetry = (links._pillRetry || 0) + 1) < 40) {
      requestAnimationFrame(() => place(links, animate));
      return;
    }
    links._pillRetry = 0;

    // Layout can still settle a frame later (a wrapping label, a scrollbar
    // appearing), which left the pill a pixel or two out. One follow-up frame
    // costs nothing and keeps it exact.
    const settle = () => {
      if (active.offsetWidth !== pill.offsetWidth) apply();
    };

    if (animate && !reduced) { apply(); requestAnimationFrame(settle); return; }
    // No transition for this frame, so the pill is simply *there* rather than
    // flying in from the corner on the first paint or after a resize.
    pill.style.transition = 'none';
    apply();
    void pill.offsetWidth;
    pill.style.transition = '';
    requestAnimationFrame(settle);
  }

  function boot() {
    containers().forEach((links) => {
      place(links, false);
      if (links._pillWatch) return;
      links._pillWatch = new MutationObserver(() => place(links, true));
      links._pillWatch.observe(links, { childList: true, subtree: true, attributeFilter: ['class'] });

      // The strip is often laid out while its container is still hidden — the
      // app view is not shown until you sign in — and a hidden button reports a
      // width of 0, which left the pill zero-wide until something else nudged
      // it. A size change of the strip itself is the cue to place it again.
      if (window.ResizeObserver) {
        links._pillResize = new ResizeObserver(() => place(links, false));
        links._pillResize.observe(links);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener('resize', () => containers().forEach((l) => place(l, false)));
  window.addEventListener('orientationchange', () => containers().forEach((l) => place(l, false)));

  // The app renders the strip itself, so it asks for a sync once it is done.
  window.syncNavPill = (links) => place(links || document.querySelector('.nav .links'), true);
  window.syncNavPillNow = (links) => place(links || document.querySelector('.nav .links'), false);
})();
