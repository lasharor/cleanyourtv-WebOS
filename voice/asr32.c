/* cytv-asr32: the recogniser for a TV whose kernel is 32-bit ARM (issue 175), where the 64-bit cytv-asr cannot start.
   Reads 16 kHz signed 16-bit mono PCM from stdin until EOF (at most 30 s) and prints the recognised text, like cytv-asr.
   Linked against libsherpa-onnx-c-api.so from the sherpa-onnx-core package (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx), which
   runs the Moonshine tiny English model (MIT); the header c-api.h comes from the same package. Built by voice/build.sh.
   Usage: cytv-asr32 <model dir> [threads] [sample rate, 16000] < pcm
   (the model dir holds encoder_model.ort, decoder_model_merged.ort, tokens.txt) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sherpa-onnx/c-api/c-api.h"

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: cytv-asr32 <model dir> [threads] [rate] < pcm\n"); return 2; }
  int rate = argc > 3 ? atoi(argv[3]) : 16000;
  if (rate < 8000 || rate > 48000) rate = 16000;
  size_t cap = (size_t)rate * 30, n = 0, got;
  short *pcm = malloc(cap * sizeof *pcm);
  float *f = malloc(cap * sizeof *f);
  if (!pcm || !f) return 1;
  while (n < cap && (got = fread(pcm + n, sizeof *pcm, cap - n, stdin)) > 0) n += got;
  for (size_t i = 0; i < n; i++) f[i] = pcm[i] / 32768.0f;

  char enc[1024], dec[1024], tok[1024];
  snprintf(enc, sizeof enc, "%s/encoder_model.ort", argv[1]);
  snprintf(dec, sizeof dec, "%s/decoder_model_merged.ort", argv[1]);
  snprintf(tok, sizeof tok, "%s/tokens.txt", argv[1]);

  SherpaOnnxOfflineRecognizerConfig c;
  memset(&c, 0, sizeof c);
  c.feat_config.sample_rate = 16000;
  c.feat_config.feature_dim = 80;
  c.model_config.moonshine.encoder = enc;
  c.model_config.moonshine.merged_decoder = dec;
  c.model_config.tokens = tok;
  c.model_config.num_threads = argc > 2 ? atoi(argv[2]) : 2;
  c.model_config.provider = "cpu";
  c.decoding_method = "greedy_search";

  const SherpaOnnxOfflineRecognizer *r = SherpaOnnxCreateOfflineRecognizer(&c);
  if (!r) { fprintf(stderr, "load failed: check the model files in %s\n", argv[1]); return 1; }
  const SherpaOnnxOfflineStream *s = SherpaOnnxCreateOfflineStream(r);
  if (n) SherpaOnnxAcceptWaveformOffline(s, rate, f, (int32_t)n);
  SherpaOnnxDecodeOfflineStream(r, s);
  const SherpaOnnxOfflineRecognizerResult *res = SherpaOnnxGetOfflineStreamResult(s);
  printf("%s\n", res && res->text ? res->text : "");
  SherpaOnnxDestroyOfflineRecognizerResult(res);
  SherpaOnnxDestroyOfflineStream(s);
  SherpaOnnxDestroyOfflineRecognizer(r);
  return 0;
}
