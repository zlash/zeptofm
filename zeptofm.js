/*


# ZeptoFM
 
 Instruments and patterns created with code. Easier for procedural stuff and shouldn't affect final size too much thanks to minifier.
 Pre rendered instruments, realtime patterns
 Intended for use with a minifier. Not golfed or anything.
 Practically no error checking


 A number is a "DC offset" sampler. It returns always itself.
 An array is treated as a "multiply" sampler. It multiplies all its members.
*/

"use strict";

let outputSamplingRate = 44100;
let globalSampleCounter = 0;

// Remove or comment functions here if you provide implementations from other parts of your code.

const Min = (a, b) => a < b ? a : b;
const Max = (a, b) => a < b ? b : a;
const Clamp = (a, b, x) => Min(Max(x, a), b);
const Mix = (a, b, x) => (1 - x) * a + x * b;
const InvMix = (x, a, b) => (x - a) / (b - a);
const InvMixClamped = (x, a, b) => Clamp(0, 1, InvMix(x, a, b));
const Remap = (x, a, b, aa, bb) => Mix(aa, bb, InvMix(x, a, b));
const RemapClamped = (x, a, b, aa, bb) => Mix(aa, bb, InvMixClamped(x, a, b));
const Sin = Math.sin;
const Cos = Math.cos;
const Pi = Math.PI;
const Pow = Math.pow;
const Abs = Math.abs;
const Floor = Math.floor;
const Fract = (x) => x - Floor(x);

// Random between a and b
const Random = (a, b) => Mix(a, b, Math.random());


const Sample = (sampler) => {
    if (typeof (sampler) == "number") {
        return sampler;
    }
    if (sampler instanceof Array) {
        return sampler.reduce((accum, cur) => accum * Sample(cur), 1);
    }
    const lastSampledTs = sampler.lastSampledTimestamp ?? -1;
    if (lastSampledTs < globalSampleCounter) {
        sampler.time = sampler.time ?? 0;
        sampler.lastSample = sampler(sampler);
        sampler.time += 1 / outputSamplingRate;
        sampler.lastSampledTimestamp = globalSampleCounter;
    }
    return sampler.lastSample;
};

/*
function AsmModule(stdlib, foreign, buffer) {
    "use asm";

    var s = stdlib.Math.sin;

    function bandlimitedWave() {
        var i = 0, a = 0, t = 0, o = 0;
        for (; i | 0 < 6; i = (i + 1) | 0) {
            o = (2 * i) | 0 + 1;
            t = i | 0 == 0 ? 1 : -1;
        }
        return a | 0;
    }

    return { bandlimitedWave: bandlimitedWave };
}

const asmModule = AsmModule(window, null, new ArrayBuffer(0x100000));
*/


// Types: "s"ine, s"q"uare, "t"riangle, sa"w"tooth, "n"o band limited square,
// Non-sine waves are band limited by additive synthesis by default
// (Maybe try BLIT to be able to change duty cycles and better performance)
const Oscillator = (type, freq, sync) => {
    let phase = 0;
    let prevSync = 0;

    const BandlimitedWave = (f) => {
        let i = 0, a = 0;
        for (; i < 6; ++i) {
            const oddHarmNumber = 2 * i + 1;
            const alternating = i == 0 ? 1 : -1;
            if (type == "q") {
                a += Sin(oddHarmNumber * f) / oddHarmNumber;
            } else if (type == "t") {
                a += alternating * Sin(oddHarmNumber * f) / (oddHarmNumber * oddHarmNumber);
            } else if (type == "t") {
                a += alternating * Sin(i * f) / (i + 1);
            }
        }
        return a;
    };

    return () => {
        const curSync = sync ? (Sample(sync) == 1 ? 1 : 0) : 0;
        if (curSync > prevSync) {
            phase = 0;
        }
        prevSync = curSync;
        const out = type == "n" ? (Floor(Fract(phase) * 2) * 2 - 1) : ((type == "s" ? Sin : BandlimitedWave)(phase * 2 * Pi));
        phase += Sample(freq) / outputSamplingRate;
        return out;
    };
};

