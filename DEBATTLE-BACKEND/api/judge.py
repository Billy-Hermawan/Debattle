# judge.py — debate judge for Ollama (deepseek-r1:latest)
# - Uses /api/generate (Ollama 0.11.10)
# - Outputs ONLY /100 scores (scaled by 3.5)
# - Low-content short-circuit: if transcript has too little real speech, skip LLM and print minimal result
# - Guarantees paragraphs for overview & improvements, and rich move explanations (when not low-content)
# - HARD notable-move enforcement + speech slot assignment
# - Optional --debug to print label counts after balancing

import json
import argparse
import requests
import re
from jsonschema import validate, ValidationError

import warnings as _warnings
_warnings.filterwarnings("ignore", category=UserWarning, module="urllib3")

# ---------- CONFIG ----------
OLLAMA_URL = "http://localhost:11434"
MODEL = "deepseek-r1:latest"
TIMEOUT = 120

SPEECH_SLOTS = ["First Speech", "Second Speech", "Third Speech", "Reply"]

def margin_label(diff):
    d = abs(int(diff))
    if d <= 2: return "very close"
    elif d <= 5: return "close but clear"
    elif d <= 10: return "clear win"
    elif d <= 20: return "dominant win"
    else:
        return "overwhelming win"

# ---------- SCHEMA ----------
JUDGE_SCHEMA = {
  "type": "object",
  "properties": {
    "meta": {"type": "object","properties": {
        "format": {"type": "string","enum": ["Policy","BP","WSDC","Lincoln-Douglas","Other"]},
        "rules": {"type": "string"}}, "required": ["format","rules"]},
    "scores": {"type": "object","properties": {
        "affirmative": {"type":"object","properties":{
            "speaker1": {"$ref":"#/definitions/speaker"},
            "speaker2": {"$ref":"#/definitions/speaker"},
            "speaker3": {"$ref":"#/definitions/speaker"},
            "reply":   {"$ref":"#/definitions/reply"}}, "required": ["speaker1","speaker2","speaker3","reply"]},
        "negative": {"type":"object","properties":{
            "speaker1": {"$ref":"#/definitions/speaker"},
            "speaker2": {"$ref":"#/definitions/speaker"},
            "speaker3": {"$ref":"#/definitions/speaker"},
            "reply":   {"$ref":"#/definitions/reply"}}, "required": ["speaker1","speaker2","speaker3","reply"]}},
        "required": ["affirmative","negative"]},
    "winner": {"type":"string","enum":["AFFIRMATIVE","NEGATIVE","TIE"]},
    "rationale": {"type":"object","properties":{
        "summary":{"type":"string","maxLength":700},
        "why_winner":{"type":"string","maxLength":700},
        "key_clashes":{"type":"array","items":{"type":"string"},"maxItems":6}},
        "required":["summary","why_winner","key_clashes"]},
    "analysis": {"type":"object","properties":{
        "affirmative":{"type":"object","properties":{
            "overview":{"type":"string"},
            "improvements":{"type":"string"},
            "notable_moves":{"type":"array","items":{
                "type":"object","properties":{
                    "time":{"type":"string"},
                    "label":{"type":"string","enum":["brilliant","great","good","inaccuracy","blunder"]},
                    "explanation":{"type":"string"}},
                "required":["label","explanation"]}}},
            "required":["overview","improvements","notable_moves"]},
        "negative":{"type":"object","properties":{
            "overview":{"type":"string"},
            "improvements":{"type":"string"},
            "notable_moves":{"type":"array","items":{
                "type":"object","properties":{
                    "time":{"type":"string"},
                    "label":{"type":"string","enum":["brilliant","great","good","inaccuracy","blunder"]},
                    "explanation":{"type":"string"}},
                "required":["label","explanation"]}}},
            "required":["overview","improvements","notable_moves"]}},
        "required":["affirmative","negative"]}
  },
  "required": ["meta","scores","winner","rationale","analysis"],
  "definitions": {
    "speaker": {"type":"object","properties":{
        "matter":{"type":"number","minimum":0,"maximum":40},
        "manner":{"type":"number","minimum":0,"maximum":30},
        "method":{"type":"number","minimum":0,"maximum":30},
        "notes":{"type":"string"}}, "required":["matter","manner","method"]},
    "reply": {"type":"object","properties":{
        "matter":{"type":"number","minimum":0,"maximum":20},
        "manner":{"type":"number","minimum":0,"maximum":15},
        "method":{"type":"number","minimum":0,"maximum":15},
        "notes":{"type":"string"}}, "required":["matter","manner","method"]}
  }
}

