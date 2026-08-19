#!/usr/bin/env bash
# Fetch everything the zero-key local tier needs. Idempotent.
set -euo pipefail
mkdir -p models/piper

echo "── whisper.cpp"
if [ ! -d models/whisper.cpp ]; then
  git clone --depth 1 https://github.com/ggerganov/whisper.cpp models/whisper.cpp
  make -C models/whisper.cpp -j server   # Metal-accelerated on Apple Silicon
fi
[ -f models/whisper.cpp/models/ggml-large-v3-turbo.bin ] || \
  bash models/whisper.cpp/models/download-ggml-model.sh large-v3-turbo

echo "── Ollama"
command -v ollama >/dev/null || brew install ollama
ollama pull qwen3:8b

echo "── Piper voices"
PIPER=https://huggingface.co/rhasspy/piper-voices/resolve/main
for v in "en/en_IN/priya/medium/en_IN-priya-medium" "hi/hi_IN/pratham/medium/hi_IN-pratham-medium"; do
  name=$(basename "$v")
  [ -f "models/piper/$name.onnx" ] || curl -fL "$PIPER/$v.onnx" -o "models/piper/$name.onnx"
  [ -f "models/piper/$name.onnx.json" ] || curl -fL "$PIPER/$v.onnx.json" -o "models/piper/$name.onnx.json"
done
command -v piper >/dev/null || brew install piper-tts || echo "install piper manually: https://github.com/rhasspy/piper"

echo
echo "Done. Start the whisper server in another shell:"
echo "  ./models/whisper.cpp/build/bin/server -m models/whisper.cpp/models/ggml-large-v3-turbo.bin --port 8080"
