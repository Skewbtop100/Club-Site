'use client';

import { useState } from 'react';
import { cldVideo } from '@/lib/cloudinary';
import { embedUrlForStored, type VideoType } from '@/lib/community/video-utils';

interface Props {
  videoUrl: string;
  videoType: VideoType;
  videoThumbnail?: string;
}

export default function VideoPlayer({ videoUrl, videoType, videoThumbnail }: Props) {
  const [iframeOpen, setIframeOpen] = useState(false);

  if (videoType === 'cloudinary') {
    return (
      <video
        src={cldVideo(videoUrl)}
        poster={videoThumbnail || undefined}
        controls
        playsInline
        preload="metadata"
        className="vp-cld"
      >
        <style>{`
          .vp-cld {
            width: 100%;
            max-height: 500px;
            border-radius: 10px;
            background: #000;
            display: block;
          }
        `}</style>
      </video>
    );
  }

  // YouTube + Vimeo: lazy iframe — show thumbnail/branded block until clicked.
  const embedUrl = embedUrlForStored(videoUrl, videoType);

  if (iframeOpen && embedUrl) {
    const sep = embedUrl.includes('?') ? '&' : '?';
    return (
      <div className="vp-frame-wrap">
        <iframe
          src={`${embedUrl}${sep}autoplay=1`}
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          className="vp-frame"
        />
        <style>{`
          .vp-frame-wrap {
            position: relative;
            padding-bottom: 56.25%;
            height: 0;
            border-radius: 10px;
            overflow: hidden;
            background: #000;
          }
          .vp-frame {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            border: 0;
          }
        `}</style>
      </div>
    );
  }

  // Vimeo with no thumbnail → branded block; YouTube → real thumbnail.
  const isVimeo = videoType === 'vimeo';
  return (
    <button
      type="button"
      className={`vp-poster${isVimeo ? ' vp-poster-vimeo' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIframeOpen(true);
      }}
      aria-label="Бичлэг тоглуулах"
      disabled={!embedUrl}
    >
      {isVimeo ? (
        <span className="vp-vimeo-mark">Vimeo</span>
      ) : videoThumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={videoThumbnail} alt="" className="vp-poster-img" loading="lazy" />
      ) : null}
      <span className="vp-play" aria-hidden>▶</span>
      {videoType === 'youtube' && <span className="vp-yt" aria-hidden>YouTube</span>}

      <style>{`
        .vp-poster {
          position: relative;
          display: block;
          width: 100%;
          padding: 0; margin: 0;
          aspect-ratio: 16 / 9;
          border: none;
          border-radius: 10px;
          overflow: hidden;
          background: #000;
          cursor: pointer;
        }
        .vp-poster-vimeo { background: #1ab7ea; }
        .vp-poster-img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
        }
        .vp-play {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 60px; height: 60px;
          border-radius: 999px;
          background: rgba(255,255,255,0.95);
          color: #111;
          display: inline-flex; align-items: center; justify-content: center;
          font-size: 1.5rem;
          padding-left: 4px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.4);
        }
        .vp-poster:hover .vp-play { background: #fff; }
        .vp-yt {
          position: absolute;
          bottom: 8px; left: 8px;
          background: #ff0000;
          color: #fff;
          font-size: 0.66rem; font-weight: 800;
          padding: 0.18rem 0.42rem;
          border-radius: 3px;
          letter-spacing: 0.04em;
        }
        .vp-vimeo-mark {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          color: #fff; font-weight: 800;
          font-size: 1.6rem; letter-spacing: 0.04em;
          opacity: 0.55;
        }
      `}</style>
    </button>
  );
}
