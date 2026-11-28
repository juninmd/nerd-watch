import { Artwork, Button, Hero, useReducedMotion } from '@juninmd/sonido';
import { useEffect, useState } from 'react';
import { navigate } from '../app/router.ts';
import { scoreLabel } from '../ui/poster-badges.ts';
import { libraryItemPath } from '../ui/title-link.ts';
import { HERO_INTERVAL_MS, type HeroSlide, nextSlide } from './home-hero.ts';

/**
 * Destaque do início que gira pelos títulos em andamento (o banner do stream-goat): a cada 9 s, com pontos para
 * escolher. Para com o mouse em cima, com foco dentro ou com "reduzir movimento"; o slide é anunciado quando parado ou trocado pela pessoa.
 */
export function HomeHeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const calm = useReducedMotion();
  const count = slides.length;

  useEffect(() => {
    if (paused || calm || count < 2) return;
    const timer = setTimeout(() => setIndex((i) => nextSlide(i, count)), HERO_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [index, paused, calm, count]);

  const slide = slides[Math.min(index, count - 1)];
  if (!slide) return null;
  const { item } = slide;
  const score = scoreLabel(item.title.voteAverage);
  return (
    <section
      className="home-hero"
      aria-roledescription="carrossel"
      aria-label="Destaques em andamento"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        // Foco indo de um botão para outro dentro do carrossel não retoma a rotação.
        if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false);
      }}
    >
      {/* Girando sozinho, não anuncia (padrão WAI de carrossel); parado ou trocado pela pessoa, o leitor lê o novo slide. */}
      <div aria-live={paused || calm ? 'polite' : 'off'} aria-atomic="true">
        <Hero
          key={item.titleId}
          className="home-hero__slide"
          title={item.title.title}
          backdrop={item.title.posterUrl ?? undefined}
          meta={
            <>
              <span className="home-hero__kicker">{slide.kicker}</span>
              <span>{[slide.meta, item.title.releaseDate?.slice(0, 4), score ? `★ ${score}` : null].filter(Boolean).join(' · ')}</span>
            </>
          }
          actions={
            <Button variant="primary" onClick={() => navigate(libraryItemPath(item))}>
              Continuar
            </Button>
          }
          aside={item.title.posterUrl ? <Artwork title={item.title.title} src={item.title.posterUrl} ratio="poster" /> : undefined}
        />
      </div>
      {count > 1 && (
        <nav className="home-hero__dots" aria-label="Escolher destaque">
          {slides.map((s, i) => (
            <button
              type="button"
              key={s.item.titleId}
              className={i === index ? 'is-on' : undefined}
              aria-label={`Destaque ${i + 1} de ${count}: ${s.item.title.title}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => setIndex(i)}
            />
          ))}
        </nav>
      )}
    </section>
  );
}