# ---------- HELPERS ----------
def _messages_to_prompt(messages):
    lines = []
    for m in messages:
        role = (m.get("role") or "").upper()
        content = m.get("content","")
        tag = "SYSTEM" if role == "SYSTEM" else ("USER" if role == "USER" else "ASSISTANT")
        lines.append(f"[{tag}]\n{content}\n")
    lines.append("Return ONLY valid JSON that matches the schema. Do not add any text before or after it.")
    return "\n".join(lines)

def chat_ollama(messages, json_mode=True):
    # Always hit the correct Ollama endpoint
    base = OLLAMA_URL.rstrip("/")
    endpoint = f"{base}/api/generate"

    payload = {
        "model": MODEL,
        "prompt": _messages_to_prompt(messages),
        "stream": False,
        "options": {"temperature": 0}
    }
    if json_mode:
        payload["format"] = "json"

    r = requests.post(endpoint, json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    content = r.json().get("response", "")

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        raise RuntimeError("Model did not return valid JSON. Got:\n" + content)

def _clip(v, lo, hi):
    try: return max(lo, min(hi, float(v)))
    except Exception: return lo

def enforce_ranges(result):
    if not isinstance(result, dict): return result
    scores = result.get("scores", {})
    for side in ["affirmative", "negative"]:
        side_obj = scores.get(side, {})
        for spk in ["speaker1", "speaker2", "speaker3"]:
            s = side_obj.get(spk, {})
            s["matter"] = int(_clip(s.get("matter", 0), 0, 40))
            s["manner"] = int(_clip(s.get("manner", 0), 0, 30))
            s["method"] = int(_clip(s.get("method", 0), 0, 30))
            side_obj[spk] = s
        rep = side_obj.get("reply", {})
        rep["matter"] = int(_clip(rep.get("matter", 0), 0, 20))
        rep["manner"] = int(_clip(rep.get("manner", 0), 0, 15))
        rep["method"] = int(_clip(rep.get("method", 0), 0, 15))
        side_obj["reply"] = rep
        scores[side] = side_obj
    result["scores"] = scores
    return result

def weighted_total_speaker(sp):
    return int(sp.get("matter",0)) + int(sp.get("manner",0)) + int(sp.get("method",0))

def weighted_total_reply(rep):
    return int(rep.get("matter",0)) + int(rep.get("manner",0)) + int(rep.get("method",0))  # max 50

def compute_totals(result):
    aff = result["scores"]["affirmative"]
    neg = result["scores"]["negative"]
    return {
        "affirmative": (
            weighted_total_speaker(aff["speaker1"]) +
            weighted_total_speaker(aff["speaker2"]) +
            weighted_total_speaker(aff["speaker3"]) +
            weighted_total_reply(aff["reply"])
        ),
        "negative": (
            weighted_total_speaker(neg["speaker1"]) +
            weighted_total_speaker(neg["speaker2"]) +
            weighted_total_speaker(neg["speaker3"]) +
            weighted_total_reply(neg["reply"])
        )
    }

def scale_to_100(raw_total):  # 350/3.5 = 100
    return round(float(raw_total) / 3.5, 1)

# ----- Low-content detection & minimal result -----
LOW_CONTENT_SPEECH_MIN = 3      # fewer than this → low content
LOW_CONTENT_CHAR_MIN   = 120    # total payload text length under this → low content

def _extract_payload_text(transcript_text: str) -> str:
    # Remove tags like "[00:00 AFF-1]" and keep only actual speech payload
    return re.sub(r"\[\d{2}:\d{2}\s+(AFF|NEG)-[^\]]+\]\s*", "", transcript_text or "").strip()

def is_low_content(transcript_text: str) -> bool:
    if not transcript_text or not transcript_text.strip():
        return True
    lines = [ln for ln in transcript_text.splitlines() if ln.strip()]
    speech_lines = [ln for ln in lines if re.match(r"\[\d{2}:\d{2}\s+(AFF|NEG)-", ln)]
    payload = _extract_payload_text("\n".join(speech_lines))
    return (len(speech_lines) < LOW_CONTENT_SPEECH_MIN) or (len(payload) < LOW_CONTENT_CHAR_MIN)

def empty_result() -> dict:
    zero_sp = {"matter": 0, "manner": 0, "method": 0, "notes": ""}
    zero_reply = {"matter": 0, "manner": 0, "method": 0, "notes": ""}
    return {
        "meta": {
            "format": "Policy",
            "rules": "No new matter in 3rd speeches; reply is comparative only."
        },
        "scores": {
            "affirmative": {
                "speaker1": dict(zero_sp),
                "speaker2": dict(zero_sp),
                "speaker3": dict(zero_sp),
                "reply": dict(zero_reply)
            },
            "negative": {
                "speaker1": dict(zero_sp),
                "speaker2": dict(zero_sp),
                "speaker3": dict(zero_sp),
                "reply": dict(zero_reply)
            }
        },
        "winner": "TIE",
        "rationale": {
            "summary": "Insufficient material: there were not enough substantive speeches to evaluate the round.",
            "why_winner": "No winner — both teams provided insufficient content.",
            "key_clashes": []
        },
        "analysis": {
            "affirmative": {
                "overview": "No substantive speeches recorded for AFF.",
                "improvements": "Deliver required speeches with claims, warrants, and comparison.",
                "notable_moves": []
            },
            "negative": {
                "overview": "No substantive speeches recorded for NEG.",
                "improvements": "Deliver required speeches with claims, warrants, and comparison.",
                "notable_moves": []
            }
        }
    }

# ----- Rich-text fallbacks (used only when NOT low-content) -----
def _ensure_min_sentences(text: str, min_sents=3):
    t = (text or "").strip()
    count = sum(1 for s in t.replace("!", ".").replace("?", ".").split(".") if s.strip())
    if count >= min_sents:
        return t
    additions = [
        "They framed the weighing early and attempted to collapse the round onto the decisive clashes.",
        "Comparative analysis connected claims to explicit impacts, although some links could be clearer.",
        "Time allocation and signposting generally supported flow and judge comprehension."
    ]
    while count < min_sents and additions:
        t = (t + " " + additions.pop(0)).strip()
        count += 1
    return t

def _overview_fallback(side_name, transcript):
    base = (f"The {side_name} team presented a coherent case with clear signposting and "
            "attempted to control the weighing mechanism. They engaged core clashes, "
            "extending key material while addressing opponent pressure. Evidence use was "
            "directionally sound, though several claims would benefit from tighter warrants "
            "and explicit impact calculus tied to feasibility, risk, and timeframe.")
    return _ensure_min_sentences(base, 4)

def _improvements_fallback(side_name):
    base = (f"{side_name} can improve by tightening comparative weighing earlier, "
            "frontloading the round-winning mechanism, and backing asserted links with a "
            "concrete warrant (study, example, or model). They should also avoid "
            "assertion-by-repetition by collapsing onto the strongest contention and "
            "making explicit, line-by-line resolution of the main clashes.")
    return _ensure_min_sentences(base, 4)

def _expand_move(label, seed):
    if label == "brilliant":
        extra = " It combined clean warranting with timing that flipped a contested issue. The downstream impact shaped the judge's weighing."
    elif label == "great":
        extra = " It advanced the team's win condition with precise comparative work. The explanation connected claim to impact without new matter."
    elif label == "good":
        extra = " Solid structure and relevance maintained flow control. A clearer explicit impact link could make it round-deciding."
    elif label == "inaccuracy":
        extra = " A factual/comparative slip reduced credibility and opened room for opponent leverage. Correct sourcing and line-by-line precision would fix this."
    else:  # blunder
        extra = " Dropping or mishandling a critical line ceded weighing to the opponent. Always address the win-condition clash before extending new material."
    text = (seed or "A notable contribution occurred at a pivotal moment.") + extra
    return _ensure_min_sentences(text, 2)

def _assign_speech_slots(moves):
    # Pad/trim to exactly four
    while len(moves) < 4:
        moves.append({"time":"", "label":"good", "explanation":"A generally solid contribution with clear structure and relevance."})
    if len(moves) > 4:
        moves = moves[:4]
    # Assign time slots deterministically
    for i, m in enumerate(moves):
        m["time"] = SPEECH_SLOTS[i]
    return moves

def ensure_analysis_defaults(result, transcript_text):
    if "analysis" not in result or not isinstance(result["analysis"], dict):
        result["analysis"] = {}
    for side in ["affirmative","negative"]:
        blob = result["analysis"].get(side) or {}
        ov = (blob.get("overview") or "").strip()
        if not ov: ov = _overview_fallback(side.upper(), transcript_text)
        else: ov = _ensure_min_sentences(ov, 4)
        blob["overview"] = ov

        imp = (blob.get("improvements") or "").strip()
        if not imp: imp = _improvements_fallback(side.upper())
        else: imp = _ensure_min_sentences(imp, 4)
        blob["improvements"] = imp

        moves = blob.get("notable_moves") or []
        norm = []
        for m in moves:
            lbl = (m.get("label") or "good").lower()
            if lbl not in ["brilliant","great","good","inaccuracy","blunder"]:
                lbl = "good"
            exp = _expand_move(lbl, (m.get("explanation") or "").strip())
            norm.append({"time": (m.get("time") or "").strip(), "label": lbl, "explanation": exp})
        while len(norm) < 4:
            norm.append({"time":"", "label":"good",
                         "explanation": _expand_move("good", "A generally solid contribution with clear structure and relevance.")})
        blob["notable_moves"] = _assign_speech_slots(norm)
        result["analysis"][side] = blob
    return result

# ------------- HARD ENFORCER (guarantees distribution) -------------
def rebalance_notable_moves(result, winner):
    POS = ("brilliant", "great")
    NEG = ("inaccuracy", "blunder")

    def force_distribution(moves, want_positive_majority):
        """
        Winner  : >=2 POS, >=1 NEG, total=4, POS>NEG
        Loser   : >=2 NEG, >=1 POS, total=4, NEG>POS
        Always keeps at least one GOOD if possible.
        """
        if want_positive_majority:
            target = ["brilliant", "great", "good", "inaccuracy"]
        else:
            target = ["inaccuracy", "blunder", "good", "great"]

        new_moves = []
        for i, label in enumerate(target):
            seed_exp = moves[i]["explanation"] if i < len(moves) else ""
            new_moves.append({
                "time": SPEECH_SLOTS[i],
                "label": label,
                "explanation": _expand_move(label, seed_exp)
            })
        return new_moves

    for side in ["affirmative","negative"]:
        moves = result.get("analysis",{}).get(side,{}).get("notable_moves",[])
        moves = _assign_speech_slots(moves)
        is_winner = (winner != "TIE" and
                     ((winner == "AFFIRMATIVE" and side == "affirmative") or
                      (winner == "NEGATIVE" and side == "negative")))
        new = force_distribution(moves, want_positive_majority=is_winner)
        result["analysis"][side]["notable_moves"] = _assign_speech_slots(new)

def DEFAULT_TRANSCRIPT():
    return """\
[00:00 AFF-1] Defines key terms clearly; claims policy X reduces emissions using Smith (2023).
[03:00 NEG-1] Challenges definition scope; says Smith uses extreme scenario; presents alternative evidence.
[06:00 AFF-2] Extends with infrastructure risk and cost-benefit; rebuts scenario critique.
[09:00 NEG-2] Pushes adaptation argument with Jones (2024); says costs lower than claimed.
[12:00 AFF-3] Heavy rebuttal on adaptation residual risk; synthesises case; no new matter.
[15:00 NEG-3] Rebuttal on feasibility; (no new matter).
[18:00 AFF-Reply] Compares feasibility vs residual risk; frames why AFF wins.
[20:00 NEG-Reply] Compares on costs and realism; claims NEG wins on practicality.
"""

def build_user_prompt(transcript_text: str) -> str:
    return f"""
RUBRIC (weights):
- Substantive speeches: Matter 40, Manner 30, Method 30 (speaker1/2/3 both sides).
- Reply: Matter 20, Manner 15, Method 15 (comparative only, NO new matter).
- POIs fold into the three categories.

REQUIREMENTS:
- Output STRICT JSON only (no prose).
- MUST include: meta, scores{{affirmative{{speaker1,2,3,reply}}, negative{{speaker1,2,3,reply}}}}, winner, rationale{{summary, why_winner, key_clashes}}, analysis{{affirmative{{overview, improvements, notable_moves[]}}, negative{{overview, improvements, notable_moves[]}}}}.
- All numeric fields must be within allowed ranges. If any computed value would exceed the cap, set it to the cap.
- notable_moves: label in ["brilliant","great","good","inaccuracy","blunder"], explanation 2–5 sentences, >=4 items per team, preferably mapped to First/Second/Third/Reply.

FILL THIS EXACT TEMPLATE (replace zeros/strings; keep keys exactly as written):
{{
  "meta": {{
    "format": "Policy",
    "rules": "No new matter in 3rd speeches; reply is comparative only."
  }},
  "scores": {{
    "affirmative": {{
      "speaker1": {{"matter": 0, "manner": 0, "method": 0, "notes": ""}},
      "speaker2": {{"matter": 0, "manner": 0, "method": 0, "notes": ""}},
      "speaker3": {{"matter": 0, "manner": 0, "method": 0, "notes": ""}},
      "reply":   {{"matter": 0, "manner": 0, "method": 0, "notes": ""}}
    }},
    "negative": {{
      "speaker1": {{"matter": 0, "manner": 0, "method": 0, "notes": ""}},
      "speaker2": {{"matter": 0, "manner": 0, "method": 0, "notes": ""}},
      "speaker3": {{"matter": 0, "manner": 0, "method": 0, "notes": ""}},
      "reply":   {{"matter": 0, "manner": 0, "method": 0, "notes": ""}}
    }}
  }},
  "winner": "AFFIRMATIVE",
  "rationale": {{
    "summary": "",
    "why_winner": "",
    "key_clashes": ["", "", ""]
  }},
  "analysis": {{
    "affirmative": {{
      "overview": "",
      "improvements": "",
      "notable_moves": [{{"time":"", "label":"good", "explanation":""}}]
    }},
    "negative": {{
      "overview": "",
      "improvements": "",
      "notable_moves": [{{"time":"", "label":"good", "explanation":""}}]
    }}
  }}
}}

TRANSCRIPT:
{transcript_text}

Return ONLY the completed JSON object. Do not add any text before or after it.
""".strip()

# ---------- MAIN ----------
def main():
    parser = argparse.ArgumentParser(description="Debate judge using Ollama deepseek-r1")
    parser.add_argument("--transcript", type=str, default=None,
                        help="Path to a transcript .txt. If omitted, uses demo transcript.")
    parser.add_argument("--debug", action="store_true", help="Print debug counts for notable moves")
    args = parser.parse_args()

    if args.transcript:
        try:
            with open(args.transcript, "r", encoding="utf-8") as f:
                transcript_text = f.read()
        except FileNotFoundError:
            print(f"Transcript not found: {args.transcript}")
            return
    else:
        transcript_text = DEFAULT_TRANSCRIPT()

    # ----- LOW-CONTENT SHORT-CIRCUIT -----
    if is_low_content(transcript_text):
        result = empty_result()
        totals = {"affirmative": 0, "negative": 0}
        result["totals"] = totals

        aff_scaled = scale_to_100(0)
        neg_scaled = scale_to_100(0)
        final_statement = f"The round is a TIE. Final (/100): AFF {aff_scaled} - NEG {neg_scaled}."
        result["final_statement"] = final_statement

        # Output
        print(f"Team AFFIRMATIVE: {aff_scaled}/100")
        print(f"Team NEGATIVE:   {neg_scaled}/100")
        print(f"Final verdict: {result['final_statement']}")

        print("\n-- Per-Team Analysis --")
        for side in ["affirmative","negative"]:
            ta = result.get("analysis", {}).get(side, {})
            side_name = side.upper()
            print(f"\n[{side_name}] OVERVIEW:\n{ta.get('overview','(none)')}")
            print(f"\n[{side_name}] IMPROVEMENTS:\n{ta.get('improvements','(none)')}")
            moves = ta.get("notable_moves", [])
            if moves:
                print(f"\n[{side_name}] NOTABLE MOVES:")
                for mv in moves:
                    t = (mv.get("time") or "").strip()
                    lbl = (mv.get("label") or "good").upper()
                    exp = mv.get("explanation","").strip()
                    prefix = f"[{t}] " if t else ""
                    pretty = lbl
                    if lbl == "BRILLIANT": pretty = "BRILLIANT MOVE!"
                    elif lbl == "GREAT":   pretty = "GREAT MOVE!"
                    elif lbl == "GOOD":    pretty = "GOOD MOVE"
                    elif lbl == "INACCURACY": pretty = "INACCURACY"
                    elif lbl == "BLUNDER": pretty = "BLUNDER"
                    print(f"  - {prefix}{pretty}: {exp}")
            else:
                print(f"\n[{side_name}] NOTABLE MOVES: (none)")
        return
    # ----- END LOW-CONTENT -----

    SYSTEM = "You are an impartial debate judge. Judge arguments, not identity."
    user_prompt = build_user_prompt(transcript_text)
    messages = [{"role":"system","content": SYSTEM},{"role":"user","content": user_prompt}]

    # 1) Call model
    result = chat_ollama(messages, json_mode=True)

    # 2) Clamp numeric ranges
    result = enforce_ranges(result)

    # 3) Ensure rich analysis BEFORE validation
    result = ensure_analysis_defaults(result, transcript_text)

    # 4) Validate (retry once)
    try:
        validate(instance=result, schema=JUDGE_SCHEMA)
    except ValidationError:
        result = enforce_ranges(result)
        result = ensure_analysis_defaults(result, transcript_text)
        validate(instance=result, schema=JUDGE_SCHEMA)

    # 5) Totals & tie-break
    totals = compute_totals(result)
    result["totals"] = totals
    if result.get("winner") == "TIE":
        diff = totals["affirmative"] - totals["negative"]
        if abs(diff) >= 1:
            result["winner"] = "AFFIRMATIVE" if diff > 0 else "NEGATIVE"

    # 6) HARD rebalance notable moves (guaranteed distribution)
    rebalance_notable_moves(result, result.get("winner","TIE"))

    # Optional debug counts
    if args.debug:
        for side in ["affirmative","negative"]:
            mv = result["analysis"][side]["notable_moves"]
            pos = sum(1 for m in mv if m["label"] in {"brilliant","great"})
            negc = sum(1 for m in mv if m["label"] in {"inaccuracy","blunder"})
            print(f"[DEBUG {side}] positives={pos}, negatives={negc}, labels={[m['label'] for m in mv]}")

    # 7) Final statement & print ONLY /100 scores
    aff_total = totals["affirmative"]; neg_total = totals["negative"]
    aff_scaled = scale_to_100(aff_total); neg_scaled = scale_to_100(neg_total)
    diff_raw = aff_total - neg_total
    diff_scaled = round(abs(aff_scaled - neg_scaled), 1)
    if diff_raw == 0:
        final_statement = f"The round is a TIE. Final (/100): AFF {aff_scaled} - NEG {neg_scaled}."
    else:
        winner_side = "AFFIRMATIVE" if diff_raw > 0 else "NEGATIVE"
        final_statement = (
            f"Congratulations, Team {winner_side}! You win by {diff_scaled} points ({margin_label(diff_raw)}). "
            f"Final (/100): AFF {aff_scaled} - NEG {neg_scaled}."
        )
    result["final_statement"] = final_statement

    # ---- OUTPUT ----
    print(f"Team AFFIRMATIVE: {aff_scaled}/100")
    print(f"Team NEGATIVE:   {neg_scaled}/100")
    print(f"Final verdict: {result['final_statement']}")

    print("\n-- Per-Team Analysis --")
    for side in ["affirmative","negative"]:
        ta = result.get("analysis", {}).get(side, {})
        side_name = side.upper()
        print(f"\n[{side_name}] OVERVIEW:\n{ta.get('overview','(none)')}")
        print(f"\n[{side_name}] IMPROVEMENTS:\n{ta.get('improvements','(none)')}")
        moves = ta.get("notable_moves", [])
        if moves:
            print(f"\n[{side_name}] NOTABLE MOVES:")
            for mv in moves:
                t = (mv.get("time") or "").strip()
                lbl = (mv.get("label") or "good").upper()
                exp = mv.get("explanation","").strip()
                prefix = f"[{t}] " if t else ""
                if lbl == "BRILLIANT": pretty = "BRILLIANT MOVE!"
                elif lbl == "GREAT":   pretty = "GREAT MOVE!"
                elif lbl == "GOOD":    pretty = "GOOD MOVE"
                elif lbl == "INACCURACY": pretty = "INACCURACY"
                elif lbl == "BLUNDER": pretty = "BLUNDER"
                else: pretty = lbl
                print(f"  - {prefix}{pretty}: {exp}")
        else:
            print(f"\n[{side_name}] NOTABLE MOVES: (none)")

if __name__ == "__main__":
    main()
# End of judge.py
