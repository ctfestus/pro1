'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, MediaSize, Size } from 'react-easy-crop';
import { X } from 'lucide-react';

interface Props {
  src: string;
  aspect?: number;       // width/height -- default 1 (square)
  aspectOptions?: { label: string; value: number | 'free' }[];
  shape?: 'rect' | 'round';
  title?: string;
  onConfirm: (blob: Blob, aspect: number) => void | Promise<void>;
  onCancel: () => void;
}

async function getCroppedBlob(imageSrc: string, area: Area): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = imageSrc;
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; });
  const canvas = document.createElement('canvas');
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('Canvas toBlob failed')), 'image/png')
  );
}

export function ImageCropModal({ src, aspect = 1, aspectOptions, shape = 'round', title = 'Crop image', onConfirm, onCancel }: Props) {
  const cropAreaRef = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedAspect, setSelectedAspect] = useState<number | 'free'>(aspect);
  const [freeCropSize, setFreeCropSize] = useState({ width: 240, height: 180 });
  const [viewportSize, setViewportSize] = useState({ width: 440, height: 320 });
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [automaticCropSize, setAutomaticCropSize] = useState<Size | null>(null);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedArea(pixels);
  }, []);

  useEffect(() => {
    const element = cropAreaRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      setViewportSize(next);
      setFreeCropSize((current) => ({
        width: Math.min(current.width, Math.max(80, next.width)),
        height: Math.min(current.height, Math.max(80, next.height)),
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const freeMaxWidth = Math.max(80, Math.min(viewportSize.width, mediaSize?.width ?? viewportSize.width));
  const freeMaxHeight = Math.max(80, Math.min(viewportSize.height, mediaSize?.height ?? viewportSize.height));

  useEffect(() => {
    setFreeCropSize((current) => ({
      width: Math.min(current.width, freeMaxWidth),
      height: Math.min(current.height, freeMaxHeight),
    }));
  }, [freeMaxHeight, freeMaxWidth]);

  const resizeFreeCrop = (event: React.PointerEvent, horizontal: -1 | 1, vertical: -1 | 1) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLButtonElement;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const start = { x: event.clientX, y: event.clientY, ...freeCropSize };
    const move = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      const width = Math.max(80, Math.min(freeMaxWidth, start.width + ((pointerEvent.clientX - start.x) * horizontal * 2)));
      const height = Math.max(80, Math.min(freeMaxHeight, start.height + ((pointerEvent.clientY - start.y) * vertical * 2)));
      setFreeCropSize({ width, height });
    };
    const stop = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const activeAspect = selectedAspect === 'free' ? freeCropSize.width / freeCropSize.height : selectedAspect;
  const activeCropSize = selectedAspect === 'free' ? freeCropSize : automaticCropSize;
  const minimumZoom = mediaSize && activeCropSize
    ? Math.max(1, activeCropSize.width / mediaSize.width, activeCropSize.height / mediaSize.height)
    : 1;
  const maximumZoom = Math.max(3, minimumZoom * 1.75);

  useEffect(() => {
    setZoom((current) => Math.max(current, minimumZoom));
  }, [minimumZoom]);

  const handleConfirm = async () => {
    if (!croppedArea) return;
    setProcessing(true);
    try {
      const blob = await getCroppedBlob(src, croppedArea);
      await onConfirm(blob, activeAspect);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onPointerDown={event => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div style={{
        background: '#1c1c1c', borderRadius: 20, width: '100%', maxWidth: 440,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0' }}>{title}</span>
          <button onClick={onCancel} aria-label="Close crop editor" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', lineHeight: 1, padding: 4 }}><X width={18} height={18} /></button>
        </div>

        {/* Crop area */}
        <div ref={cropAreaRef} style={{ position: 'relative', width: '100%', height: 320, background: '#111' }}>
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            minZoom={minimumZoom}
            maxZoom={maximumZoom}
            aspect={activeAspect}
            cropSize={selectedAspect === 'free' ? freeCropSize : undefined}
            cropShape={shape}
            objectFit="contain"
            restrictPosition
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            onCropSizeChange={setAutomaticCropSize}
            onMediaLoaded={setMediaSize}
          />
          {selectedAspect === 'free' && (
            <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: freeCropSize.width, height: freeCropSize.height, transform: 'translate(-50%, -50%)', border: '1px solid rgba(255,255,255,0.9)', pointerEvents: 'none', boxSizing: 'border-box' }}>
              {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([horizontal, vertical]) => (
                <button
                  key={`${horizontal}-${vertical}`}
                  type="button"
                  tabIndex={-1}
                  onPointerDown={(event) => resizeFreeCrop(event, horizontal, vertical)}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                  style={{ position: 'absolute', left: horizontal < 0 ? (freeCropSize.width >= freeMaxWidth - 0.5 ? 0 : -7) : 'auto', right: horizontal > 0 ? (freeCropSize.width >= freeMaxWidth - 0.5 ? 0 : -7) : 'auto', top: vertical < 0 ? (freeCropSize.height >= freeMaxHeight - 0.5 ? 0 : -7) : 'auto', bottom: vertical > 0 ? (freeCropSize.height >= freeMaxHeight - 0.5 ? 0 : -7) : 'auto', width: 14, height: 14, padding: 0, border: '2px solid #111', borderRadius: 4, background: '#fff', cursor: `${vertical < 0 ? 'n' : 's'}${horizontal < 0 ? 'w' : 'e'}-resize`, pointerEvents: 'auto', touchAction: 'none' }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {aspectOptions && aspectOptions.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11, color: '#888', width: 36, flexShrink: 0 }}>Ratio</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {aspectOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setSelectedAspect(option.value)}
                    style={{ padding: '5px 8px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: selectedAspect === option.value ? '#fff' : '#aaa', background: selectedAspect === option.value ? '#10b981' : 'rgba(255,255,255,0.06)' }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Zoom slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: '#888', width: 36, flexShrink: 0 }}>Zoom</span>
            <input
              type="range"
              min={minimumZoom}
              max={maximumZoom}
              step={0.01}
              value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#10b981' }}
            />
            <span style={{ fontSize: 11, color: '#888', width: 32, textAlign: 'right', flexShrink: 0 }}>{zoom.toFixed(1)}x</span>
          </div>

          {/* Hint */}
          <p style={{ fontSize: 11, color: '#777', margin: 0 }}>Drag to reposition | pinch or scroll to zoom</p>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={onCancel}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#aaa' }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={processing}
              style={{ flex: 2, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: processing ? 'wait' : 'pointer', background: '#10b981', border: 'none', color: '#fff', opacity: processing ? 0.6 : 1 }}
            >
              {processing ? 'Applying...' : 'Apply crop'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
