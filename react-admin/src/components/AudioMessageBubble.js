import React, { useState, useRef, useEffect } from 'react';

/**
 * Audio Message Bubble for Admin Panel
 * Displays voice messages with real waveform from audioWaveform array
 */
function AudioMessageBubble({ message }) {
    const audioRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [speed, setSpeed] = useState(1);

    const duration = message.audioDuration || Number(message.content) || 0;
    const waveform = Array.isArray(message.audioWaveform) && message.audioWaveform.length > 0
        ? message.audioWaveform
        : Array.from({ length: 40 }, (_, i) => 0.2 + ((Math.sin(i * 1.7) + 1) / 2) * 0.7);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleTime = () => {
            if (audio.duration > 0) {
                setProgress(audio.currentTime / audio.duration);
                setCurrentTime(audio.currentTime);
            }
        };
        const handleEnd = () => {
            setIsPlaying(false);
            setProgress(0);
            setCurrentTime(0);
        };
        audio.addEventListener('timeupdate', handleTime);
        audio.addEventListener('ended', handleEnd);
        return () => {
            audio.removeEventListener('timeupdate', handleTime);
            audio.removeEventListener('ended', handleEnd);
        };
    }, []);

    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
            setIsPlaying(false);
        } else {
            audio.playbackRate = speed;
            audio.play();
            setIsPlaying(true);
        }
    };

    const cycleSpeed = (e) => {
        e.stopPropagation();
        const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
        setSpeed(next);
        if (audioRef.current) audioRef.current.playbackRate = next;
    };

    const formatTime = (s) => {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    // Sample waveform to ~40 bars
    const barCount = 40;
    const step = Math.max(1, Math.floor(waveform.length / barCount));
    const sampled = [];
    for (let i = 0; i < waveform.length && sampled.length < barCount; i += step) {
        sampled.push(waveform[i]);
    }

    return (
        <div className="audio-message-bubble">
            <audio ref={audioRef} src={message.mediaUrl} preload="metadata" />

            <button className="audio-play-btn" onClick={togglePlay}>
                {isPlaying ? '⏸' : '▶'}
            </button>

            <div className="audio-content">
                <div className="audio-waveform">
                    {sampled.map((level, i) => {
                        const filled = (i / sampled.length) <= progress;
                        const h = Math.max(4, Math.min(28, level * 28));
                        return (
                            <div
                                key={i}
                                className={'waveform-bar' + (filled ? ' filled' : '')}
                                style={{ height: `${h}px` }}
                            />
                        );
                    })}
                </div>
                <div className="audio-meta">
                    <span className="audio-duration">
                        {isPlaying ? formatTime(currentTime) : formatTime(duration)}
                    </span>
                    <button className="audio-speed-btn" onClick={cycleSpeed}>
                        {speed}×
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AudioMessageBubble;
