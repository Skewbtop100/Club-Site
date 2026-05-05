'use client';

import { useEffect, useRef, useState } from 'react';
import { cldGrid, cldFull } from '@/lib/cloudinary';

interface Props {
  imageUrls: string[];
}

export default function ImageGrid({ imageUrls }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!imageUrls || imageUrls.length === 0) return null;

  const count = Math.min(imageUrls.length, 5);
  const cls = `ig ig-${count}`;
  const visible = imageUrls.slice(0, 5);

  function open(e: React.MouseEvent, idx: number) {
    e.preventDefault();
    e.stopPropagation();
    setLightboxIndex(idx);
  }

  return (
    <>
      <div className={cls}>
        {visible.map((url, idx) => (
          <button
            type="button"
            key={idx}
            className="ig-cell"
            onClick={(e) => open(e, idx)}
            aria-label={`Зураг ${idx + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cldGrid(url)} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          imageUrls={imageUrls}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <style>{`
        .ig {
          display: grid;
          gap: 2px;
          border-radius: 10px;
          overflow: hidden;
          margin-top: 0.65rem;
          background: rgba(127,127,127,0.1);
        }
        .ig-cell {
          padding: 0; border: none; margin: 0;
          background: transparent;
          cursor: zoom-in;
          overflow: hidden;
          position: relative;
        }
        .ig-cell img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
        }
        /* 1 image — natural width, capped height */
        .ig-1 { grid-template-columns: 1fr; }
        .ig-1 .ig-cell { max-height: 500px; }
        .ig-1 .ig-cell img { max-height: 500px; height: auto; object-fit: cover; }
        /* 2 images — side by side, square cells */
        .ig-2 {
          grid-template-columns: 1fr 1fr;
          aspect-ratio: 2 / 1;
        }
        /* 3 images — big left, two stacked right */
        .ig-3 {
          grid-template-columns: 2fr 1fr;
          grid-template-rows: 1fr 1fr;
          aspect-ratio: 4 / 3;
        }
        .ig-3 .ig-cell:nth-child(1) { grid-row: 1 / 3; }
        /* 4 images — 2x2 */
        .ig-4 {
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
          aspect-ratio: 1 / 1;
        }
        /* 5 images — top full-width, then 2x2 below */
        .ig-5 {
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1.4fr 1fr 1fr;
          aspect-ratio: 4 / 5;
        }
        .ig-5 .ig-cell:nth-child(1) { grid-column: 1 / 3; }

        @media (max-width: 600px) {
          .ig-1 .ig-cell { max-height: 380px; }
          .ig-1 .ig-cell img { max-height: 380px; }
        }
      `}</style>
    </>
  );
}

function Lightbox({
  imageUrls, startIndex, onClose,
}: { imageUrls: string[]; startIndex: number; onClose: () => void }) {
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        setIndex((i) => Math.min(imageUrls.length - 1, i + 1));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageUrls.length, onClose]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current;
    if (start == null) return;
    const delta = e.changedTouches[0].clientX - start;
    if (Math.abs(delta) > 50) {
      if (delta > 0 && index > 0) setIndex(index - 1);
      else if (delta < 0 && index < imageUrls.length - 1) setIndex(index + 1);
    }
    touchStartX.current = null;
  }

  const hasPrev = index > 0;
  const hasNext = index < imageUrls.length - 1;

  return (
    <div
      className="lb-root"
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      role="dialog"
      aria-modal="true"
    >
      <div className="lb-counter">
        {index + 1} / {imageUrls.length}
      </div>
      <button
        type="button"
        className="lb-close"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Хаах"
      >
        ×
      </button>
      {hasPrev && (
        <button
          type="button"
          className="lb-nav lb-prev"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i - 1); }}
          aria-label="Өмнөх"
        >
          ‹
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          className="lb-nav lb-next"
          onClick={(e) => { e.stopPropagation(); setIndex((i) => i + 1); }}
          aria-label="Дараах"
        >
          ›
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cldFull(imageUrls[index])}
        alt=""
        className="lb-img"
        onClick={(e) => e.stopPropagation()}
      />

      <style>{`
        .lb-root {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.95);
          z-index: 9999;
          display: flex; align-items: center; justify-content: center;
          padding: 1rem;
          animation: lbFade 0.15s ease;
        }
        .lb-img {
          max-width: 95vw; max-height: 95vh;
          object-fit: contain;
          user-select: none;
          -webkit-user-drag: none;
        }
        .lb-counter {
          position: absolute; top: 14px; left: 50%;
          transform: translateX(-50%);
          color: #fff; font-size: 0.88rem; font-weight: 600;
          padding: 0.3rem 0.7rem;
          background: rgba(0,0,0,0.5);
          border-radius: 999px;
          pointer-events: none;
        }
        .lb-close {
          position: absolute; top: 12px; right: 14px;
          width: 40px; height: 40px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 999px;
          color: #fff;
          font-size: 1.6rem; font-weight: 700; line-height: 1;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .lb-close:hover { background: rgba(255,255,255,0.16); }
        .lb-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 50px; height: 50px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 999px;
          color: #fff;
          font-size: 2rem; font-weight: 700; line-height: 1;
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .lb-nav:hover { background: rgba(255,255,255,0.16); }
        .lb-prev { left: 16px; }
        .lb-next { right: 16px; }
        @keyframes lbFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @media (max-width: 600px) {
          .lb-nav { width: 42px; height: 42px; font-size: 1.7rem; }
          .lb-prev { left: 8px; }
          .lb-next { right: 8px; }
        }
      `}</style>
    </div>
  );
}