const Noise = () => {
    return () => Random(-1, 1);
};


// Frequency is not a sampler! Just a number. Can't be modified during playing
const KarplusStrong = (freq, initialAmplitude) => {
    const N = (outputSamplingRate / freq) | 0;
    let buffer = new Float32Array(Array.from(Array(N), () => Random(-1, 1) * initialAmplitude));
    return () => {
        const pos = globalSampleCounter % N;
        const out = buffer[pos];
        buffer[pos] = (out + buffer[(pos + 1) % N] + buffer[(pos + 2) % N]) / 3;
        return out;
    };
};

const ADSR = (heldDuration, aTime, dTime, sLvl, rTime) => {
    const releaseTime = Max(heldDuration, aTime + dTime);
    return (sampler) => {
        const t = sampler.time;
        const A = InvMixClamped(t, 0, aTime);
        const SR = sLvl * (1 - InvMixClamped(t, releaseTime, releaseTime + rTime));
        const D = RemapClamped(t, aTime, aTime + dTime, A, SR);
        return D;
    };
};


/*
Types: `l`owpass, `h`i-pass

Parameters for specializations from: 
https://shepazu.github.io/Audio-EQ-Cookbook/audio-eq-cookbook.html

*/
const BiQuadFilter = (src, type, centerFreqSampler, paramSampler) => {
    let x0 = 0, x1 = 0;
    let y0 = 0, y1 = 0;
    return () => {
        const sample = Sample(src);
        const centerFreq = Sample(centerFreqSampler);
        const param = Sample(paramSampler);
        let a0, a1, a2, b0, b1, b2;

        const w0 = 2 * Pi * centerFreq / outputSamplingRate;
        const cosW0 = Cos(w0);
        const sinW0 = Sin(w0);

        // Form param type Q 
        let alpha = param == 0 ? 0 : sinW0 / (2 * param);

        // Low/Hi=pass
        const lhpfSign = type == "h" ? 1 : -1;
        b0 = (1 + lhpfSign * cosW0) / 2;
        b1 = -lhpfSign - cosW0;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cosW0;
        a2 = 1 - alpha;

        const out = Clamp(-1, 1, b0 / a0 * sample + b1 / a0 * x0 + b2 / a0 * x1 - a1 / a0 * y0 - a2 / a0 * y1);

        x1 = x0;
        x0 = sample;
        y1 = y0;
        y0 = out;

        return out;
    };
};

const AddSamplers = (...samplers) => {
    return () => samplers.reduce((accum, cur) => accum + Sample(cur), 0);
};

const SemistepsFactor = semis => Pow(2, semis / 12);

/*
Returns an AudioBufferSourceNode with content generated from `sampler`.
Sampler is called once for each sample without parameters and must return the current sample.
*/
const RenderSampler = (audioCtx, sampler, duration) => {
    globalSampleCounter = 0;
    const samples = new Float32Array(outputSamplingRate * duration);
    for (let i = 0; i < samples.length; ++i) {
        samples[i] = Sample(sampler);
        ++globalSampleCounter;
    }
    const buffer = audioCtx.createBuffer(1, samples.length, outputSamplingRate);
    buffer.copyToChannel(samples, 0);
    return buffer;
};

const NoteNumberToFreq = note => Pow(2, (note - 69) / 12) * 440;

