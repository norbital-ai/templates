# Kiosk presentation-attack detection

`minifasnet.onnx` is a float32 export of MiniVision's two pretrained
[Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing)
models at commit `b6d5f04ad78778917853b25c778acef6d5626d15`. Apache-2.0;
see `LICENSE.minivision`. No training or quantization was applied.

| Upstream weight | SHA-256 |
| --- | --- |
| `2.7_80x80_MiniFASNetV2.pth` | `a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0` |
| `4_0_0_80x80_MiniFASNetV1SE.pth` | `84ee1d37d96894d5e82de5a57df044ef80a58be2b218b5ed7cdfd875ec2f5990` |
| Exported `minifasnet.onnx` | `88f656fbb3b54291e02a769b97b96c62f9f03071bed0822518d23f3fe1fead45` |

Export: PyTorch 2.14.0, ONNX 1.22.0, opset 17, evaluation mode,
`conv6_kernel=(5,5)`, static inputs `crop27` and `crop4`, each `[1,3,80,80]`.
The graph returns `probabilities = (softmax(V2(crop27)) + softmax(V1SE(crop4))) / 2`.
Class index 1 means live, as in upstream `test.py`. Batch normalization is folded.
Ten seeded random input pairs agreed with the PyTorch models to within `5.97e-8`.
The artifact contains 3,489,949 bytes.

Preprocessing follows upstream `generate_patches.py` and `data_io/functional.py`:
2.7x and 4x face crops, shifted inside image bounds, inclusive pixel endpoints,
resized to 80x80, **BGR channel-first float32, 0–255**. Despite the upstream
ToTensor docstring, its implementation intentionally does **not** divide by 255.
Browser canvas bilinear resizing can differ slightly from OpenCV's interpolation.

The kiosk keeps only a face inside its visible silhouette eligible, but preserves
the surrounding camera image for these crops. Masking everything outside the face
would erase the screen and print context the model uses. Models and the pinned
ONNX Runtime Web WASM files are served from the release itself; no CDN or external
inference service receives camera frames.

ONNX Runtime Web is pinned to 1.23.2. Its MIT license and third-party notices
are copied from the [v1.23.2 source](https://github.com/microsoft/onnxruntime/tree/v1.23.2)
and shipped alongside the model and MiniVision license.

The live threshold is 0.8. This is a starting operating point, not a measured
camera-specific false-accept rate. The upstream real and spoof samples are
regressions for integration, not proof against all phones, replays, or cameras.
