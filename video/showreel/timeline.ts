// Import-free cue clock for the showreel teaser. Picture, score and tests read
// this one file. 24 bars of 4/4 at 128 BPM are exactly 45 seconds: 1,350 frames.
const fps = 30, bpm = 128, bars = 24, beatFrames = fps * 60 / bpm;
// A beat is 14.0625 frames. Cues are whole frames; audio rounds the same way.
const at = (beat: number) => Math.round(beat * beatFrames);

export const timeline = {
  id: 'showreel',
  title: 'Event Runner showreel teaser',
  fps, bpm, bars, beatFrames,
  duration: 1350,
  seed: 20261110,
  // The layout is complete and at rest from this frame. One blink follows.
  settle: at(89),
  // Half a beat with no sound before the title chord.
  silence: [at(79.5), at(80)],
  scenes: [
    { id: 'open', start: 0, end: at(8) },
    { id: 'plan', start: at(8), end: at(24) },
    { id: 'shape', start: at(24), end: at(40) },
    { id: 'gather', start: at(40), end: at(56) },
    { id: 'stack', start: at(56), end: at(72) },
    { id: 'montage', start: at(72), end: at(80) },
    { id: 'title', start: at(80), end: 1350 },
  ],
  cues: {
    open: { eyes: [at(0), at(1)], smile: at(2), badge: at(3), lanyard: at(4), windup: at(5), dash: at(7) },
    plan: {
      word: at(8), cards: [at(9), at(9.5), at(10), at(10.5)], push: at(12),
      speakers: [at(13), at(13.5)], lift: at(16), drop: at(18), publish: at(20), wipe: at(22),
    },
    shape: { styles: [at(24), at(26), at(28), at(30), at(32), at(34)], dark: at(36), wall: at(38), exit: at(39) },
    gather: {
      ticket: at(40), steps: [at(41.5), at(42), at(42.5), at(43), at(43.5)], tear: at(44),
      checkIn: [at(45), at(48)], bookmarks: [at(48), at(49), at(50)], arrivals: [at(49), at(50), at(51)],
      send: at(52), delivered: [at(53), at(55)],
    },
    stack: {
      explode: at(56), callouts: [at(57), at(58), at(59), at(60), at(61)],
      compress: [at(64), at(65), at(66), at(67)], merge: at(68), riser: [at(68), at(72)], line: at(69),
    },
    montage: { panels: [at(72), at(73), at(74), at(75), at(76), at(77), at(78), at(79)], pull: at(78.5), implode: at(79.5) },
    title: {
      impact: at(80), land: at(82), wordmark: at(82), tagline: at(84),
      words: [at(86), at(87), at(88)], url: at(88.5), blink: at(92),
    },
  },
};
export type Timeline = typeof timeline;