/*
    RenderInstrument takes an `instrumentSampler` which is a function with the signature
    (frequency, noteNumber) => sampler
    The result is an array with 128 elements, one from each note (indexed using MIDI tuning standard
    that puts A440 at 69), each points to a buffer and a speed adjustment. 
    The buffers will be repeated when samples are not rendered
    but the speed will be corrected so it plays at the frequency expected for that note
    position.
    Use start, end, increment to determine the range of notes to render. (start and end are fractional octaves)
    Notes outside the range will be played resampling the rendered notes.
*/
const RenderInstrument = (audioCtx, instrumentSampler, noteRenderDuration, start, end, increment) => {
    let notes = [];

    for (let i = (start * 12) | 0; i <= (end * 12) | 0; i += increment) {
        // Third element set to true to mark as a "true" sample when searching for closest matches
        notes[i] = [RenderSampler(audioCtx, instrumentSampler(NoteNumberToFreq(i), i), noteRenderDuration), 1, true];
    }

    for (let i = 0; i < 128; ++i) {
        if (!notes[i]) {
            let closest = -1;
            let closestDist = 200;
            for (let j = 0; j < 128; ++j) {
                const dist = Abs(i - j);
                if ((notes[j] ?? [])[2] && dist < closestDist) {
                    closest = j;
                    closestDist = dist;
                }
            }
            notes[i] = [notes[closest][0], NoteNumberToFreq(i) / NoteNumberToFreq(closest)];
        }
    }
    return notes;
};

const PlayNote = (audioCtx, dest, renderedInstrument, i, when) => {
    const n = renderedInstrument[i];
    const source = audioCtx.createBufferSource();
    source.buffer = n[0];
    source.connect(dest);
    source.playbackRate.value = n[1];
    source.start(when);
}

/*
    A sequence is a string similar to MML
    renderedInstrument is a rendered instrument that will be used with PlayNote
    Letters from "a" to "g" set the note. Use # to for sharp
    "r" means a rest
    A number after a note or a rest sets the current note duration denominator (ie  4 = 1/4)
    "o" followed by a number sets the octave
    ">" and "<" raises and lowers octave
    "t" followed by a number sets BPM
    "v" followed by a number sets volume (0 to 10)

    Returns a function that must be called periodically to schedule new beats in the sound context
*/

const eventsSchedulingLookaheadSeconds = 50.5;

const PseudoMMLSequencer = (audioCtx, renderedInstrument, sequence, trackGain) => {
    let bpm = 120;
    let octave = 4;
    let noteValue = 4;
    let volume = 10;

    const getCommand = () => {
        const commands = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b", "r", "o", ">", "<", "t", "v"];
        const cmd = commands.findLastIndex(x => sequence.startsWith(x));
        sequence = sequence.slice((commands[cmd] ?? "").length);
        return cmd;
    };

    const getNumber = () => {
        const n = parseInt(sequence, 10);
        if (isNaN(n)) {
            return null;
        }
        sequence = sequence.slice(`${n}`.length);
        return n;
    };

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = trackGain;
    gainNode.connect(audioCtx.destination);

    let currentTimestamp;

    return () => {
        const curTime = audioCtx.currentTime;
        currentTimestamp = currentTimestamp ?? curTime;
        let lookaheadTimestamp = curTime + eventsSchedulingLookaheadSeconds;
        while (sequence != "" && currentTimestamp <= lookaheadTimestamp) {
            let cmd = getCommand();
            if (cmd < 0) return;

            if (cmd <= 12) {
                if (cmd == 12) {
                    // Rest
                } else {
                    PlayNote(audioCtx, gainNode, renderedInstrument, 12 * octave + cmd, currentTimestamp);
                }

                const newNoteValue = getNumber();
                if (newNoteValue) {
                    noteValue = newNoteValue;
                }


                currentTimestamp += 240 / (bpm * noteValue);
            }

            switch (cmd) {
                case 13: //o
                    octave = getNumber();
                    break;
                case 14: //">"
                    ++octave;
                    break;
                case 15: //"<"
                    --octave;
                    break;
                case 16: //t
                    bpm = getNumber();
                    break;
                case 17://volume
                    volume = getNumber();
                    gainNode.gain.setValueAtTime(trackGain * volume / 10, currentTimestamp);
                    break;
            }
        }
        /*Grab commands. While commands' timestamps are less than current+window*/
    };

};