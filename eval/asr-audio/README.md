# Synthetic ASR pilot input

These are generated speech samples, NOT user recordings or field-audio benchmarks.
Clean mono PCM16 WAVs at 16kHz are committed. Intermediate AIFF and generated noisy
WAVs are ignored, not deleted. `eval/run-asr-pilot.mjs` deterministically creates
12dB SNR white-noise versions with seed 42 before the explicitly budgeted pilot.
Do not rerun paid calls without a new authorized ledger reservation.

Generated with installed macOS `say` at 165 words/minute, then `afconvert` to WAV.
Spanish voice: Paulina (es_MX), 14.1501875 seconds. English voice: Samantha (en_US),
13.603 seconds. Initial sandboxed synthesis produced zero-byte audio data; those
agent-generated empty outputs were regenerated successfully with service access.

Spanish source:
> Eh, salí de visitar a Lucía de Soltec. Le mandaré mañana la ficha de Quantum Flower setenta y cinco, pero sin precios todavía. A Luis de Beta lo llamaré el lunes para confirmar la entrega. No acordamos otra reunión.

English source:
> Um, I met Maya, sorry, Maia from Northstar. I will send her the full clinical report tomorrow, but no prices yet. I will call Bob from Delta on Monday to check whether the replacement arrived. We did not agree to another meeting.

Maya/Maia may be acoustically indistinguishable; spelling recovery is not scored.
TTS pronunciation, just two base utterances and artificial stationary noise limit
generalization. These files do not test real accents, mobile codecs, wind or traffic.
