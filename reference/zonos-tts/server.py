import torch
import torchaudio
from flask import Flask, request, jsonify, send_file
from zonos.model import Zonos
from zonos.conditioning import make_cond_dict
import os
import tempfile

app = Flask(__name__)

# Check if CUDA is available and set device accordingly
device = "cuda" if torch.cuda.is_available() else "cpu"
if device == "cuda":
    # Optional: Set TF32 for better performance on Ampere GPUs (30xx series and up)
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
else:
    print("CUDA not available, using CPU")

# Initialize model with device
model = Zonos.from_pretrained("Zyphra/Zonos-v0.1-transformer", device=device)
model.eval()

# Load default speaker
default_wav_path = "assets/trimmed_autumn_voice.mp3"
default_wav, default_sampling_rate = torchaudio.load(default_wav_path)
# Move speaker embedding to same device as model
default_speaker = model.make_speaker_embedding(default_wav.to(device), default_sampling_rate)

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

@app.route('/tts', methods=['POST'])
def text_to_speech():
    try:
        data = request.get_json()
        text = data.get('text', '')
        
        if not text.strip():
            return jsonify({"error": "Empty text provided"}), 400
            
        # Create temporary file
        temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        output_path = temp_file.name
        
        # Generate audio
        with torch.no_grad():
            cond_dict = make_cond_dict(
                text=text,
                speaker=default_speaker,
                language="en-us",
                emotion=[0.6, 0.05, 0.05, 0.05, 0.05, 0.05, 0.5, 0.6],
            )
            conditioning = model.prepare_conditioning(cond_dict)
            codes = model.generate(conditioning)
            # Move to CPU before saving
            wavs = model.autoencoder.decode(codes).cpu()
            torchaudio.save(output_path, wavs[0], model.autoencoder.sampling_rate)
        
        return send_file(output_path, mimetype="audio/wav")
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8001)
