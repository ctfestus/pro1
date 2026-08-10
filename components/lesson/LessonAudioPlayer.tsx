'use client';

import { useRef, useState } from 'react';
import { ChevronDown, FastForward, Pause, Play, Rewind, Volume2, VolumeX } from 'lucide-react';

interface LessonAudioPlayerProps {
  src: string;
  title?: string;
  transcript?: string;
  isDark?: boolean;
  accentColor?: string;
  className?: string;
  editorControls?: React.ReactNode;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export function LessonAudioPlayer({ src, title, transcript, isDark = false, accentColor = '#10b981', className = '', editorControls }: LessonAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src) {
    if (!editorControls) return null;
    return (
      <div className={`lesson-audio-player lesson-audio-player--empty ${className}`.trim()} data-theme={isDark ? 'dark' : 'light'} style={{ '--audio-accent': accentColor } as React.CSSProperties}>
        <div className="lesson-audio-player__surface">
          <span className="lesson-audio-player__empty-message">No audio source. Replace or remove this block.</span>
          <div className="lesson-audio-player__editor">{editorControls}</div>
        </div>
      </div>
    );
  }

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); } catch { setFailed(true); }
    } else {
      audio.pause();
    }
  };

  const skip = (amount: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + amount));
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrent(value);
  };

  const changeVolume = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = value;
    audio.muted = value === 0;
    setVolume(value);
    setMuted(value === 0);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  };

  const changeSpeed = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = value;
    setSpeed(value);
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div className={`lesson-audio-player ${className}`.trim()} data-theme={isDark ? 'dark' : 'light'} style={{ '--audio-accent': accentColor } as React.CSSProperties}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadStart={() => { setPlaying(false); setCurrent(0); setDuration(0); setBuffered(0); setFailed(false); }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onProgress={(event) => {
          const audio = event.currentTarget;
          if (audio.buffered.length) setBuffered(audio.buffered.end(audio.buffered.length - 1));
        }}
        onPlay={() => { setPlaying(true); setFailed(false); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      <div className="lesson-audio-player__surface">
        <button type="button" className="lesson-audio-player__icon lesson-audio-player__play" aria-label={playing ? 'Pause audio' : 'Play audio'} onClick={togglePlayback}>{playing ? <Pause width={16} height={16} fill="currentColor" /> : <Play width={16} height={16} fill="currentColor" />}</button>
        <button type="button" className="lesson-audio-player__icon" aria-label="Skip back 10 seconds" title="Back 10 seconds" onClick={() => skip(-10)}><Rewind width={15} height={15} /></button>
        <div className="lesson-audio-player__main">
          <input aria-label="Audio position" className="lesson-audio-player__range" type="range" min={0} max={duration || 0} step={0.1} value={Math.min(current, duration || 0)} onChange={(event) => seek(Number(event.target.value))} style={{ background: `linear-gradient(to right,var(--audio-accent) 0 ${progress}%,var(--audio-buffer) ${progress}% ${Math.max(progress, bufferedProgress)}%,var(--audio-track) ${Math.max(progress, bufferedProgress)}% 100%)` }} />
          <span className="lesson-audio-player__time"><span>{formatTime(current)}</span><span>-{formatTime(Math.max(0, duration - current))}</span></span>
        </div>
        <button type="button" className="lesson-audio-player__icon" aria-label="Skip forward 10 seconds" title="Forward 10 seconds" onClick={() => skip(10)}><FastForward width={15} height={15} /></button>
        <div className="lesson-audio-player__volume">
          <button type="button" className="lesson-audio-player__icon" aria-label={muted ? 'Unmute audio' : 'Mute audio'} onClick={toggleMute}>{muted || volume === 0 ? <VolumeX width={15} height={15} /> : <Volume2 width={15} height={15} />}</button>
          <input aria-label="Volume" className="lesson-audio-player__range lesson-audio-player__volume-range" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => changeVolume(Number(event.target.value))} style={{ background: `linear-gradient(to right,var(--audio-accent) 0 ${(muted ? 0 : volume) * 100}%,var(--audio-track) ${(muted ? 0 : volume) * 100}% 100%)` }} />
        </div>
        <select className="lesson-audio-player__speed" aria-label="Playback speed" value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}>
          {[0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}x</option>)}
        </select>
        {editorControls && <div className="lesson-audio-player__editor">{editorControls}</div>}
      </div>
      {title && <span className="lesson-audio-player__caption">{title}</span>}
      {transcript && (
        <>
          <button type="button" className="lesson-audio-player__transcript-toggle" data-open={transcriptOpen ? 'true' : 'false'} aria-expanded={transcriptOpen} onClick={() => setTranscriptOpen((open) => !open)}>Transcript <ChevronDown width={13} height={13} /></button>
          {transcriptOpen && <div className="lesson-audio-player__transcript">{transcript}</div>}
        </>
      )}
      {failed && <span className="lesson-audio-player__error">This audio could not be played. Check the source and try again.</span>}
    </div>
  );
}
