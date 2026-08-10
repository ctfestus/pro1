'use client';

// Responsive lesson image with authoring controls for layout, accessibility,
// replacement, real image cropping, and an optional learner lightbox.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from '@tiptap/extension-image';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Crop, Expand, Replace, RotateCcw, X } from 'lucide-react';
import { ImageLibrary } from '@/components/ImageLibrary';
import { ImageCropModal } from '@/components/ImageCropModal';
import {
  ColorField, Segmented, StyleMenu, MenuRow, BORDER_STYLE_OPTIONS, borderCss, type BorderStyle,
} from '@/components/lesson/nodes/StyleControls';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { deleteFromCloudinary, isCloudinaryUrl, uploadToCloudinary } from '@/lib/uploadToCloudinary';

type Align = 'left' | 'center' | 'right';
type Size = 'small' | 'medium' | 'full';
type Frame = 'original' | 'wide' | 'landscape' | 'square';

const SIZE_MAX: Record<Size, string> = { small: '320px', medium: '480px', full: '100%' };
const FRAME_RATIO: Record<Frame, string | undefined> = { original: undefined, wide: '16 / 9', landscape: '4 / 3', square: '1 / 1' };
const CROP_OPTIONS = [
  { label: 'Free', value: 'free' as const },
  { label: 'Square', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:4', value: 3 / 4 },
];

function frameFromAspect(aspect: number): Frame {
  if (Math.abs(aspect - 1) < 0.01) return 'square';
  if (Math.abs(aspect - (16 / 9)) < 0.01) return 'wide';
  if (Math.abs(aspect - (4 / 3)) < 0.01) return 'landscape';
  return 'original';
}

function cropAspectForFrame(frame: Frame) {
  if (frame === 'wide') return 16 / 9;
  if (frame === 'landscape') return 4 / 3;
  return 1;
}

function ImageView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const src = node.attrs.src as string;
  const alt = (node.attrs.alt as string) || '';
  const align = (node.attrs.align as Align) || 'center';
  const size = (node.attrs.size as Size) || 'full';
  const caption = (node.attrs.caption as string) || '';
  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'none';
  const borderColor = (node.attrs.borderColor as string) || '';
  const rounded = node.attrs.rounded !== false;
  const frame = (node.attrs.frame as Frame) || 'original';
  const expandable = node.attrs.expandable === true;
  const originalSrc = (node.attrs.originalSrc as string) || '';
  const cropSource = originalSrc || src;
  const [showLibrary, setShowLibrary] = useState(false);
  const [showCrop, setShowCrop] = useState(false);
  const [cropError, setCropError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const alignItems = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const mediaStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: SIZE_MAX[size],
    ...(FRAME_RATIO[frame] ? { aspectRatio: FRAME_RATIO[frame] } : {}),
  };
  const imageStyle: React.CSSProperties = {
    width: '100%',
    height: frame === 'original' ? 'auto' : '100%',
    objectFit: frame === 'original' ? undefined : 'cover',
    borderRadius: rounded ? 12 : 0,
    ...borderCss(borderStyle, borderColor, '#e4e4e7'),
    ...(borderStyle !== 'none' ? { padding: 3 } : {}),
  };

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [expanded]);

  const applyCrop = async (blob: Blob, aspect: number) => {
    setCropError('');
    try {
      const previousCrop = src && src !== cropSource ? src : '';
      const url = await uploadToCloudinary(new File([blob], 'lesson-image-crop.png', { type: blob.type || 'image/png' }), 'lesson-images');
      updateAttributes({ src: url, originalSrc: cropSource, frame: frameFromAspect(aspect) });
      if (previousCrop && isCloudinaryUrl(previousCrop)) void deleteFromCloudinary(previousCrop);
      setShowCrop(false);
    } catch (error) {
      setCropError((error as Error).message || 'Could not save the cropped image.');
      setShowCrop(false);
    }
  };

  const renderedImage = <img src={src} alt={alt} draggable={false} style={imageStyle} />;

  return (
    <NodeViewWrapper className="lesson-image" style={{ display: 'flex', flexDirection: 'column', alignItems }}>
      <div className="lesson-image__media" style={mediaStyle}>
        {editable && (
          <div className="lesson-block-corner lesson-image__controls" contentEditable={false}>
            <button type="button" className="lesson-image__control" aria-label="Replace image" title="Replace image" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowLibrary(true)}><Replace width={14} height={14} /></button>
            <button type="button" className="lesson-image__control" aria-label="Crop image" title="Crop image" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowCrop(true)}><Crop width={14} height={14} /></button>
            {originalSrc && src !== originalSrc && <button type="button" className="lesson-image__control" aria-label="Restore original image" title="Restore original" onMouseDown={(event) => event.preventDefault()} onClick={() => { const croppedSrc = src; updateAttributes({ src: originalSrc, frame: 'original' }); if (isCloudinaryUrl(croppedSrc)) void deleteFromCloudinary(croppedSrc); }}><RotateCcw width={14} height={14} /></button>}
            <StyleMenu>
              <MenuRow label="Align">
                <Segmented<Align> value={align} onChange={(value) => updateAttributes({ align: value })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
              </MenuRow>
              <MenuRow label="Size">
                <Segmented<Size> value={size} onChange={(value) => updateAttributes({ size: value })} options={[{ value: 'small', label: 'S' }, { value: 'medium', label: 'M' }, { value: 'full', label: 'Full' }]} />
              </MenuRow>
              <MenuRow label="Frame">
                <Segmented<Frame> value={frame} onChange={(value) => updateAttributes({ frame: value })} options={[{ value: 'original', label: 'Original' }, { value: 'wide', label: '16:9' }, { value: 'landscape', label: '4:3' }, { value: 'square', label: 'Square' }]} />
              </MenuRow>
              <MenuRow label="Corners">
                <Segmented<'rounded' | 'square'> value={rounded ? 'rounded' : 'square'} onChange={(value) => updateAttributes({ rounded: value === 'rounded' })} options={[{ value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} />
              </MenuRow>
              <MenuRow label="Border">
                <Segmented<BorderStyle> value={borderStyle} onChange={(value) => updateAttributes({ borderStyle: value })} options={BORDER_STYLE_OPTIONS} />
              </MenuRow>
              {borderStyle !== 'none' && <MenuRow label="Color"><ColorField value={borderColor} onChange={(value) => updateAttributes({ borderColor: value })} /></MenuRow>}
              <MenuRow label="Alt text"><NodeTextInput className="lesson-image__alt-input" value={alt} placeholder="Describe the image" onCommit={(value) => updateAttributes({ alt: value })} /></MenuRow>
              <MenuRow label="Click to expand">
                <Segmented<'on' | 'off'> value={expandable ? 'on' : 'off'} onChange={(value) => updateAttributes({ expandable: value === 'on' })} options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} />
              </MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="image" />
          </div>
        )}

        {!editable && expandable ? (
          <button type="button" className="lesson-image__expand" aria-label="Expand image" onClick={() => setExpanded(true)}>{renderedImage}<span><Expand width={14} height={14} /> Expand</span></button>
        ) : renderedImage}
      </div>

      {editable ? (
        <div className="lesson-image__caption-editor" style={{ maxWidth: SIZE_MAX[size] }}>
          <NodeTextInput className="lesson-image__caption-input" value={caption} placeholder="Add a caption (optional)" onCommit={(value) => updateAttributes({ caption: value })} />
        </div>
      ) : caption ? (
        <figcaption className="lesson-image__caption" style={{ maxWidth: SIZE_MAX[size] }}>{caption}</figcaption>
      ) : null}

      {editable && cropError && <span className="lesson-image__error" contentEditable={false}>{cropError}</span>}
      {showLibrary && (
        <ImageLibrary uploadFolder="lesson-images" initialFolder="lesson-images" onSelect={(url) => { const previousCrop = originalSrc && src !== originalSrc ? src : ''; updateAttributes({ src: url, originalSrc: url, frame: 'original' }); if (previousCrop && isCloudinaryUrl(previousCrop)) void deleteFromCloudinary(previousCrop); setCropError(''); setShowLibrary(false); }} onClose={() => setShowLibrary(false)} />
      )}
      {showCrop && (
        <ImageCropModal src={cropSource} aspect={cropAspectForFrame(frame)} aspectOptions={CROP_OPTIONS} shape="rect" title="Crop lesson image" onConfirm={applyCrop} onCancel={() => setShowCrop(false)} />
      )}
      {!editable && expanded && createPortal(
        <div className="lesson-image-lightbox" role="dialog" aria-modal="true" aria-label={alt || 'Expanded lesson image'} onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
          <button type="button" className="lesson-image-lightbox__close" aria-label="Close expanded image" onClick={() => setExpanded(false)}><X width={18} height={18} /></button>
          <img src={src} alt={alt} />
          {caption && <p>{caption}</p>}
        </div>,
        document.body,
      )}
    </NodeViewWrapper>
  );
}

export const LessonImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: { default: 'center' },
      size: { default: 'full' },
      caption: { default: '' },
      borderStyle: { default: 'none' },
      borderColor: { default: '' },
      rounded: { default: true },
      frame: { default: 'original' },
      expandable: { default: false },
      originalSrc: { default: '' },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
