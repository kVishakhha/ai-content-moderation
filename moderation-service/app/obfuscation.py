# Obfuscation-aware detection layer.
#
# The ML model (Detoxify) is trained on normally-spelled text, so deliberately
# disguised abuse slips past it: "k*ll u", "bxtch", "f@ck", "k1ll", "s h o o t".
# This module adds two cheap, rule-based safety nets that run alongside the
# model and *raise* category scores when disguised abuse is detected, so the
# existing decision_engine thresholds then block/warn as normal.
#
#   1. deobfuscate(text)  -> a "cleaned" copy (leet -> letters, repeats collapsed)
#      so the model gets a second, readable look at the message.
#   2. scan(text)         -> explicit fuzzy patterns for the highest-severity
#      cases: violent THREATS (verb + person target) and disguised PROFANITY.
#
# Design choice that keeps false positives low: a "masked vowel" only counts as
# obfuscation when the disguise character is a SYMBOL, DIGIT, or WRONG CONSONANT
# (e.g. b*tch, b1tch, bxtch) — never a real vowel. That way ordinary words like
# "batch", "butch", "botch" are NOT flagged as the disguised swear word.

import re
from typing import Dict

# --- Leet / symbol substitutions, used to build a readable copy of the text ---
_LEET = {
    "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a",
    "5": "s", "$": "s", "7": "t", "+": "t", "8": "b", "9": "g", "€": "e",
}


def deobfuscate(text: str) -> str:
    """Lowercase, map leet characters to letters, and collapse 3+ repeats.

    "F@@ck y0u!!!" -> "faack you" — gives the ML model a second, readable pass.
    """
    t = text.lower()
    t = "".join(_LEET.get(ch, ch) for ch in t)
    t = re.sub(r"(.)\1{2,}", r"\1\1", t)  # "killlll" -> "kill"
    return t


# Optional separators (spaces / dots / symbols) people insert between letters:
# "k . i . l . l", "s_h_o_o_t".
_SEP = r"[\W_]{0,3}"

# A disguised-vowel slot: a symbol, digit, or *consonant* standing in for a
# vowel — but NOT a real vowel (so "batch" is never read as the swear word).
_MASKED_VOWEL = r"[bcdfghjklmnpqrstvwxyz0-9\*\@\!\#\$\%\^\&\.\|\+]"

# A normal vowel slot that ALSO accepts disguises (used for threat verbs, where
# we want to catch both "kill you" and "k*ll u").
_ANY_VOWEL = r"[aeiou0-9\*\@\!\#\$\%\^\&\.\|\+x]"

_VOWELS = set("aeiou")


def _fuzzy(word: str, vowel_slot: str) -> str:
    """Build a regex for `word` tolerant of separators and disguised vowels."""
    parts = []
    for ch in word:
        if ch in _VOWELS:
            parts.append(vowel_slot)
        else:
            parts.append(re.escape(ch) + "+")
    return _SEP.join(parts)


# --- Profanity: disguised swears -> raise obscene (decision_engine warns) ------
_PROFANITY = [
    "fuck", "shit", "bitch", "cunt", "dick", "pussy", "asshole",
    "bastard", "slut", "whore", "prick", "wanker",
]
# Only the disguised form (masked vowel) — the model already catches plain spelling.
_PROFANITY_RE = re.compile(
    r"\b(?:" + "|".join(_fuzzy(w, _MASKED_VOWEL) for w in _PROFANITY) + r")\b",
    re.IGNORECASE,
)

# --- Threats: violent verb + a person target -> raise threat (engine blocks) ---
_THREAT_VERBS = [
    "kill", "murder", "stab", "shoot", "strangle", "behead",
    "rape", "lynch", "hang", "slit", "choke", "decapitate",
]
# Second/third person targets only. "me/myself" is excluded so idioms like
# "this heat is killing me" do NOT count as a threat. Matched literally (as
# whole words) — fuzzing these short tokens would match almost any vowel.
_TARGETS = [
    "you", "u", "ya", "yah", "ur", "yall", "him", "her", "them",
    "yourself", "urself", "themselves", "everyone", "somebody",
]
_VERB_RE = "(?:" + "|".join(_fuzzy(v, _ANY_VOWEL) for v in _THREAT_VERBS) + ")"
_TARGET_RE = r"\b(?:" + "|".join(_TARGETS) + r")\b"

# A bounded violent verb (optionally with an -ing/-s/-ed/-er suffix) followed,
# within a few words, by a person target: "kill u", "i'll k*ll you",
# "gonna shoot them". The leading \b stops mid-word hits like "skill".
_THREAT_RE = re.compile(
    r"\b" + _VERB_RE + r"(?:in|ing|s|ed|er)?\W+(?:\w+\W+){0,3}?" + _TARGET_RE,
    re.IGNORECASE,
)
# Self-harm encouragement: "kys", "kill yourself", "go die", "drink bleach".
_SELF_HARM_RE = re.compile(
    r"\bk+\W*y+\W*s+\b|\bgo\W+die\b|\bdrink\W+bleach\b|\bneck\W+(?:you|u|ur)",
    re.IGNORECASE,
)


def scan(text: str) -> Dict[str, bool]:
    """Return which high-severity, disguised harms are present in `text`."""
    deob = deobfuscate(text)
    candidates = (text.lower(), deob)

    threat = any(_THREAT_RE.search(c) or _SELF_HARM_RE.search(c) for c in candidates)
    profanity = any(_PROFANITY_RE.search(c) for c in candidates)
    return {"threat": threat, "profanity": profanity}
