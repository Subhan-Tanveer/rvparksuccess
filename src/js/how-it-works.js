import '../css/tokens.css';
import { initCore, initHeroVideo, gsap, ScrollTrigger, prefersReduced } from './core.js';

initCore();
initHeroVideo({ placeholderLabel: 'HOW IT WORKS — HERO VIDEO COMING SOON' });

const section = document.getElementById('hscrollSection');
const track = document.getElementById('hscrollTrack');
const bar = document.getElementById('hscrollBar');
const steps = [...document.querySelectorAll('.hscroll-step')];
const hint = document.querySelector('.hscroll-hint');

if (section && track && !prefersReduced && window.innerWidth > 720) {
  const setup = () => {
    const distance = track.scrollWidth - window.innerWidth;
    if (distance <= 0) return null;
    return ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: () => `+=${distance}`,
      pin: true,
      scrub: 0.6,
      onUpdate: (self) => {
        gsap.set(track, { x: -distance * self.progress });
        if (bar) bar.style.width = `${self.progress * 100}%`;
        const activeIndex = Math.min(steps.length - 1, Math.floor(self.progress * steps.length));
        steps.forEach((s, i) => s.classList.toggle('is-active', i === activeIndex));
        if (hint) hint.style.opacity = self.progress > 0.02 ? '0' : '1';
      },
    });
  };
  let trigger = setup();
  window.addEventListener('resize', () => {
    trigger?.kill();
    gsap.set(track, { x: 0 });
    trigger = setup();
    ScrollTrigger.refresh();
  });
} else if (hint) {
  hint.style.display = 'none';
}
