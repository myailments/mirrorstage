import os
import logging
import tempfile
from flask import Flask, request, jsonify, send_file
import subprocess
import shutil
from concurrent.futures import ThreadPoolExecutor
import threading
import torch

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration
INFERENCE_SCRIPT = "scripts.inference"
UNET_CONFIG = "configs/unet/stage2.yaml"
CHECKPOINT_PATH = "checkpoints/latentsync_unet.pt"
INFERENCE_STEPS = 10
GUIDANCE_SCALE = 1.5

# Configure parallel processing
MAX_WORKERS = 4  # Adjust based on GPU memory and CPU cores
executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)
gpu_semaphore = threading.Semaphore(2)  # Limit concurrent GPU operations

# Optimize CUDA settings
torch.backends.cudnn.benchmark = True
torch.backends.cuda.matmul.allow_tf32 = True  # Enable TF32 for faster matrix multiplications
torch.backends.cudnn.allow_tf32 = True

def process_video(video_path, audio_path, output_path):
    with gpu_semaphore:
        try:
            # Clear GPU cache before processing
            torch.cuda.empty_cache()
            
            cmd = [
                "python", "-m", INFERENCE_SCRIPT,
                "--unet_config_path", UNET_CONFIG,
                "--inference_ckpt_path", CHECKPOINT_PATH,
                "--inference_steps", str(INFERENCE_STEPS),
                "--guidance_scale", str(GUIDANCE_SCALE),
                "--video_path", video_path,
                "--audio_path", audio_path,
                "--video_out_path", output_path
            ]

            logger.info("Running inference command")
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env={**os.environ, 
                     'CUDA_LAUNCH_BLOCKING': '0',
                     'TORCH_CUDA_ARCH_LIST': '8.0'}  # Optimize for A100
            )
            stdout, stderr = process.communicate()

            if process.returncode != 0:
                raise Exception(f"Inference failed: {stderr.decode()}")

            return True
        finally:
            torch.cuda.empty_cache()

@app.route('/health', methods=['GET'])
def health_check():
    logger.info("Health check requested")
    return jsonify({"status": "healthy"}), 200

@app.route('/sync', methods=['POST'])
def sync_video_audio():
    try:
        logger.info("Received video sync request")
        
        if 'video' not in request.files or 'audio' not in request.files:
            return jsonify({"error": "Both video and audio files are required"}), 400

        video_file = request.files['video']
        audio_file = request.files['audio']

        # Create unique temporary directory for this request
        temp_dir = tempfile.mkdtemp(prefix='latentsync_')
        
        # Save uploaded files
        video_path = os.path.join(temp_dir, f"input_video_{id(video_file)}.mp4")
        audio_path = os.path.join(temp_dir, f"input_audio_{id(audio_file)}.wav")
        output_path = os.path.join(temp_dir, f"output_video_{id(video_file)}.mp4")

        video_file.save(video_path)
        audio_file.save(audio_path)

        logger.info("Files saved, submitting to thread pool")
        
        # Process video without waiting for result
        future = executor.submit(process_video, video_path, audio_path, output_path)
        
        # Set up cleanup callback
        def cleanup_callback(future):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception as e:
                logger.error(f"Error cleaning up temp dir: {str(e)}")

        future.add_done_callback(cleanup_callback)
        
        # Wait for processing to complete with timeout
        try:
            future.result(timeout=600)  # 10 minute timeout
        except TimeoutError:
            return jsonify({"error": "Processing timeout"}), 504

        logger.info("Processing completed successfully")

        return send_file(
            output_path,
            mimetype='video/mp4',
            as_attachment=True,
            download_name='synchronized_video.mp4'
        )

    except Exception as e:
        logger.error(f"Error in video sync: {str(e)}", exc_info=True)
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    logger.info("Starting LatentSync server on port 8002...")
    from werkzeug.serving import run_simple
    run_simple('0.0.0.0', 8002, app, threaded=True, request_timeout=900)  # 15 minute timeout
