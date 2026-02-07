(function () {
  const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;

  function beep(freq, duration, type) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = type || 'sine';
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + duration);
  }

  window.DiceSounds = {
    roll() {
      if (!audioCtx) return;
      beep(120, 0.05, 'square');
      setTimeout(() => beep(180, 0.06, 'square'), 80);
      setTimeout(() => beep(220, 0.07, 'square'), 160);
      setTimeout(() => beep(280, 0.08, 'square'), 240);
    },
    win() {
      if (!audioCtx) return;
      beep(523, 0.1, 'sine');
      setTimeout(() => beep(659, 0.1, 'sine'), 100);
      setTimeout(() => beep(784, 0.15, 'sine'), 200);
    },
    lose() {
      if (!audioCtx) return;
      beep(200, 0.15, 'sine');
      setTimeout(() => beep(160, 0.2, 'sine'), 150);
    },
    newRound() {
      if (!audioCtx) return;
      beep(400, 0.08, 'sine');
      setTimeout(() => beep(500, 0.08, 'sine'), 100);
    },
    gameOver() {
      if (!audioCtx) return;
      beep(523, 0.15, 'sine');
      setTimeout(() => beep(415, 0.15, 'sine'), 150);
      setTimeout(() => beep(523, 0.2, 'sine'), 300);
    }
  };
})();
