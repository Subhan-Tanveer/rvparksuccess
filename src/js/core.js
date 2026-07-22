import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { placeholderDataUri } from './placeholder.js';

gsap.registerPlugin(ScrollTrigger);

export const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isTouch = window.matchMedia('(hover: none)').matches || window.innerWidth < 900;

/* ---------------------------------------------------------------- */
/* Smooth scroll                                                     */
/* ---------------------------------------------------------------- */
function initSmoothScroll() {
  if (prefersReduced) return null;
  const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

/* ---------------------------------------------------------------- */
/* Scroll progress bar                                               */
/* ---------------------------------------------------------------- */
function initScrollProgress() {
  const bar = document.querySelector('.scroll-progress-bar');
  if (!bar) return;
  const update = () => {
    const h = document.documentElement;
    const scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
    bar.style.width = `${Math.min(Math.max(scrolled, 0), 1) * 100}%`;
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
}

/* ---------------------------------------------------------------- */
/* Custom cursor: dot + ring, scales on hover over clickable elements */
/* ---------------------------------------------------------------- */
function initCustomCursor() {
  if (isTouch || prefersReduced) return;
  const dot = document.querySelector('.cursor-dot');
  const ring = document.querySelector('.cursor-ring');
  if (!dot || !ring) return;
  document.body.classList.add('has-custom-cursor');

  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let rx = mx, ry = my;
  window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });

  gsap.ticker.add(() => {
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
    rx += (mx - rx) * 0.18;
    ry += (my - ry) * 0.18;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
  });

  document.querySelectorAll('a, button, [data-cursor-hover]').forEach((el) => {
    el.addEventListener('mouseenter', () => ring.classList.add('is-hover'));
    el.addEventListener('mouseleave', () => ring.classList.remove('is-hover'));
  });
}

/* ---------------------------------------------------------------- */
/* Nav: overlay menu wiring + active link                            */
/* ---------------------------------------------------------------- */
function initNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.mobile-menu-links a, .nav-links-desktop a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) a.classList.add('is-active');
  });
  const menuBtn = document.querySelector('.nav-menu-btn');
  const menu = document.querySelector('.mobile-menu');
  const closeBtn = document.querySelector('.mobile-menu-close');
  if (menuBtn && menu) {
    const open = () => { menu.classList.add('is-open'); document.body.style.overflow = 'hidden'; };
    const close = () => { menu.classList.remove('is-open'); document.body.style.overflow = ''; };
    menuBtn.addEventListener('click', open);
    closeBtn?.addEventListener('click', close);
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }
}

/* ---------------------------------------------------------------- */
/* Reveal (IntersectionObserver) + counters                          */
/* ---------------------------------------------------------------- */
function initReveal() {
  const els = document.querySelectorAll('[data-reveal], [data-reveal-stagger]');
  if (!els.length) return;
  if (prefersReduced) { els.forEach((el) => el.classList.add('is-visible')); return; }
  const io = new IntersectionObserver(
    (entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); }
    }),
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
  );
  els.forEach((el) => io.observe(el));
}

export function initCounters(root = document) {
  const els = root.querySelectorAll('[data-counter]');
  els.forEach((el) => {
    const target = parseFloat(el.dataset.counter);
    const decimals = el.dataset.counterDecimals ? parseInt(el.dataset.counterDecimals, 10) : 0;
    const suffix = el.dataset.counterSuffix || '';
    const prefix = el.dataset.counterPrefix || '';
    if (prefersReduced) { el.textContent = prefix + target.toFixed(decimals) + suffix; return; }
    const obj = { val: 0 };
    ScrollTrigger.create({
      trigger: el, start: 'top 85%', once: true,
      onEnter: () => {
        gsap.to(obj, {
          val: target, duration: 1.7, ease: 'power2.out',
          onUpdate: () => { el.textContent = prefix + obj.val.toFixed(decimals) + suffix; },
        });
      },
    });
  });
}

/* ---------------------------------------------------------------- */
/* Manual character/word split (SplitText-free) + stagger-in on scroll */
/* ---------------------------------------------------------------- */
export function splitChars(el) {
  const text = el.textContent;
  el.textContent = '';
  el.setAttribute('aria-label', text);
  const frag = document.createDocumentFragment();
  [...text].forEach((ch) => {
    const span = document.createElement('span');
    span.className = 'char';
    span.style.display = 'inline-block';
    span.style.willChange = 'transform, opacity';
    span.textContent = ch === ' ' ? ' ' : ch;
    span.setAttribute('aria-hidden', 'true');
    frag.appendChild(span);
  });
  el.appendChild(frag);
  return [...el.querySelectorAll('.char')];
}

export function splitWords(el) {
  const text = el.textContent;
  el.textContent = '';
  el.setAttribute('aria-label', text);
  const words = text.split(' ');
  words.forEach((w, i) => {
    const span = document.createElement('span');
    span.className = 'word';
    span.style.display = 'inline-block';
    span.textContent = w + (i < words.length - 1 ? ' ' : '');
    span.setAttribute('aria-hidden', 'true');
    el.appendChild(span);
  });
  return [...el.querySelectorAll('.word')];
}

