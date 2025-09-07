# we couldnt get it to work soo its not done
# Python: speech to text that stores results in variables


import speech_recognition as sr
import pyttsx3

# recognizer + TTS
r = sr.Recognizer()
engine = pyttsx3.init()

def SpeakText(text: str) -> None:
    engine.say(text)
    engine.runAndWait()

print("Ready. Speak into your microphone (Ctrl+C to stop).")

# ---- variables you asked for ----
last_text = ""       # most recent utterance
utterances = []      # list of all utterances (strings)
words = []           # list of all words seen so far
# ---------------------------------

try:
    while True:
        try:
            with sr.Microphone() as source:
                r.adjust_for_ambient_noise(source, duration=0.2)
                audio = r.listen(source)

            # recognize → lowercase
            last_text = r.recognize_google(audio).lower()

            # store in variables
            utterances.append(last_text)
            words.extend(last_text.split())   # simple split into words

            # debug print (optional)
            print("Heard:", last_text)
            # SpeakText(last_text)  # uncomment if you want TTS echo

        except sr.UnknownValueError:
            print("Sorry, I didn't catch that.")
        except sr.RequestError as e:
            print(f"Could not request results: {e}")

except KeyboardInterrupt:
    print("\nExiting.")

# After the loop, you can use:
transcript_text = " ".join(utterances)
print("\nFinal transcript:", transcript_text)
print("Total words captured:", len(words))
# 'last_text', 'utterances', and 'words' are now populated variables.
