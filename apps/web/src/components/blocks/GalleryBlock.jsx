// gallery: several media library pictures in one of three fixed layouts
// (#1176). Grid shows every picture. Carousel shows several in a row that
// scrolls sideways. Slideshow shows one picture at a time.
//
// Carousel and slideshow follow the WAI-ARIA Authoring Practices carousel
// pattern: a labelled region, Previous and Next buttons, each slide named
// "n of m", and a polite status for the current position. Nothing moves on
// its own, so there is no rotation to pause and nothing for reduced motion
// to switch off. Scroll snap does the sliding: a swipe on a touch screen is
// a native scroll, and the buttons only move the scroller.
//
// Every picture resolves through useSizedImageSources, as ImageBlock does,
// so a library path loads its display sizes from the bucket. Each picture
// sits in a fixed aspect box, so nothing shifts while it loads.
//
// The stored block is data from the CMS. Only library paths with alt text
// are drawn, and an unknown layout draws as a grid.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { bundledDemoAssetUrl } from '../../lib/bundledAssets.js';
import { useSizedImageSources } from '../LeadImage.jsx';
import { secondaryActionClass } from '../controlClasses.js';
import './gallery.css';

export const GALLERY_LAYOUTS = Object.freeze(['grid', 'carousel', 'slideshow']);

const SIZES = Object.freeze({
  grid: '(min-width: 64rem) 20rem, (min-width: 40rem) 33vw, 50vw',
  carousel: '(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 80vw',
  slideshow: '(min-width: 64rem) 48rem, 100vw',
});

/** The pictures a gallery may draw: a safe path with alt text, nothing else. */
export function galleryImages(block) {
  if (!Array.isArray(block?.images)) return [];
  return block.images.filter(
    (image) =>
      typeof image?.url === 'string' &&
      image.url.trim() &&
      isSafeHref(image.url) &&
      typeof image.alt === 'string' &&
      image.alt.trim(),
  );
}

/** The stored layout when it is one the page has, else grid. */
export function galleryLayout(block) {
  return GALLERY_LAYOUTS.includes(block?.layout) ? block.layout : 'grid';
}

function GalleryPicture({ image, layout }) {
  const sources = useSizedImageSources(image.url);
  return (
    <img
      src={bundledDemoAssetUrl(image.url) ?? sources.src}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? SIZES[layout] : undefined}
      onError={sources.onError}
      alt={image.alt.trim()}
      loading="lazy"
      decoding="async"
      className={`gallery__image gallery__image--${layout}`}
      style={sources.pending ? { visibility: 'hidden' } : undefined}
    />
  );
}

// Move the scroller without animating: wayfinding is instant for everybody
// (docs/interface-guidelines.md, Animation). jsdom has no scrollTo.
function scrollToLeft(scroller, left) {
  if (typeof scroller?.scrollTo !== 'function') return;
  try {
    scroller.scrollTo({ left, behavior: 'instant' });
  } catch {
    scroller.scrollTo(left, 0);
  }
}

function Slides({ images, layout, name }) {
  const scrollerRef = useRef(null);
  const scrollerId = useId();
  const [current, setCurrent] = useState(0);
  const [inView, setInView] = useState(1);
  const [atEnd, setAtEnd] = useState(images.length <= 1);
  const count = images.length;

  // The current slide is the one nearest the scroller's start edge.
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const slides = [...scroller.children];
    const origin = slides[0]?.offsetLeft ?? 0;
    let nearest = 0;
    slides.forEach((slide, index) => {
      const distance = Math.abs(slide.offsetLeft - origin - scroller.scrollLeft);
      if (distance < Math.abs(slides[nearest].offsetLeft - origin - scroller.scrollLeft)) nearest = index;
    });
    // How many slides fit: the carousel shows several, so the position
    // names the run in view ("3–5 of 5"), not only the first.
    const step = slides.length > 1 ? slides[1].offsetLeft - slides[0].offsetLeft : 0;
    const gap = step - (slides[0]?.offsetWidth ?? 0);
    setInView(step > 0 ? Math.max(1, Math.floor((scroller.clientWidth + gap + 1) / step)) : 1);
    setCurrent(nearest);
    setAtEnd(scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [measure]);

  const atStart = current === 0;
  const lastInView = Math.min(count, current + inView);
  const lastReached = atEnd || current === count - 1;

  function go(index) {
    const scroller = scrollerRef.current;
    const slides = scroller ? [...scroller.children] : [];
    const target = slides[Math.max(0, Math.min(count - 1, index))];
    if (!target) return;
    scrollToLeft(scroller, target.offsetLeft - slides[0].offsetLeft);
    measure();
  }

  // aria-disabled, not disabled: the focused button stays focused at the
  // first and last slide, and its handler refuses the move.
  function previous() {
    if (!atStart) go(current - 1);
  }
  function next() {
    if (!lastReached) go(current + 1);
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    } else if (event.key === 'Home') {
      event.preventDefault();
      go(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      go(count - 1);
    }
  }

  return (
    <section
      className={`gallery gallery--${layout}`}
      aria-roledescription="carousel"
      aria-label={name}
    >
      <div className="gallery__controls">
        <button
          type="button"
          className={secondaryActionClass}
          aria-controls={scrollerId}
          aria-disabled={atStart ? 'true' : undefined}
          onClick={previous}
        >
          Previous<span className="sr-only"> photo</span>
        </button>
        <button
          type="button"
          className={secondaryActionClass}
          aria-controls={scrollerId}
          aria-disabled={lastReached ? 'true' : undefined}
          onClick={next}
        >
          Next<span className="sr-only"> photo</span>
        </button>
        <p className="gallery__position" aria-live="polite" aria-atomic="true">
          {lastInView > current + 1 ? `${current + 1}–${lastInView}` : current + 1} of {count}
        </p>
      </div>
      {/* Focusable so a keyboard can scroll it; arrow keys step one slide. */}
      <div
        id={scrollerId}
        ref={scrollerRef}
        className="gallery__scroller"
        role="group"
        aria-label={`${name}, slides`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {images.map((image, index) => (
          <div
            key={`${image.url}-${index}`}
            className="gallery__slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}`}
          >
            <GalleryPicture image={image} layout={layout} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function GalleryBlock({ block }) {
  const images = galleryImages(block);
  if (images.length === 0) return null;
  const layout = galleryLayout(block);
  const name = typeof block.label === 'string' && block.label.trim() ? block.label.trim() : 'Photo gallery';

  if (layout === 'grid') {
    return (
      <section className="gallery gallery--grid" aria-label={name} lang={block.publicLanguage}>
        <ul className="gallery__grid" role="list">
          {images.map((image, index) => (
            <li key={`${image.url}-${index}`} className="gallery__cell">
              <GalleryPicture image={image} layout="grid" />
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <div lang={block.publicLanguage}>
      <Slides images={images} layout={layout} name={name} />
    </div>
  );
}