/** Splits [data-split-in] headings into chars/words and staggers them in on scroll entry. */
export function initHeadingSplits() {
  document.querySelectorAll('[data-split-in]').forEach((el) => {
    const mode = el.dataset.splitIn === 'words' ? 'words' : 'chars';
    const parts = mode === 'words' ? splitWords(el) : splitChars(el);
    if (prefersReduced) return;
    gsap.set(parts, { yPercent: 110, opacity: 0 });
    ScrollTrigger.create({
      trigger: el, start: 'top 82%', once: true,
      onEnter: () => gsap.to(parts, { yPercent: 0, opacity: 1, duration: 0.8, ease: 'power3.out', stagger: mode === 'words' ? 0.05 : 0.02 }),
    });
  });
}

/* ---------------------------------------------------------------- */
/* Glitch / scramble text — resolves into the final word on scroll   */
/* ---------------------------------------------------------------- */
const GLITCH_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&$0123456789';
export function initGlitchText() {
  const els = document.querySelectorAll('[data-glitch]');
  els.forEach((el) => {
    const finalText = el.textContent;
    if (prefersReduced) return;
    ScrollTrigger.create({
      trigger: el, start: 'top 85%', once: true,
      onEnter: () => {
        let frame = 0;
        const totalFrames = 18;
        const interval = setInterval(() => {
          frame++;
          const revealCount = Math.floor((frame / totalFrames) * finalText.length);
          el.textContent = finalText.split('').map((ch, i) => {
            if (ch === ' ') return ' ';
            if (i < revealCount) return finalText[i];
            return GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
          }).join('');
          if (frame >= totalFrames) { el.textContent = finalText; clearInterval(interval); }
        }, 40);
      },
    });
  });
}

/* ---------------------------------------------------------------- */
/* Typewriter reveal for subheadings                                 */
/* ---------------------------------------------------------------- */
export function initTypewriter() {
  document.querySelectorAll('[data-typewriter]').forEach((el) => {
    const text = el.textContent;
    if (prefersReduced) return;
    el.textContent = '';
    const cursor = document.createElement('span');
    cursor.className = 'tw-cursor';
    cursor.textContent = '|';
    cursor.style.opacity = '0.6';
    ScrollTrigger.create({
      trigger: el, start: 'top 85%', once: true,
      onEnter: () => {
        el.appendChild(cursor);
        let i = 0;
        const interval = setInterval(() => {
          i++;
          el.textContent = text.slice(0, i);
          el.appendChild(cursor);
          if (i >= text.length) { clearInterval(interval); cursor.remove(); }
        }, 28);
      },
    });
  });
}

/* ---------------------------------------------------------------- */
/* Animated underline: sets --underline-progress to 1 on scroll entry */
/* ---------------------------------------------------------------- */
export function initUnderlines() {
  document.querySelectorAll('.underline-draw').forEach((el) => {
    if (prefersReduced) { el.style.setProperty('--underline-progress', '1'); return; }
    ScrollTrigger.create({
      trigger: el, start: 'top 85%', once: true,
      onEnter: () => el.style.setProperty('--underline-progress', '1'),
    });
  });
}

/* ---------------------------------------------------------------- */
/* Magnetic buttons: inner content follows cursor slightly            */
/* ---------------------------------------------------------------- */
export function initMagneticButtons() {
  if (isTouch || prefersReduced) return;
  document.querySelectorAll('.magnetic').forEach((el) => {
    const strength = 0.35;
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * strength;
      const y = (e.clientY - r.top - r.height / 2) * strength;
      gsap.to(el, { x, y, duration: 0.4, ease: 'power2.out' });
    });
    el.addEventListener('mouseleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' }));
  });
}

/* ---------------------------------------------------------------- */
/* 3D tilt cards: rotate toward cursor position                      */
/* ---------------------------------------------------------------- */
export function initTiltCards() {
  if (isTouch || prefersReduced) return;
  document.querySelectorAll('.tilt-card').forEach((card) => {
    const max = 8;
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(card, { rotateY: px * max * 2, rotateX: -py * max * 2, duration: 0.4, ease: 'power2.out', transformPerspective: 900 });
    });
    card.addEventListener('mouseleave', () => gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.6, ease: 'power3.out' }));
  });
}

/* ---------------------------------------------------------------- */
/* Marquee: duplicates children once for a seamless loop              */
/* ---------------------------------------------------------------- */
export function buildMarquee(trackEl, items) {
  const html = items.join('');
  trackEl.innerHTML = html + html;
}

/* ---------------------------------------------------------------- */
/* Parallax layers: elements with [data-parallax="0.3"] drift slower  */
/* ---------------------------------------------------------------- */
export function initParallax() {
  if (prefersReduced) return;
  document.querySelectorAll('[data-parallax]').forEach((el) => {
    const speed = parseFloat(el.dataset.parallax) || 0.3;
    gsap.to(el, { yPercent: speed * 100, ease: 'none', scrollTrigger: { trigger: el.closest('section, header') || el, start: 'top bottom', end: 'bottom top', scrub: true } });
  });
}

