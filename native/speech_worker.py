import json
import sys
import wave

try:
    from piper import PiperVoice, SynthesisConfig
    request = json.load(sys.stdin)
    voice = PiperVoice.load(request['model'])
    with wave.open(request['output'], 'wb') as output:
        voice.synthesize_wav(request['text'], output, syn_config=SynthesisConfig(length_scale=1 / request['speed']))
    print(json.dumps({'type': 'result', 'output': request['output']}), flush=True)
except Exception as error:
    print(json.dumps({'type': 'error', 'message': str(error)}), flush=True)
    sys.exit(1)
