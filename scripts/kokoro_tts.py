#!/usr/bin/env python3
"""Kokoro TTS CLI bridge for ClawBench.
Reads text from stdin, writes WAV audio to the specified output file.

Supports both v1.0 (English) and v1.1-zh (Chinese) ONNX models.
Auto-detects model version and patches kokoro-onnx speed dtype bug for v1.1.

Usage: echo "text" | kokoro_tts.py --model <onnx_path> --voices <voices_bin> --voice <voice> --output <wav_path> [--lang <lang>] [--speed <speed>]
"""
import argparse
import sys
import time

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro, MAX_PHONEME_LENGTH, SAMPLE_RATE


def patched_create_audio(kokoro, phonemes, voice, speed):
    """Fixed _create_audio that uses float32 speed for v1.1 models.

    kokoro-onnx 0.5.0 has a bug: when model uses 'input_ids' input,
    it sets speed dtype to int32, but v1.1 models expect float32.
    """
    if len(phonemes) > MAX_PHONEME_LENGTH:
        phonemes = phonemes[:MAX_PHONEME_LENGTH]

    start_t = time.time()
    tokens = np.array(kokoro.tokenizer.tokenize(phonemes), dtype=np.int64)
    voice_data = voice[len(tokens)]
    tokens_arr = [[0, *tokens, 0]]

    inputs = {
        "input_ids": tokens_arr,
        "style": np.array(voice_data, dtype=np.float32).reshape(1, 256),
        "speed": np.array([speed], dtype=np.float32),  # Fix: float32, not int32
    }

    audio = kokoro.sess.run(None, inputs)[0]
    return audio, SAMPLE_RATE


def main():
    parser = argparse.ArgumentParser(description="Kokoro TTS synthesis")
    parser.add_argument("--model", required=True, help="Path to kokoro ONNX model file")
    parser.add_argument("--voices", required=True, help="Path to voices bin/npz file")
    parser.add_argument("--voice", required=True, help="Voice name (e.g. zf_001, zm_010, zf_xiaobei)")
    parser.add_argument("--output", required=True, help="Output WAV file path")
    parser.add_argument("--lang", default="cmn", help="Language code (default: cmn for Mandarin Chinese)")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed multiplier (default: 1.0)")
    args = parser.parse_args()

    # Read text from stdin
    text = sys.stdin.read().strip()
    if not text:
        print("Error: no text provided on stdin", file=sys.stderr)
        sys.exit(1)

    # Initialize Kokoro
    kokoro = Kokoro(args.model, args.voices)

    # Check if model uses 'input_ids' (v1.1+) and needs the speed dtype fix
    input_names = [inp.name for inp in kokoro.sess.get_inputs()]
    if "input_ids" in input_names:
        # v1.1+ model: patch _create_audio to fix speed dtype bug
        original_method = kokoro._create_audio
        kokoro._create_audio = lambda phonemes, voice, speed: patched_create_audio(
            kokoro, phonemes, voice, speed
        )

    # Synthesize
    samples, sample_rate = kokoro.create(text, voice=args.voice, speed=args.speed, lang=args.lang)

    # Write output
    sf.write(args.output, samples, sample_rate)
    print(f"OK: {args.output} ({len(samples)} samples, {sample_rate}Hz)", file=sys.stderr)


if __name__ == "__main__":
    main()