/* ---------------------------------------------------------------- */
/* Floating particles (decorative, dark sections)                    */
/* ---------------------------------------------------------------- */
export function initParticles() {
  document.querySelectorAll('.particles').forEach((wrap) => {
    const count = isTouch ? 8 : 18;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      const size = 2 + Math.random() * 4;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${Math.random() * 100}%`;
      p.style.top = `${Math.random() * 100}%`;
      p.style.opacity = (0.2 + Math.random() * 0.4).toFixed(2);
      wrap.appendChild(p);
      if (!prefersReduced) {
        gsap.to(p, {
          y: `${-40 - Math.random() * 60}`, x: `${(Math.random() - 0.5) * 40}`,
          duration: 6 + Math.random() * 6, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: Math.random() * 4,
        });
      }
    }
  });
}

/* ---------------------------------------------------------------- */
/* Floating-label form fields                                        */
/* ---------------------------------------------------------------- */
export function initFloatingLabels(root = document) {
  root.querySelectorAll('.field-float input, .field-float select').forEach((el) => {
    const sync = () => el.classList.toggle('has-value', !!el.value);
    el.addEventListener('input', sync);
    el.addEventListener('change', sync);
    sync();
  });
}

/* ---------------------------------------------------------------- */
/* Page-transition intro: the wipe itself is a pure CSS animation     */
/* (see .page-transition / @keyframes pt-wipe in components.css) so   */
/* it's already covering the screen on the very first paint — no JS   */
/* needed to trigger it, which is what was causing the real page to   */
/* flash visible for a moment before the panel used to kick in.       */
/* This just removes the panel from the render tree once its CSS      */
/* animation finishes, so it stops sitting there (harmlessly) after.  */
/* ---------------------------------------------------------------- */
function initPageTransition() {
  const el = document.getElementById('pageTransition');
  if (!el) return;
  el.addEventListener('animationend', () => { el.style.display = 'none'; }, { once: true });
}

/* ---------------------------------------------------------------- */
/* Hero video: plays once on load, holds on the final frame (no loop,  */
/* no scroll-scrub). Falls back to a generated placeholder if the      */
/* video genuinely fails to load — reversible, so it un-hides itself   */
/* if the video finishes loading even after the fallback fired.        */
/* Guards against the metadata/data events firing before this script   */
/* attaches its listeners (happens whenever the video is cached) by    */
/* also checking readyState directly.                                  */
/* ---------------------------------------------------------------- */
export function initHeroVideo({ videoId = 'heroVideo', wrapSelector = '.hero-video-wrap', placeholderLabel = 'Video coming soon' } = {}) {
  const heroVideo = document.getElementById(videoId);
  const heroBg = document.querySelector(wrapSelector);
  if (!heroVideo) return;

  if (heroBg) {
    let fallbackShown = false;
    const showFallback = () => {
      if (fallbackShown) return;
      fallbackShown = true;
      heroVideo.style.display = 'none';
      heroBg.style.backgroundImage = `url("${placeholderDataUri(placeholderLabel)}")`;
      heroBg.style.backgroundSize = 'cover';
      heroBg.style.backgroundPosition = 'center';
    };
    const hideFallback = () => {
      if (!fallbackShown) return;
      fallbackShown = false;
      heroVideo.style.display = '';
      heroBg.style.backgroundImage = '';
    };
    if (heroVideo.readyState >= 2) hideFallback();
    heroVideo.addEventListener('loadeddata', hideFallback);
    heroVideo.addEventListener('error', showFallback, true);
    setTimeout(() => { if (heroVideo.readyState === 0) showFallback(); }, 5000);
  }

  heroVideo.loop = false;
  const onMetadataReady = () => {
    if (prefersReduced) { heroVideo.currentTime = heroVideo.duration; return; }
    heroVideo.play().catch(() => { heroVideo.currentTime = heroVideo.duration; });
  };
  if (heroVideo.readyState >= 1) onMetadataReady();
  else heroVideo.addEventListener('loadedmetadata', onMetadataReady);

  if (!prefersReduced) {
    heroVideo.addEventListener('ended', () => { heroVideo.pause(); });
  }
}

/* ---------------------------------------------------------------- */
/* Master init — called on every page                                */
/* ---------------------------------------------------------------- */
export function initCore() {
  initPageTransition();
  const lenis = initSmoothScroll();
  initScrollProgress();
  initCustomCursor();
  initNav();
  initReveal();
  initCounters();
  initHeadingSplits();
  initGlitchText();
  initTypewriter();
  initUnderlines();
  initMagneticButtons();
  initTiltCards();
  initParallax();
  initParticles();
  initFloatingLabels();
  return { lenis };
}

export { gsap, ScrollTrigger };
