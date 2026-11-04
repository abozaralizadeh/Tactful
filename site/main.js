// Small enhancements only. The page works without this file.
document.documentElement.classList.add('js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Reveal sections as they scroll in.
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add('is-in'));
}

// The demo video loads only when it's close to the screen. With reduced motion it doesn't autoplay.
const video = document.querySelector('.lazy-video');
const toggle = document.querySelector('.play-toggle');
if (video) {
  const load = () => {
    const source = video.querySelector('source[data-src]');
    if (!source) return;
    source.src = source.dataset.src;
    source.removeAttribute('data-src');
    video.load();
  };
  const setLabel = () => {
    toggle.textContent = video.paused ? 'Play' : 'Pause';
    toggle.setAttribute('aria-pressed', String(!video.paused));
  };
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    load();
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  video.addEventListener('play', setLabel);
  video.addEventListener('pause', setLabel);
  setLabel();

  if ('IntersectionObserver' in window) {
    const vio = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          load();
          if (!reduceMotion) video.play().catch(() => {});
        } else if (!video.paused) {
          video.pause();
        }
      }
    }, { rootMargin: '200px 0px' });
    vio.observe(video);
  } else {
    load();
  }
}

// Cool it down: the real message and the real rewrite from the demo.
const card = document.querySelector('.cool-card');
const coolBtn = document.getElementById('cool-btn');
if (card && coolBtn) {
  coolBtn.addEventListener('click', () => {
    const calm = card.dataset.state !== 'calm';
    card.dataset.state = calm ? 'calm' : 'hot';
    coolBtn.textContent = calm ? 'Show what Alex typed' : 'Cool it down';
    coolBtn.setAttribute('aria-pressed', String(calm));
  });
}

// Copy buttons on the code blocks.
document.querySelectorAll('.copy').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy)?.innerText ?? '';
    try {
      await navigator.clipboard.writeText(text.trim());
      btn.textContent = 'Copied';
      btn.classList.add('done');
    } catch {
      btn.textContent = 'Select and copy';
    }
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('done');
    }, 1800);
  });
});
