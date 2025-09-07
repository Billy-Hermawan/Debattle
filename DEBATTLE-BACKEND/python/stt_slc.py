#!/usr/bin/env python3
import argparse, json, sys, os, subprocess, tempfile, contextlib, wave

def duration_ms(wav_path: str) -> int:
    try:
        with contextlib.closing(wave.open(wav_path, "rb")) as f:
            frames = f.getnframes()
            rate = f.getframerate()
            return int(frames / float(rate) * 1000)
    except Exception:
        return 0

def to_wav(in_path: str) -> str:
    if in_path.lower().endswith(".wav"):
        return in_path
    out = tempfile.mktemp(suffix=".wav")
    # Requires ffmpeg on the box
    subprocess.run(
        ["ffmpeg", "-y", "-i", in_path, "-ac", "1", "-ar", "16000", out],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
    )
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="path to uploaded audio")
    args = ap.parse_args()

    try:
        wav = to_wav(args.inp)

        import speech_recognition as sr
        r = sr.Recognizer()
        with sr.AudioFile(wav) as src:
            audio = r.record(src)

        # You can swap to r.recognize_whisper_api(...) or any other backend here
        text = r.recognize_google(audio)
        ms = duration_ms(wav)
        print(json.dumps({"text": text, "ms": ms}))
    except Exception as e:
        print(json.dumps({"error": str(e), "text": "", "ms": 0}))
        sys.exit(1)

if __name__ == "__main__":
    main()
